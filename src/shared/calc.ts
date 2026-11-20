// Cálculos compartidos (cliente, servidor y PDF usan exactamente estas funciones).
import {
  Agg, CompanyData, EXPENSE_CATEGORIES, ExpenseCategory, Invoice, MonthlyFigures, N, Payment, REQUIRED_EXPENSES,
  EXPENSE_LABEL, ServicePlan, Settings, Trip, TripCalc, Truck,
} from './types';
import { budgetVsActual } from './budget';
import { docAttention } from './documents';
import {
  addDays, daysBetween, daysInMonth, localDate, localMonth, minutesBetween, monthEnd, monthStart, prevMonth,
} from './time';

export const EPS = 0.005;
export const div = (a: number | null, b: number | null): N => (a == null || b == null || b === 0 ? null : a / b);

// ------------------------------------------------------------ Viaje: datos base
/** Fecha de operación del viaje: salida real; si no existe, salida prevista. */
export const operationInstant = (t: Trip): string | null => t.actualDeparture ?? t.plannedDeparture;
export const tripMonth = (t: Trip, tz: string): string | null => {
  const i = operationInstant(t); return i ? localMonth(i, tz) : null;
};
export const routeKey = (t: Pick<Trip, 'origin' | 'destination'>): string => `${t.origin.trim()} – ${t.destination.trim()}`;

export const kmTotal = (t: Trip): N => (t.kmLoaded == null || t.kmEmpty == null ? null : t.kmLoaded + t.kmEmpty);
/** Solo cuentan los gastos aprobados (o cargados por la oficina). Los pendientes de revisión y los rechazados no suman. */
export const countsAsCost = (e: { status?: string }) => e.status !== 'pendiente_revision' && e.status !== 'rechazado';
export const categoryAmount = (t: Trip, c: ExpenseCategory): N => {
  const items = t.expenses.filter(e => e.category === c && countsAsCost(e));
  if (items.length === 0) return t.expenseConfirmed[c] ? 0 : null; // pendiente vs. confirmado en $0
  return items.reduce((s, e) => s + e.amount, 0);
};
export const revenueNet = (t: Trip): N => t.serviceValue;
export const revenueGross = (t: Trip): N => (t.serviceValue == null ? null : t.serviceValue * (1 + t.ivaRate));

// ------------------------------------------------------------ Estimaciones de uso
export function paramsError(p: Truck['params']): string[] {
  const e: string[] = [];
  const nn = (v: number | null, name: string) => { if (v != null && (!Number.isFinite(v) || v < 0)) e.push(`${name} no puede ser negativo`); };
  nn(p.maintenancePerKm, 'Mantenimiento por km'); nn(p.tireSetCost, 'Costo del juego de neumáticos');
  nn(p.baseValue, 'Valor base'); nn(p.residualValue, 'Valor residual');
  if (p.tireLifeKm != null && !(p.tireLifeKm > 0)) e.push('La vida útil de neumáticos debe ser mayor que 0');
  if (p.lifeKm != null && !(p.lifeKm > 0)) e.push('La vida útil del vehículo debe ser mayor que 0');
  if (p.baseValue != null && p.residualValue != null && p.residualValue > p.baseValue) e.push('El valor residual no puede superar el valor base');
  return e;
}
export function estimateUsage(p: Truck['params'], km: N) {
  if (km == null || paramsError(p).length) return null;
  if (p.maintenancePerKm == null || p.tireSetCost == null || !p.tireLifeKm || p.baseValue == null || p.residualValue == null || !p.lifeKm) return null;
  const maintenance = p.maintenancePerKm * km;
  const tires = (p.tireSetCost / p.tireLifeKm) * km;
  const depreciation = ((p.baseValue - p.residualValue) / p.lifeKm) * km;
  return { maintenance, tires, depreciation, total: maintenance + tires + depreciation };
}

// ------------------------------------------------------------ Costos operativos mensuales asignados por km
export const monthlyPool = (truck: Truck): number => truck.monthlyFixedCosts.reduce((s, f) => s + f.amount, 0);

