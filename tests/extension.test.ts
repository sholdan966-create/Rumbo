import { describe, expect, it } from 'vitest';
import { quoteCalc, validateQuote, emptyCosts, snapshotFromQuote, suggestCosts, quoteStatus } from '../src/shared/quote';
import { budgetVsActual } from '../src/shared/budget';
import { computeTrips } from '../src/shared/calc';
import { documentRows, documentStatus, alertThreshold } from '../src/shared/documents';
import { agingBuckets, clientAccount } from '../src/shared/account';
import { data, settings, trip, truck } from './fixtures';
import { Quote } from '../src/shared/types';

const quote = (over: Partial<Quote> = {}): Quote => {
  const costs = emptyCosts(); costs.fuel = { amount: 300000, included: true, source: 'x' }; costs.tolls.included = false; costs.driverPay.included = false; costs.perDiem.included = false; costs.allocated.included = false;
  return { id: 'Q', number: 'COT-1', clientId: 'C1', origin: 'Rosario', destination: 'Córdoba', truckId: 'T1', vehicleType: '', kmLoaded: 400, kmEmpty: 400, plannedHours: 9, costs, marginTarget: 25, priceNet: null, ivaRate: 0.21, validUntil: '2026-12-31', notes: '', terms: '', status: 'borrador', shares: [], createdAt: '', updatedAt: '', createdBy: 'x', ...over };
};
const NOW = new Date('2026-11-20T15:00:00Z');

describe('cotizador', () => {
  it('ejemplo de verificación: costo $300.000 y margen 25 % => precio sugerido $400.000 antes de impuestos', () => {
    const c = quoteCalc(quote());
    expect(c.cost).toBe(300000); expect(c.suggestedNet).toBe(400000); expect(c.result).toBe(100000); expect(c.marginPct).toBeCloseTo(25);
    expect(c.iva).toBe(84000); expect(c.total).toBe(484000); // impuestos por separado
  });
  it('modificar el precio recalcula el margen resultante', () => {
    const c = quoteCalc(quote({ priceNet: 360000 })); expect(c.result).toBe(60000); expect(c.marginPct).toBeCloseTo(16.667, 2);
    expect(quoteCalc(quote({ priceNet: 250000 })).marginPct).toBeCloseTo(-20);
  });
  it('rechaza margen objetivo >= 100 % o negativo', () => {
    expect(quoteCalc(quote({ marginTarget: 100 })).error).toBeTruthy(); expect(quoteCalc(quote({ marginTarget: 120 })).suggestedNet).toBeNull(); expect(quoteCalc(quote({ marginTarget: -1 })).error).toBeTruthy();
    expect(validateQuote(quote({ marginTarget: 100 }), data()).some(e => e.includes('menor que 100'))).toBe(true);
  });
  it('costos cero: precio sugerido 0 y margen No disponible', () => {
    const q = quote(); q.costs.fuel.amount = 0; const c = quoteCalc(q); expect(c.suggestedNet).toBe(0); expect(c.marginPct).toBeNull();
  });
  it('solo suman los costos incluidos', () => { const q = quote(); q.costs.tolls = { amount: 50000, included: true, source: '' }; expect(quoteCalc(q).cost).toBe(350000); q.costs.tolls.included = false; expect(quoteCalc(q).cost).toBe(300000); });
  it('estado vencida se deriva de la vigencia', () => { expect(quoteStatus({ status: 'enviada', validUntil: '2026-11-01' }, '2026-11-20')).toBe('vencida'); expect(quoteStatus({ status: 'aceptada', validUntil: '2026-11-01' }, '2026-11-20')).toBe('aceptada'); });
  it('sugiere combustible con parámetros del vehículo y explica el origen', () => {
    const d = data({ trucks: [truck('T1', { params: { ...truck().params, fuelLPer100km: 40 } })] });
    const c = suggestCosts(d, { truckId: 'T1', origin: 'X', destination: 'Y', kmLoaded: 500, kmEmpty: 500 }, NOW);
    expect(c.fuel.amount).toBe(Math.round(1000 * 40 / 100 * 1700)); expect(c.fuel.source).toContain('Parámetros');
  });
  it('sin dato queda en 0 con origen "Sin dato"', () => { const c = suggestCosts(data(), { truckId: null, origin: 'A', destination: 'B', kmLoaded: 10, kmEmpty: 10 }, NOW); expect(c.tolls.amount).toBe(0); expect(c.tolls.source).toContain('Sin dato'); });
});

