import { Invoice, Payment, Trip, CompanyData, EXPENSE_CATEGORIES } from './types';
import { invoiceTotals, EPS, kmTotal, operationInstant } from './calc';
import { localDate } from './time';

export interface Issue { field: string; message: string }
export interface Validation { errors: Issue[]; warnings: Issue[] }
const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const isoOk = (s: string | null) => s == null || !Number.isNaN(new Date(s).getTime());

export function validateTrip(t: Trip, d: Pick<CompanyData, 'trips' | 'clients' | 'trucks' | 'drivers' | 'settings'>, isNew: boolean): Validation {
  const errors: Issue[] = [], warnings: Issue[] = [];
  const E = (field: string, message: string) => errors.push({ field, message });
  const W = (field: string, message: string) => warnings.push({ field, message });
  if (!t.id.trim()) E('id', 'El identificador es obligatorio');
  if (isNew && d.trips.some(x => x.id === t.id)) E('id', 'Ya existe un viaje con ese identificador');
  if (!d.clients.some(c => c.id === t.clientId)) E('clientId', 'Elegí un cliente');
  if (!t.origin.trim()) E('origin', 'Indicá el origen');
  if (!t.destination.trim()) E('destination', 'Indicá el destino');
  if (t.origin.trim() && t.origin.trim().toLowerCase() === t.destination.trim().toLowerCase()) W('destination', 'Origen y destino son iguales');
  if (!d.trucks.some(x => x.id === t.truckId)) E('truckId', 'Elegí un camión');
  if (!d.drivers.some(x => x.id === t.driverId)) E('driverId', 'Elegí un chofer');
  for (const f of ['plannedDeparture', 'plannedArrival', 'actualDeparture', 'actualArrival'] as const) if (!isoOk(t[f])) E(f, 'Fecha u hora inválida');
  if (t.plannedDeparture && t.plannedArrival && t.plannedArrival < t.plannedDeparture) E('plannedArrival', 'La llegada prevista es anterior a la salida prevista');
  if (t.actualDeparture && t.actualArrival && t.actualArrival < t.actualDeparture) E('actualArrival', 'La llegada real es anterior a la salida real');
  if (t.status === 'en_curso' && !t.actualDeparture) E('actualDeparture', 'Un viaje en curso necesita la salida real');
  if (t.status === 'finalizado' && (!t.actualDeparture || !t.actualArrival)) W('actualArrival', 'Faltan horarios reales: el informe saldrá como provisorio');
  if (t.status !== 'finalizado' && t.actualArrival) W('actualArrival', 'Hay llegada real pero el estado no es finalizado');
  if (t.status === 'planificado' && !t.plannedDeparture) E('plannedDeparture', 'Un viaje planificado necesita salida prevista');
  for (const f of ['kmLoaded', 'kmEmpty'] as const) {
    if (t[f] != null && (!ok(t[f]) || t[f]! < 0)) E(f, 'Los kilómetros deben ser un número mayor o igual a 0');
  }
  if (t.kmLoaded != null && t.kmLoaded > 20000) W('kmLoaded', 'Kilómetros inusualmente altos para un viaje');
  for (const f of ['odometerStart', 'odometerEnd'] as const) if (t[f] != null && (!ok(t[f]) || t[f]! < 0)) E(f, 'Odómetro inválido');
  if (t.odometerStart != null && t.odometerEnd != null) {
    if (t.odometerEnd < t.odometerStart) E('odometerEnd', 'El odómetro final es menor que el inicial');
    else {
      const km = kmTotal(t);
      if (km != null && km > 0 && Math.abs(t.odometerEnd - t.odometerStart - km) / km > 0.1)
        W('odometerEnd', `El odómetro indica ${t.odometerEnd - t.odometerStart} km y los km cargados suman ${km}: revisá la diferencia`);
    }
  }
  if (t.serviceValue != null && (!ok(t.serviceValue) || t.serviceValue < 0)) E('serviceValue', 'El valor del servicio no puede ser negativo');
  if (t.status === 'finalizado' && t.serviceValue === 0) W('serviceValue', 'Valor del servicio en $0: el margen no podrá calcularse');
  if (!ok(t.ivaRate) || t.ivaRate < 0 || t.ivaRate > 0.5) E('ivaRate', 'Alícuota de IVA inválida');
  for (const e of t.expenses) if (!ok(e.amount) || e.amount < 0) E('expenses', `Gasto inválido (${e.category})`);
  for (const c of EXPENSE_CATEGORIES) if (t.budget?.[c] != null && !(t.budget[c]! >= 0)) E('budget', 'Presupuesto inválido');
  // Superposición de horarios del mismo camión
  const s = operationInstant(t), e = t.actualArrival ?? t.plannedArrival;
  if (s && e && t.status !== 'cancelado') {
    const clash = d.trips.find(x => x.id !== t.id && x.truckId === t.truckId && x.status !== 'cancelado' && (() => {
      const s2 = operationInstant(x), e2 = x.actualArrival ?? x.plannedArrival; return s2 && e2 && s < e2 && s2 < e;
    })());
    if (clash) W('truckId', `El camión ya tiene el viaje ${clash.id} en ese horario`);
  }
  return { errors, warnings };
}

