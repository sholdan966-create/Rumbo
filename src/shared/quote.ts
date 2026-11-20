// Cotizador: cálculos, validación, sugerencia de costos con su origen y copia del presupuesto aceptado.
import { BUDGET_CATS, BudgetCat, BudgetSnapshot, CompanyData, Quote, QuoteCost, QuoteStatus } from './types';
import { allocateFixedCosts, kmTotal, monthlyPool, routeKey, tripMonth } from './calc';
import { localDate } from './time';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface QuoteCalc {
  cost: number; suggestedNet: number | null; priceNet: number | null; iva: number | null; total: number | null;
  result: number | null; marginPct: number | null; error?: string;
}
/** Costo = suma de los costos incluidos. Precio sugerido = costo ÷ (1 − margen/100). Resultado = precio − costo. Margen = resultado ÷ precio × 100. */
export function quoteCalc(q: Pick<Quote, 'costs' | 'marginTarget' | 'priceNet' | 'ivaRate'>): QuoteCalc {
  const cost = round2(BUDGET_CATS.reduce((s, c) => s + (q.costs[c]?.included ? q.costs[c].amount || 0 : 0), 0));
  const m = q.marginTarget;
  if (!Number.isFinite(m) || m < 0 || m >= 100) return { cost, suggestedNet: null, priceNet: null, iva: null, total: null, result: null, marginPct: null, error: 'El margen objetivo debe ser mayor o igual a 0 y menor que 100 %' };
  const suggestedNet = round2(cost / (1 - m / 100));
  const priceNet = q.priceNet ?? suggestedNet;
  const result = round2(priceNet - cost);
  return { cost, suggestedNet, priceNet, iva: round2(priceNet * q.ivaRate), total: round2(priceNet * (1 + q.ivaRate)), result, marginPct: priceNet > 0 ? (result / priceNet) * 100 : null };
}

/** Estado efectivo: una cotización borrador o enviada con vigencia pasada figura como vencida. */
export function quoteStatus(q: Pick<Quote, 'status' | 'validUntil'>, today: string): QuoteStatus {
  return (q.status === 'borrador' || q.status === 'enviada') && q.validUntil && q.validUntil < today ? 'vencida' : q.status;
}
export const QUOTE_LABEL: Record<QuoteStatus, string> = { borrador: 'Borrador', enviada: 'Enviada', aceptada: 'Aceptada', rechazada: 'Rechazada', vencida: 'Vencida' };

export function validateQuote(q: Quote, d: Pick<CompanyData, 'clients' | 'trucks'>): string[] {
  const e: string[] = [];
  if (!d.clients.some(c => c.id === q.clientId)) e.push('Elegí un cliente');
  if (!q.origin.trim() || !q.destination.trim()) e.push('Indicá origen y destino');
  if (q.truckId && !d.trucks.some(t => t.id === q.truckId)) e.push('Vehículo inexistente');
  if (!q.truckId && !q.vehicleType.trim()) e.push('Elegí un vehículo o indicá el tipo de vehículo');
  for (const k of ['kmLoaded', 'kmEmpty', 'plannedHours'] as const) if (q[k] != null && !(q[k]! >= 0)) e.push('Kilómetros y duración no pueden ser negativos');
  for (const c of BUDGET_CATS) if (!(q.costs[c]?.amount >= 0)) e.push(`Costo inválido: ${c}`);
  const calc = quoteCalc(q); if (calc.error) e.push(calc.error);
  if (q.priceNet != null && !(q.priceNet >= 0)) e.push('El precio no puede ser negativo');
  if (!(q.ivaRate >= 0 && q.ivaRate <= 0.5)) e.push('IVA inválido');
  if (!q.validUntil) e.push('Indicá la vigencia de la propuesta');
  return e;
}

export const emptyCosts = (): Record<BudgetCat, QuoteCost> =>
  Object.fromEntries(BUDGET_CATS.map(c => [c, { amount: 0, included: c !== 'other', source: 'Sin dato: completar' }])) as Record<BudgetCat, QuoteCost>;

/**
 * Sugerencia de costos con su ORIGEN. Prioridad: parámetros del vehículo (combustible) → promedio de viajes finalizados y completos
 * de la misma ruta → sin dato. Todo puede ajustarse a mano; el origen queda escrito junto al importe.
 */