describe('presupuesto vs real', () => {
  const calcOf = (t: ReturnType<typeof trip>, d = data({ trips: [t] })) => computeTrips({ settings: d.settings, trucks: d.trucks, trips: d.trips, invoices: d.invoices, payments: d.payments, now: NOW }).get(t.id)!;
  const withSnap = (over = {}) => { const q = quote(); q.costs.tolls = { amount: 60000, included: true, source: '' }; q.costs.driverPay = { amount: 100000, included: true, source: '' }; q.costs.perDiem = { amount: 0, included: true, source: '' }; q.costs.other.included = false; q.costs.allocated = { amount: 0, included: false, source: '' }; q.priceNet = 1_000_000;
    return trip('V', { budgetSnapshot: snapshotFromQuote(q, data(), '2026-10-01T00:00:00Z', 'x'), ...over }); };
  it('desvíos de costo, ingreso, resultado y margen (p. p.)', () => {
    const t = withSnap(); const b = budgetVsActual(t, calcOf(t))!;
    const fuel = b.rows.find(r => r.key === 'fuel')!; expect(fuel.planned).toBe(300000); expect(fuel.actual).toBe(300000); expect(fuel.diff).toBe(0);
    const tolls = b.rows.find(r => r.key === 'tolls')!; expect(tolls.diff).toBe(-10000); expect(tolls.pct).toBeCloseTo(-16.667, 2);
    expect(b.revenue.diff).toBe(0); expect(b.margin.unit).toBe('pct'); expect(b.reliable).toBe(true);
  });
  it('presupuesto cero: diferencia en dinero y porcentaje No aplica', () => { const t = withSnap(); const r = budgetVsActual(t, calcOf(t))!.rows.find(x => x.key === 'perDiem')!; expect(r.planned).toBe(0); expect(r.diff).toBe(50000); expect(r.pct).toBeNull(); expect(r.pctNA).toBe(true); expect(r.tone).toBe('desfavorable'); });
  it('un costo menor no es ahorro si los registros están incompletos', () => {
    const t = withSnap({ expenses: [{ id: 'a', category: 'fuel', amount: 200000 }], expenseConfirmed: {} }); const b = budgetVsActual(t, calcOf(t))!;
    expect(b.reliable).toBe(false); expect(b.rows.find(r => r.key === 'fuel')!.tone).toBe('sin_confirmar');
  });
  it('costo mayor = desfavorable; menor con datos completos = favorable', () => {
    const hi = withSnap(); hi.expenses[0].amount = 350000; expect(budgetVsActual(hi, calcOf(hi))!.rows.find(r => r.key === 'fuel')!.tone).toBe('desfavorable');
    const lo = withSnap(); lo.expenses[0].amount = 250000; expect(budgetVsActual(lo, calcOf(lo))!.rows.find(r => r.key === 'fuel')!.tone).toBe('favorable');
  });
  it('el presupuesto histórico no cambia al modificar parámetros del vehículo o tarifas', () => {
    const t = withSnap(); const before = JSON.stringify(t.budgetSnapshot); const d = data({ trips: [t], trucks: [truck('T1', { params: { ...truck().params, maintenancePerKm: 999 }, monthlyFixedCosts: [] })] });
    d.settings.fuelPricePerLiter = 9999; calcOf(t, d); expect(JSON.stringify(t.budgetSnapshot)).toBe(before);
  });
  it('gasto pendiente de revisión no suma al costo; aprobarlo no lo duplica', () => {
    const t = trip('P'); t.expenses.push({ id: 'p1', category: 'other', amount: 10000, status: 'pendiente_revision' });
    const c1 = calcOf(t); expect(c1.directTotal).toBe(500000); expect(c1.pendingReview.amount).toBe(10000); expect(c1.complete).toBe(false); expect(c1.resultIfApproved).toBe(c1.result! - 10000);
    t.expenses[4].status = 'aprobado'; const c2 = calcOf(t); expect(c2.directTotal).toBe(510000); expect(t.expenses.length).toBe(5); expect(c2.complete).toBe(true);
    t.expenses[4].status = 'rechazado'; expect(calcOf(t).directTotal).toBe(500000);
  });
});