/**
 * Regla explícita: el costo operativo mensual de cada camión (seguro, patentes, GPS, administración, etc.)
 * se reparte entre los viajes FINALIZADOS del camión en ese mes (por fecha de operación) en proporción a sus km totales.
 * La suma asignada es siempre igual al costo del mes (se cuenta una sola vez). En el mes en curso solo se asigna la
 * fracción transcurrida del mes. Si el camión no tiene km en el mes, el costo queda sin asignar (se informa aparte).
 */
export function allocateFixedCosts(trucks: Truck[], trips: Trip[], tz: string, now: Date) {
  const alloc = new Map<string, number>();
  const unallocated: { truckId: string; month: string; amount: number }[] = [];
  const today = localDate(now, tz); const curMonth = today.slice(0, 7);
  const groups = new Map<string, Trip[]>();
  for (const t of trips) {
    if (t.status !== 'finalizado') continue;
    const m = tripMonth(t, tz); if (!m) continue;
    const k = `${t.truckId}|${m}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(t);
  }
  for (const [k, ts] of groups) {
    const [truckId, month] = k.split('|');
    const truck = trucks.find(x => x.id === truckId); if (!truck) continue;
    let pool = monthlyPool(truck);
    if (month === curMonth) pool *= Math.min(1, Number(today.slice(8)) / daysInMonth(month));
    const withKm = ts.filter(t => (kmTotal(t) ?? 0) > 0);
    const kmSum = withKm.reduce((s, t) => s + kmTotal(t)!, 0);
    if (kmSum <= 0) { if (pool > 0) unallocated.push({ truckId, month, amount: pool }); continue; }
    for (const t of withKm) alloc.set(t.id, (pool * kmTotal(t)!) / kmSum);
  }
  return { alloc, unallocated };
}

// ------------------------------------------------------------ Facturas y cobros
export interface InvoiceTotals {
  net: number; iva: number; total: number; adjustments: number; adjusted: number; paid: number; balance: number;
  status: 'pagada' | 'vencida' | 'por_vencer' | 'vigente'; partial: boolean;
}
export function invoiceTotals(inv: Invoice, payments: Payment[], asOf: string, dueSoonDays: number): InvoiceTotals {
  const net = inv.lines.reduce((s, l) => s + l.net, 0);
  const iva = net * inv.ivaRate;
  const total = net + iva;
  const adjustments = inv.adjustments.filter(a => a.date <= asOf).reduce((s, a) => s + a.amount, 0);
  const adjusted = total + adjustments;
  const paid = payments.filter(p => p.invoiceId === inv.id && p.date <= asOf).reduce((s, p) => s + p.amount, 0);
  const balance = adjusted - paid;
  let status: InvoiceTotals['status'] = 'vigente';
  if (balance <= EPS) status = 'pagada';
  else if (inv.dueDate < asOf) status = 'vencida';
  else if (daysBetween(asOf, inv.dueDate) <= dueSoonDays) status = 'por_vencer';
  return { net, iva, total, adjustments, adjusted, paid, balance, status, partial: paid > EPS && balance > EPS };
}

export function receivablesAt(
  invoices: Invoice[], payments: Payment[], clients: { id: string; name: string }[], asOf: string, dueSoonDays: number, issuedBefore?: string,
) {
  const r = { pending: 0, overdue: 0, dueSoon: 0, current: 0, fromPreviousMonths: 0, invoicesOpen: 0, byClient: [] as MonthlyFigures['receivables']['byClient'] };
  const by = new Map<string, { pending: number; overdue: number }>();
  for (const inv of invoices) {
    if (inv.issueDate > asOf) continue;
    const t = invoiceTotals(inv, payments, asOf, dueSoonDays);
    if (t.balance <= EPS) continue;
    r.pending += t.balance; r.invoicesOpen++;
    if (t.status === 'vencida') r.overdue += t.balance; else if (t.status === 'por_vencer') r.dueSoon += t.balance; else r.current += t.balance;
    if (issuedBefore && inv.issueDate < issuedBefore) r.fromPreviousMonths += t.balance;
    const c = by.get(inv.clientId) ?? { pending: 0, overdue: 0 };
    c.pending += t.balance; if (t.status === 'vencida') c.overdue += t.balance; by.set(inv.clientId, c);
  }
  r.byClient = [...by].map(([clientId, v]) => ({ clientId, client: clients.find(c => c.id === clientId)?.name ?? clientId, ...v }))
    .sort((a, b) => b.pending - a.pending);
  return r;
}

// ------------------------------------------------------------ Cálculo por viaje
export interface CalcInput {
  settings: Settings; trucks: Truck[]; trips: Trip[]; invoices: Invoice[]; payments: Payment[]; now: Date;
}
export function computeTrips(d: CalcInput): Map<string, TripCalc> {
  const tz = d.settings.timezone;
  const { alloc } = allocateFixedCosts(d.trucks, d.trips, tz, d.now);
  const today = localDate(d.now, tz);
  const out = new Map<string, TripCalc>();
  for (const t of d.trips) out.set(t.id, computeTrip(t, d, alloc.get(t.id) ?? null, today));
  return out;
}

export function computeTrip(t: Trip, d: CalcInput, allocated: N, today: string): TripCalc {
  const truck = d.trucks.find(x => x.id === t.truckId);
  const km = kmTotal(t);
  const direct = {} as Record<ExpenseCategory, number | null>;
  let directTotal = 0; const pendingCategories: ExpenseCategory[] = [];
  for (const c of EXPENSE_CATEGORIES) {
    const a = categoryAmount(t, c); direct[c] = a;
    const inReview = t.expenses.some(e => e.category === c && e.status === 'pendiente_revision');
    if (a == null) { if (REQUIRED_EXPENSES.includes(c) && !inReview) pendingCategories.push(c); } else directTotal += a;
  }
  const review = t.expenses.filter(e => e.status === 'pendiente_revision');
  const pendingReview = { count: review.length, amount: review.reduce((s, e) => s + e.amount, 0) };
  const revNet = revenueNet(t); const revGross = revenueGross(t);
  const revenue = d.settings.profitabilityBasis === 'gross' ? revGross : revNet;
  const finished = t.status === 'finalizado';
  const alloc = finished ? allocated : null;
  const totalCost: N = finished ? directTotal + (alloc ?? 0) : null;
  const result: N = finished && revenue != null && totalCost != null ? revenue - totalCost : null;
  const marginPct: N = result != null && revenue != null && revenue !== 0 ? (result / revenue) * 100 : null;
  const estimates = truck ? estimateUsage(truck.params, km) : null;

  // Facturación del viaje (las facturas pueden agrupar varios viajes; cobros proporcionales a la parte de cada viaje)
  let invoicedNet = 0, invoicedTotal = 0, paid = 0, balance = 0;
  for (const inv of d.invoices) {
    const line = inv.lines.filter(l => l.tripId === t.id).reduce((s, l) => s + l.net, 0);
    if (!line) continue;
    const it = invoiceTotals(inv, d.payments, '9999-12-31', d.settings.dueSoonDays);
    const share = it.net > 0 ? line / it.net : 0;
    invoicedNet += line; invoicedTotal += line * (1 + inv.ivaRate);
    paid += it.paid * share; balance += it.balance * share;
  }

  const duration = t.actualDeparture && t.actualArrival ? minutesBetween(t.actualDeparture, t.actualArrival) : null;
  const planned = t.plannedDeparture && t.plannedArrival ? minutesBetween(t.plannedDeparture, t.plannedArrival) : null;
  const stopsMin = t.stops && t.stops.length ? t.stops.reduce((s, x) => s + Math.max(0, minutesBetween(x.start, x.end)), 0) : null;
  const driving = duration != null && stopsMin != null ? Math.max(0, duration - stopsMin) : null;

  const missing: string[] = [];
  if (finished) {
    if (t.serviceValue == null) missing.push('Valor del servicio');
    if (t.kmLoaded == null) missing.push('Kilómetros con carga');
    if (t.kmEmpty == null) missing.push('Kilómetros vacíos');
    if (pendingCategories.length) missing.push(`Gastos sin registrar: ${pendingCategories.map(c => EXPENSE_LABEL[c]).join(', ')}`);
    if (pendingReview.count) missing.push(`${pendingReview.count} gasto(s) pendiente(s) de revisión por ${pendingReview.amount.toLocaleString('es-AR')} pesos`);
    if (!t.actualDeparture || !t.actualArrival) missing.push('Horarios reales de salida y llegada');
    if (km != null && km > 0 && alloc == null) missing.push('Costos operativos asignados no disponibles');
  }
  return {
    tripId: t.id, kmLoaded: t.kmLoaded, kmEmpty: t.kmEmpty, kmTotal: km,
    revenueNet: revNet, revenueGross: revGross, revenue, direct, directTotal, pendingCategories,
    allocated: alloc, totalCost, result, marginPct,
    costPerKm: div(totalCost, km), revenuePerKm: div(revenue, km),
    estimates, economicResult: result != null && estimates ? result - estimates.total : null,
    invoicedNet, invoicedTotal, paid, balance, pendingReview, resultIfApproved: result != null ? result - pendingReview.amount : null,
    durationMin: duration, plannedDurationMin: planned, drivingMin: driving, stopsMin,
    missing, complete: finished ? missing.length === 0 : false,
  };
}

// ------------------------------------------------------------ Agregación (siempre con sumas, nunca promediando porcentajes)
export function aggregate(calcs: TripCalc[]): Agg {
  const a: Agg = {
    trips: 0, km: 0, revenue: 0, direct: { fuel: 0, tolls: 0, driverPay: 0, perDiem: 0, other: 0 }, directTotal: 0,
    allocated: 0, totalCost: 0, result: 0, marginPct: null, costPerKm: null, revenuePerKm: null, estimates: 0, incomplete: 0,
  };
  let kmCost = 0, kmRev = 0;
  for (const c of calcs) {
    if (c.totalCost == null || c.revenue == null) continue;
    a.trips++; a.revenue += c.revenue; a.totalCost += c.totalCost; a.result += c.result ?? 0;
    for (const k of EXPENSE_CATEGORIES) a.direct[k] += c.direct[k] ?? 0;
    a.directTotal += c.directTotal; a.allocated += c.allocated ?? 0;
    if (c.estimates) a.estimates += c.estimates.total;
    if (!c.complete) a.incomplete++;
    if (c.kmTotal != null && c.kmTotal > 0) { a.km += c.kmTotal; kmCost += c.totalCost; kmRev += c.revenue; }
  }
  a.marginPct = a.revenue > 0 ? (a.result / a.revenue) * 100 : null;
  a.costPerKm = a.km > 0 ? kmCost / a.km : null;
  a.revenuePerKm = a.km > 0 ? kmRev / a.km : null;
  return a;
}

/** Variación relativa (%) entre períodos; null si el período anterior no es comparable. */
export const pctChange = (cur: N, prev: N): N => (cur == null || prev == null || prev === 0 ? null : ((cur - prev) / Math.abs(prev)) * 100);
/** Cambio en puntos porcentuales (para márgenes). */
export const ppChange = (cur: N, prev: N): N => (cur == null || prev == null ? null : cur - prev);

// ------------------------------------------------------------ Mantenimiento
export interface ServiceStatus {
  plan: ServicePlan; nextKm: N; nextDate: string | null; remainingKm: N; remainingDays: N;
  status: 'vencido' | 'proximo' | 'al_dia' | 'sin_datos';
}
export const currentOdometer = (truck: Truck, trips: Trip[]): N => {
  const vals = [truck.odometerKm, ...trips.filter(t => t.truckId === truck.id).map(t => t.odometerEnd)].filter((v): v is number => v != null);
  return vals.length ? Math.max(...vals) : null;
};
export function serviceStatus(plan: ServicePlan, odometer: N, today: string): ServiceStatus {
  const nextKm = plan.intervalKm != null && plan.lastKm != null ? plan.lastKm + plan.intervalKm : null;
  const nextDate = plan.intervalDays != null && plan.lastDate ? addDays(plan.lastDate, plan.intervalDays) : null;
  const remainingKm = nextKm != null && odometer != null ? nextKm - odometer : null;
  const remainingDays = nextDate ? daysBetween(today, nextDate) : null;
  let status: ServiceStatus['status'] = 'al_dia';
  if (remainingKm == null && remainingDays == null) status = 'sin_datos';
  else if ((remainingKm != null && remainingKm <= 0) || (remainingDays != null && remainingDays < 0)) status = 'vencido';
  else if ((remainingKm != null && plan.alertBeforeKm != null && remainingKm <= plan.alertBeforeKm) ||
    (remainingDays != null && plan.alertBeforeDays != null && remainingDays <= plan.alertBeforeDays)) status = 'proximo';
  return { plan, nextKm, nextDate, remainingKm, remainingDays, status };
}

// ------------------------------------------------------------ Versión de datos (para versionar y evitar duplicados de PDF)
export function hashString(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}
/** Versión de los datos que alimentan la ficha del viaje. Cambia solo si cambia algo que aparece en el PDF. */
export function tripDataVersion(t: Trip, d: Pick<CompanyData, 'invoices' | 'payments' | 'trucks' | 'clients' | 'drivers' | 'settings'> & { files?: CompanyData['files'] }): string {
  const { updatedAt, createdAt, ...core } = t; void updatedAt; void createdAt;
  const inv = d.invoices.filter(i => i.lines.some(l => l.tripId === t.id));
  const pay = d.payments.filter(p => inv.some(i => i.id === p.invoiceId));
  const truck = d.trucks.find(x => x.id === t.truckId);
  const s = d.settings;
  return hashString(JSON.stringify([core, inv, pay, truck && { p: truck.params, f: truck.monthlyFixedCosts, n: truck.name, pl: truck.plate },
    d.clients.find(c => c.id === t.clientId), d.drivers.find(x => x.id === t.driverId), (d.files ?? []).filter(f => f.entityId === t.id || f.links.some(l => l.id === t.id || t.expenses.some(e => e.id === l.id))).map(f => [f.id, f.name]), s.companyName, s.timezone, s.profitabilityBasis, s.marginTarget]));
}

// ------------------------------------------------------------ Cierre mensual
export function buildMonthlyFigures(d: CompanyData, month: string, now: Date): MonthlyFigures {
  const tz = d.settings.timezone;
  const calcs = computeTrips({ settings: d.settings, trucks: d.trucks, trips: d.trips, invoices: d.invoices, payments: d.payments, now });
  const cutoff = monthEnd(month);
  const inMonth = (m: string) => d.trips.filter(t => t.status === 'finalizado' && tripMonth(t, tz) === m).map(t => calcs.get(t.id)!);
  const cur = inMonth(month);
  const pm = prevMonth(month);
  const prevCalcs = inMonth(pm);
  const route = (id: string) => routeKey(d.trips.find(t => t.id === id)!);
  const groups = (list: TripCalc[], key: (c: TripCalc) => string) => {
    const m = new Map<string, TripCalc[]>(); for (const c of list) (m.get(key(c)) ?? m.set(key(c), []).get(key(c))!).push(c); return m;
  };
  const byRoute = [...groups(cur, c => route(c.tripId))].map(([r, l]) => ({ route: r, ...aggregate(l) })).sort((a, b) => b.revenue - a.revenue);
  const byTruck = [...groups(cur, c => d.trips.find(t => t.id === c.tripId)!.truckId)].map(([id, l]) => ({
    truckId: id, truck: d.trucks.find(x => x.id === id)?.name ?? id, ...aggregate(l),
  })).sort((a, b) => a.truck.localeCompare(b.truck, 'es', { numeric: true }));
  const rec = receivablesAt(d.invoices, d.payments, d.clients, cutoff, d.settings.dueSoonDays, monthStart(month));
  const { unallocated } = allocateFixedCosts(d.trucks, d.trips, tz, now);
  const unbilled = d.trips.filter(t => {
    if (t.status !== 'finalizado' || tripMonth(t, tz) !== month || t.serviceValue == null) return false;
    const billed = d.invoices.filter(i => i.issueDate <= cutoff).flatMap(i => i.lines).filter(l => l.tripId === t.id).reduce((s, l) => s + l.net, 0);
    return billed < t.serviceValue - 0.5;
  }).length;
  const today = localDate(now, tz);
  const maintenanceDue: MonthlyFigures['maintenanceDue'] = [];
  for (const tr of d.trucks) for (const p of tr.servicePlans) {
    const s = serviceStatus(p, currentOdometer(tr, d.trips), today);
    if (s.status === 'vencido' || s.status === 'proximo') maintenanceDue.push({ truck: tr.name, service: p.name, status: s.status });
  }
  // Desvíos de costo de viajes con presupuesto (cotizaciones), solo con datos completos
  const cutoffInMonth = d.trips.filter(t => t.status === 'finalizado' && tripMonth(t, tz) === month && t.budgetSnapshot);
  const deviations = cutoffInMonth.map(t => { const bva = budgetVsActual(t, calcs.get(t.id)!)!; const r = bva.totalCost;
    return { tripId: t.id, route: routeKey(t), planned: r.planned ?? 0, actual: r.actual ?? 0, diff: r.diff ?? 0, pct: r.pct, reliable: bva.reliable }; })
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 5);
  const qs = cutoffInMonth.map(t => ({ t, b: budgetVsActual(t, calcs.get(t.id)!)! }));
  const quoted = qs.length ? { trips: qs.length, plannedRevenue: qs.reduce((a, x) => a + (x.b.revenue.planned ?? 0), 0), actualRevenue: qs.reduce((a, x) => a + (x.b.revenue.actual ?? 0), 0),
    plannedResult: qs.reduce((a, x) => a + (x.b.result.planned ?? 0), 0), actualResult: qs.reduce((a, x) => a + (x.b.result.actual ?? 0), 0), incomplete: qs.filter(x => !x.b.reliable).length } : null;
  const docsAttention = docAttention(d, today).map(r => ({ owner: r.owner, type: r.type.label, status: r.status, days: r.days }));
  const expensesInReview = d.trips.reduce((s, t) => s + t.expenses.filter(e => e.status === 'pendiente_revision').length, 0);
  const collectionPromises = d.collections.filter(c => c.promise?.status === 'pendiente').map(c => ({ client: d.clients.find(x => x.id === c.clientId)?.name ?? c.clientId, date: c.promise!.date, amount: c.promise!.amount })).sort((a, b) => a.date.localeCompare(b.date));
  return {
    month, prevMonth: pm, timezone: tz, basis: d.settings.profitabilityBasis, cutoffDate: cutoff,
    current: aggregate(cur), previous: prevCalcs.length ? aggregate(prevCalcs) : null,
    byRoute, byTruck,
    receivables: { pending: rec.pending, overdue: rec.overdue, dueSoon: rec.dueSoon, current: rec.current, byClient: rec.byClient, fromPreviousMonths: rec.fromPreviousMonths, invoicesOpen: rec.invoicesOpen },
    unbilledTrips: unbilled,
    unallocatedFixed: unallocated.filter(u => u.month === month).reduce((s, u) => s + u.amount, 0),
    incompleteTripIds: cur.filter(c => !c.complete).map(c => c.tripId),
    maintenanceDue, deviations, quoted, docsAttention, expensesInReview, collectionPromises,
  };
}

export function monthlyMissing(d: CompanyData, f: MonthlyFigures): string[] {
  const out: string[] = [];
  if (f.current.trips === 0) out.push('No hay viajes finalizados en el mes');
  if (f.incompleteTripIds.length) out.push(`${f.incompleteTripIds.length} viaje(s) finalizado(s) con datos pendientes: ${f.incompleteTripIds.slice(0, 6).join(', ')}${f.incompleteTripIds.length > 6 ? '…' : ''}`);
  const tz = d.settings.timezone;
  const open = d.trips.filter(t => (t.status === 'en_curso' || t.status === 'planificado') && tripMonth(t, tz) === f.month).length;
  if (open) out.push(`${open} viaje(s) del mes todavía no están finalizados`);
  if (f.unbilledTrips) out.push(`${f.unbilledTrips} viaje(s) finalizado(s) sin facturar al cierre`);
  if (f.expensesInReview) out.push(`${f.expensesInReview} gasto(s) cargado(s) por choferes pendiente(s) de revisión`);
  if (f.unallocatedFixed > 0) out.push('Costos operativos mensuales sin asignar (camiones sin km en el mes)');
  return out;
}