/** Posibles duplicados: mismo cliente, ruta, camión, día de salida e importe. */
export function findDuplicates(t: Trip, trips: Trip[], tz: string): Trip[] {
  const i = operationInstant(t); if (!i) return [];
  const day = localDate(i, tz);
  return trips.filter(x => x.id !== t.id && x.status !== 'cancelado' && x.clientId === t.clientId && x.truckId === t.truckId &&
    x.origin.trim().toLowerCase() === t.origin.trim().toLowerCase() && x.destination.trim().toLowerCase() === t.destination.trim().toLowerCase() &&
    (operationInstant(x) ? localDate(operationInstant(x)!, tz) === day : false) && (x.serviceValue ?? -1) === (t.serviceValue ?? -2));
}

export function validateInvoice(inv: Invoice, d: Pick<CompanyData, 'invoices' | 'trips' | 'payments' | 'settings'>, isNew: boolean): Validation {
  const errors: Issue[] = [], warnings: Issue[] = [];
  const E = (field: string, message: string) => errors.push({ field, message });
  if (!inv.number.trim()) E('number', 'Ingresá el número de factura');
  if (d.invoices.some(x => x.id !== inv.id && x.number.trim() === inv.number.trim() && x.clientId === inv.clientId)) E('number', 'Ya existe una factura con ese número para el cliente');
  if (!inv.issueDate) E('issueDate', 'Falta la fecha de emisión');
  if (!inv.dueDate) E('dueDate', 'Falta el vencimiento');
  if (inv.issueDate && inv.dueDate && inv.dueDate < inv.issueDate) E('dueDate', 'El vencimiento es anterior a la emisión');
  if (!inv.lines.length) E('lines', 'La factura necesita al menos un viaje');
  for (const l of inv.lines) {
    const trip = d.trips.find(t => t.id === l.tripId);
    if (!trip) { E('lines', `El viaje ${l.tripId} no existe`); continue; }
    if (trip.clientId !== inv.clientId) E('lines', `El viaje ${l.tripId} pertenece a otro cliente`);
    if (!ok(l.net) || l.net <= 0) E('lines', `Importe neto inválido para ${l.tripId}`);
    const others = d.invoices.filter(x => x.id !== inv.id).flatMap(x => x.lines).filter(x => x.tripId === l.tripId).reduce((s, x) => s + x.net, 0);
    const mine = inv.lines.filter(x => x.tripId === l.tripId).reduce((s, x) => s + x.net, 0);
    if (trip.serviceValue != null && others + mine > trip.serviceValue + 0.5)
      E('lines', `Facturar ${l.tripId} por ese importe superaría su valor de servicio y duplicaría ingresos`);
  }
  if (!ok(inv.ivaRate) || inv.ivaRate < 0 || inv.ivaRate > 0.5) E('ivaRate', 'IVA inválido');
  if (!isNew) {
    const t = invoiceTotals(inv, d.payments, '9999-12-31', 0);
    if (t.balance < -EPS) E('adjustments', 'Con este cambio los pagos superarían el total de la factura');
  }
  return { errors, warnings };
}

export function validatePayment(p: Payment, d: Pick<CompanyData, 'invoices' | 'payments' | 'settings'>): Validation {
  const errors: Issue[] = [], warnings: Issue[] = [];
  const inv = d.invoices.find(i => i.id === p.invoiceId);
  if (!inv) { errors.push({ field: 'invoiceId', message: 'Factura inexistente' }); return { errors, warnings }; }
  if (!ok(p.amount) || p.amount <= 0) errors.push({ field: 'amount', message: 'El importe debe ser mayor que 0' });
  if (!p.date) errors.push({ field: 'date', message: 'Falta la fecha de cobro' });
  if (p.date && p.date < inv.issueDate) warnings.push({ field: 'date', message: 'El cobro es anterior a la emisión de la factura' });
  const t = invoiceTotals(inv, d.payments.filter(x => x.id !== p.id), '9999-12-31', 0);
  if (ok(p.amount) && p.amount > t.balance + EPS) errors.push({ field: 'amount', message: `El importe supera el saldo pendiente (${t.balance.toFixed(2)})` });
  const dup = d.payments.find(x => x.id !== p.id && x.invoiceId === p.invoiceId && x.date === p.date && Math.abs(x.amount - p.amount) < EPS && (x.reference ?? '') === (p.reference ?? ''));
  if (dup) errors.push({ field: 'amount', message: 'Ya existe un cobro idéntico (misma factura, fecha, importe y referencia): posible duplicado' });
  return { errors, warnings };
}