describe('documentos', () => {
  const d = data({ documents: [] });
  it('estados vigente / próximo / vencido / sin vencimiento / pendiente', () => {
    const type = d.settings.documentTypes[0]; const mk = (exp: string | null) => ({ id: 'x', typeId: 'seguro', ownerType: 'vehiculo' as const, ownerId: 'T1', identifier: 'a', issueDate: null, expiryDate: exp, fileId: null, notes: '', replacedBy: null, supersedes: null, createdAt: '', createdBy: '' });
    expect(documentStatus(mk('2027-03-01'), type, '2026-11-20', [30, 15, 7]).status).toBe('vigente');
    expect(documentStatus(mk('2026-12-10'), type, '2026-11-20', [30, 15, 7]).status).toBe('proximo');
    expect(documentStatus(mk('2026-11-19'), type, '2026-11-20', [30, 15, 7]).status).toBe('vencido');
    expect(documentStatus(mk(null), type, '2026-11-20', [30]).status).toBe('sin_vencimiento'); expect(documentStatus(null, type, '2026-11-20', [30]).status).toBe('pendiente');
  });
  it('requeridos faltantes se detectan por configuración; los reemplazados no cuentan como vigentes', () => {
    const rows = documentRows(d, '2026-11-20'); expect(rows.filter(r => r.status === 'pendiente').length).toBe(1);
    const dd = data({ documents: [{ id: 'old', typeId: 'seguro', ownerType: 'vehiculo', ownerId: 'T1', identifier: 'v1', issueDate: null, expiryDate: '2026-01-01', fileId: null, notes: '', replacedBy: 'new', supersedes: null, createdAt: '', createdBy: '' }, { id: 'new', typeId: 'seguro', ownerType: 'vehiculo', ownerId: 'T1', identifier: 'v2', issueDate: null, expiryDate: '2027-01-01', fileId: null, notes: '', replacedBy: null, supersedes: 'old', createdAt: '', createdBy: '' }] });
    const r2 = documentRows(dd, '2026-11-20'); expect(r2.length).toBe(1); expect(r2[0].doc!.id).toBe('new'); expect(r2[0].status).toBe('vigente');
  });
  it('umbral de aviso', () => { expect(alertThreshold(12, [30, 15, 7])).toBe(15); expect(alertThreshold(5, [30, 15, 7])).toBe(7); expect(alertThreshold(40, [30, 15, 7])).toBeNull(); });
});

describe('cuenta del cliente', () => {
  const inv = (id: string, due: string, net: number) => ({ id, number: id, clientId: 'C1', issueDate: '2026-08-01', dueDate: due, ivaRate: 0, lines: [{ tripId: 'V', net }], adjustments: [] });
  const d = data({ settings: { ...settings }, invoices: [inv('A', '2026-11-25', 100), inv('B', '2026-11-05', 200), inv('C', '2026-09-01', 300), inv('D', '2026-06-01', 400)], payments: [{ id: 'p', invoiceId: 'D', date: '2026-11-01', amount: 150, method: 'x' }] });
  it('antigüedad en tramos configurables', () => {
    const a = agingBuckets(d, 'C1', '2026-11-20'); expect(a.map(x => x.amount)).toEqual([100, 200, 0, 300, 250]); expect(a[0].label).toBe('No vencido');
  });
  it('saldos del cliente reutilizan facturas y pagos (sin saldos propios)', () => {
    const acc = clientAccount(d, 'C1', '2026-11-20', '2026-11-01', '2026-11-30'); expect(acc.pending).toBe(850); expect(acc.overdue).toBe(750); expect(acc.upcoming.length).toBe(1);
    expect(clientAccount(d, 'C1', '2026-10-30', '2026-10-01', '2026-10-31').pending).toBe(1000); // al consultar una fecha anterior el cobro de noviembre no existía
  });
});