export function suggestCosts(d: CompanyData, i: { truckId: string | null; origin: string; destination: string; kmLoaded: number | null; kmEmpty: number | null }, now: Date): Record<BudgetCat, QuoteCost> {
  const costs = emptyCosts(); const tz = d.settings.timezone; const km = (i.kmLoaded ?? 0) + (i.kmEmpty ?? 0);
  const route = routeKey({ origin: i.origin, destination: i.destination });
  const hist = d.trips.filter(t => t.status === 'finalizado' && routeKey(t).toLowerCase() === route.toLowerCase() && (kmTotal(t) ?? 0) > 0);
  const avg = (cat: 'fuel' | 'tolls' | 'driverPay' | 'perDiem' | 'other') => {
    const vals = hist.map(t => { const items = t.expenses.filter(e => e.category === cat && e.status !== 'pendiente_revision' && e.status !== 'rechazado'); return items.length || t.expenseConfirmed[cat] ? items.reduce((s, e) => s + e.amount, 0) : null; }).filter((v): v is number => v != null);
    return vals.length ? { v: vals.reduce((a, b) => a + b, 0) / vals.length, n: vals.length } : null;
  };
  for (const cat of ['fuel', 'tolls', 'driverPay', 'perDiem', 'other'] as const) {
    const a = avg(cat); if (a) costs[cat] = { amount: Math.round(a.v), included: true, source: `Promedio de ${a.n} viaje(s) finalizado(s) de la ruta ${route}` };
  }
  const truck = d.trucks.find(t => t.id === i.truckId);
  const l100 = truck?.params.fuelLPer100km, price = d.settings.fuelPricePerLiter;
  if (truck && l100 && price && km > 0) costs.fuel = { amount: Math.round((km * l100 / 100) * price), included: true, source: `Parámetros de ${truck.name}: ${l100} L/100 km × $${price}/L × ${km} km` };
  if (truck && km > 0) {
    // costo operativo por km: costos mensuales del camión ÷ km mensuales promedio de sus últimos meses cerrados
    const cur = localDate(now, tz).slice(0, 7); const byMonth = new Map<string, number>();
    for (const t of d.trips) if (t.truckId === truck.id && t.status === 'finalizado') { const m = tripMonth(t, tz); const k = kmTotal(t); if (m && m < cur && k) byMonth.set(m, (byMonth.get(m) ?? 0) + k); }
    const months = [...byMonth.values()]; const pool = monthlyPool(truck);
    if (months.length && pool > 0) { const perKm = pool / (months.reduce((a, b) => a + b, 0) / months.length); costs.allocated = { amount: Math.round(perKm * km), included: true, source: `${truck.name}: costos mensuales $${Math.round(pool).toLocaleString('es-AR')} ÷ ${Math.round(months.reduce((a, b) => a + b, 0) / months.length).toLocaleString('es-AR')} km/mes promedio (${months.length} mes(es)) × ${km} km` }; }
    void allocateFixedCosts;
  }
  if (!costs.other.amount) costs.other = { amount: 0, included: false, source: 'No incluido (sin dato)' };
  return costs;
}

export function nextQuoteNumber(quotes: { number: string }[], year: number): string {
  const re = new RegExp(`^COT-${year}-(\\d+)$`); const max = quotes.reduce((m, q) => { const x = re.exec(q.number); return x ? Math.max(m, Number(x[1])) : m; }, 0);
  return `COT-${year}-${String(max + 1).padStart(4, '0')}`;
}

/** Copia del presupuesto aceptado: queda congelada en el viaje; cambios posteriores de tarifas o parámetros no la alteran. */
export function snapshotFromQuote(q: Quote, d: Pick<CompanyData, 'trucks'>, acceptedAt: string, acceptedBy: string): BudgetSnapshot {
  const c = quoteCalc(q); const truck = d.trucks.find(t => t.id === q.truckId);
  const costs = {} as BudgetSnapshot['costs'], included = {} as BudgetSnapshot['included'], assumptions = {} as BudgetSnapshot['assumptions'];
  for (const k of BUDGET_CATS) { costs[k] = q.costs[k].included ? q.costs[k].amount : 0; included[k] = q.costs[k].included; assumptions[k] = q.costs[k].source; }
  return { quoteId: q.id, quoteNumber: q.number, acceptedAt, acceptedBy, revenueNet: c.priceNet ?? 0, ivaRate: q.ivaRate, marginTarget: q.marginTarget, suggestedNet: c.suggestedNet ?? 0,
    costs, included, assumptions, kmLoaded: q.kmLoaded, kmEmpty: q.kmEmpty, plannedHours: q.plannedHours, vehicleLabel: truck ? `${truck.name} (${truck.plate})` : q.vehicleType };
}
