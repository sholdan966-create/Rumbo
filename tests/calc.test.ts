import { describe, expect, it } from 'vitest';
import { aggregate, allocateFixedCosts, buildMonthlyFigures, computeTrips, estimateUsage, invoiceTotals, pctChange, ppChange, receivablesAt, serviceStatus, tripDataVersion, categoryAmount } from '../src/shared/calc';
import { localInputToIso, localMonth, isoToLocalInput, prevMonth } from '../src/shared/time';
import { fmtMoney, fmtPp, NA } from '../src/shared/format';
import { validateInvoice, validatePayment, validateTrip, findDuplicates } from '../src/shared/validate';
import { parseCsv, parseNumber, autoMap, mapRows } from '../src/shared/import';
import { buildAnalysis } from '../src/shared/analysis';
import { data, settings, trip, truck } from './fixtures';
import { Invoice } from '../src/shared/types';

const NOW = new Date('2026-11-20T15:00:00Z');
const calc = (d = data(), now = NOW) => computeTrips({ settings: d.settings, trucks: d.trucks, trips: d.trips, invoices: d.invoices, payments: d.payments, now });

describe('cálculo por viaje', () => {
  it('km totales, costos, resultado, margen, costo/km e ingreso/km', () => {
    const d = data({ trips: [trip('V1')] });
    const c = calc(d).get('V1')!;
    expect(c.kmTotal).toBe(800);
    expect(c.directTotal).toBe(500_000);
    // único viaje del mes (octubre cerrado): se asigna todo el costo mensual del camión
    expect(c.allocated).toBeCloseTo(1_000_000);
    expect(c.totalCost).toBeCloseTo(1_500_000);
    expect(c.result).toBeCloseTo(-500_000);
    expect(c.marginPct).toBeCloseTo(-50);
    expect(c.costPerKm).toBeCloseTo(1875);
    expect(c.revenuePerKm).toBeCloseTo(1250);
    expect(c.complete).toBe(true);
  });
  it('ingresos cero o km cero devuelven No disponible (null), nunca NaN/Infinity', () => {
    const d = data({ trips: [trip('A', { serviceValue: 0 }), trip('B', { kmLoaded: 0, kmEmpty: 0 })] });
    const m = calc(d);
    expect(m.get('A')!.marginPct).toBeNull();
    expect(m.get('B')!.costPerKm).toBeNull();
    expect(m.get('B')!.revenuePerKm).toBeNull();
    expect(fmtMoney(m.get('B')!.costPerKm)).toBe(NA);
  });
  it('distingue gasto pendiente de gasto confirmado en $0', () => {
    const t = trip('V', { expenses: [], expenseConfirmed: { fuel: true } });
    expect(categoryAmount(t, 'fuel')).toBe(0);
    expect(categoryAmount(t, 'tolls')).toBeNull();
    const c = calc(data({ trips: [t] })).get('V')!;
    expect(c.pendingCategories).toEqual(['tolls', 'driverPay', 'perDiem']);
    expect(c.complete).toBe(false);
    expect(c.missing.join()).toContain('Gastos sin registrar');
  });
  it('km vacíos pendientes => km total No disponible', () => {
    const c = calc(data({ trips: [trip('V', { kmEmpty: null })] })).get('V')!;
    expect(c.kmTotal).toBeNull(); expect(c.costPerKm).toBeNull();
    expect(c.missing).toContain('Kilómetros vacíos');
  });
  it('base de rentabilidad bruta usa importe con IVA', () => {
    const d = data({ settings: { ...settings, profitabilityBasis: 'gross' }, trips: [trip('V')] });
    expect(calc(d).get('V')!.revenue).toBeCloseTo(1_210_000);
  });
  it('viaje no finalizado no tiene resultado', () => {
    const c = calc(data({ trips: [trip('V', { status: 'en_curso' })] })).get('V')!;
    expect(c.result).toBeNull(); expect(c.totalCost).toBeNull();
  });
});

describe('asignación de costos mensuales', () => {
  it('reparte por km y cada costo se cuenta una sola vez', () => {
    const trips = [trip('A', { kmLoaded: 100, kmEmpty: 100 }), trip('B', { kmLoaded: 300, kmEmpty: 300, actualDeparture: '2026-10-12T09:00:00Z', actualArrival: '2026-10-12T20:00:00Z' })];
    const { alloc } = allocateFixedCosts([truck()], trips, settings.timezone, NOW);
    expect(alloc.get('A')).toBeCloseTo(250_000);
    expect(alloc.get('B')).toBeCloseTo(750_000);
    expect([...alloc.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1_000_000);
  });
  it('camión sin km queda como no asignado', () => {
    const { alloc, unallocated } = allocateFixedCosts([truck()], [trip('A', { kmLoaded: 0, kmEmpty: 0 })], settings.timezone, NOW);
    expect(alloc.size).toBe(0); expect(unallocated[0].amount).toBe(1_000_000);
  });
  it('en el mes en curso solo se asigna la fracción transcurrida', () => {
    const t = trip('A', { actualDeparture: '2026-11-03T09:00:00Z', actualArrival: '2026-11-03T20:00:00Z' });
    const { alloc } = allocateFixedCosts([truck()], [t], settings.timezone, NOW); // día 20 de 30
    expect(alloc.get('A')).toBeCloseTo((1_000_000 * 20) / 30);
  });
});

describe('agregación', () => {
  it('el margen agregado usa sumas, no promedio de porcentajes', () => {
    const d = data({ trips: [
      trip('A', { serviceValue: 100, kmLoaded: 10, kmEmpty: 0, expenses: [{ id: 'x', category: 'fuel', amount: 50 }], expenseConfirmed: { tolls: true, driverPay: true, perDiem: true, other: true } }),
      trip('B', { serviceValue: 900, kmLoaded: 10, kmEmpty: 0, expenses: [{ id: 'y', category: 'fuel', amount: 100 }], expenseConfirmed: { tolls: true, driverPay: true, perDiem: true, other: true } }),
    ], trucks: [truck('T1', { monthlyFixedCosts: [] })] });
    const m = calc(d); const a = aggregate([...m.values()]);
    // A: 50%, B: ~88,9% ; promedio simple = 69,4% ; ponderado = (1000-150)/1000 = 85%
    expect(a.marginPct).toBeCloseTo(85);
    expect(a.costPerKm).toBeCloseTo(150 / 20);
  });
  it('variación porcentual vs puntos porcentuales', () => {
    expect(pctChange(110, 100)).toBeCloseTo(10);
    expect(pctChange(5, 0)).toBeNull();
    expect(ppChange(25, 20)).toBe(5);
    expect(fmtPp(-2.5)).toContain('p. p.');
  });
});

describe('facturas y cobros', () => {
  const inv: Invoice = { id: 'I1', number: '1', clientId: 'C1', issueDate: '2026-10-01', dueDate: '2026-10-31', ivaRate: 0.21, lines: [{ tripId: 'V1', net: 1000 }], adjustments: [] };
  it('total = neto + IVA; cobro parcial; saldo', () => {
    const pays = [{ id: 'P1', invoiceId: 'I1', date: '2026-10-20', amount: 500, method: 'x' }];
    const t = invoiceTotals(inv, pays, '2026-11-20', 7);
    expect(t.total).toBeCloseTo(1210); expect(t.balance).toBeCloseTo(710); expect(t.status).toBe('vencida'); expect(t.partial).toBe(true);
  });
  it('nota de crédito ajusta el total', () => {
    const t = invoiceTotals({ ...inv, adjustments: [{ id: 'a', date: '2026-10-15', amount: -210, reason: 'NC' }] }, [], '2026-10-20', 7);
    expect(t.adjusted).toBeCloseTo(1000); expect(t.status).toBe('por_vencer'.replace('por_vencer', 'vigente'));
  });
  it('por vencer y pagada', () => {
    expect(invoiceTotals(inv, [], '2026-10-27', 7).status).toBe('por_vencer');
    expect(invoiceTotals(inv, [{ id: 'P', invoiceId: 'I1', date: '2026-10-05', amount: 1210, method: 'x' }], '2026-11-20', 7).status).toBe('pagada');
  });
  it('saldo al cierre incluye facturas anteriores impagas y respeta la fecha de cada cobro', () => {
    const old: Invoice = { ...inv, id: 'I0', issueDate: '2026-08-01', dueDate: '2026-08-31' };
    const pays = [{ id: 'P', invoiceId: 'I1', date: '2026-11-05', amount: 1210, method: 'x' }];
    const r = receivablesAt([old, inv], pays, [{ id: 'C1', name: 'C' }], '2026-10-31', 7, '2026-10-01');
    expect(r.pending).toBeCloseTo(2420); // el cobro de noviembre todavía no existía al cierre
    expect(r.fromPreviousMonths).toBeCloseTo(1210); expect(r.overdue).toBeCloseTo(1210);
  });
  it('rechaza cobros que exceden el saldo, duplicados y facturación que duplicaría ingresos', () => {
    const d = data({ trips: [trip('V1', { serviceValue: 1000 })], invoices: [inv], payments: [{ id: 'P1', invoiceId: 'I1', date: '2026-10-20', amount: 500, method: 'x' }] });
    expect(validatePayment({ id: 'P2', invoiceId: 'I1', date: '2026-10-21', amount: 800, method: 'x' }, d).errors.length).toBe(1);
    expect(validatePayment({ id: 'P3', invoiceId: 'I1', date: '2026-10-20', amount: 500, method: 'x' }, d).errors[0].message).toContain('duplicado');
    expect(validatePayment({ id: 'P4', invoiceId: 'I1', date: '2026-10-22', amount: 700, method: 'x' }, d).errors.length).toBe(0);
    const second: Invoice = { ...inv, id: 'I2', number: '2' };
    expect(validateInvoice(second, d, true).errors.some(e => e.message.includes('duplicaría'))).toBe(true);
  });
});

describe('fechas, zona horaria y noches', () => {
  it('viaje nocturno se asigna al mes de salida (cambio de mes)', () => {
    // sale 31/10 22:00 ART (= 01/11 01:00 UTC) y llega 01/11 06:00 ART
    const dep = localInputToIso('2026-10-31T22:00', settings.timezone)!;
    expect(dep).toBe('2026-11-01T01:00:00.000Z');
    expect(localMonth(dep, settings.timezone)).toBe('2026-10');
    expect(isoToLocalInput(dep, settings.timezone)).toBe('2026-10-31T22:00');
    const t = trip('N', { actualDeparture: dep, actualArrival: localInputToIso('2026-11-01T06:00', settings.timezone)! });
    const c = calc(data({ trips: [t] })).get('N')!;
    expect(c.durationMin).toBe(8 * 60);
    const f = buildMonthlyFigures(data({ trips: [t] }), '2026-10', NOW);
    expect(f.current.trips).toBe(1);
    expect(buildMonthlyFigures(data({ trips: [t] }), '2026-11', NOW).current.trips).toBe(0);
  });
  it('rechaza fechas inexistentes', () => { expect(localInputToIso('2026-02-31T10:00', settings.timezone)).toBeNull(); });
  it('prevMonth cruza el año', () => { expect(prevMonth('2026-01')).toBe('2025-12'); });
  it('tiempo de conducción solo con paradas registradas', () => {
    const t = trip('S', { stops: [{ id: 's', start: '2026-10-10T12:00:00Z', end: '2026-10-10T13:00:00Z' }] });
    const c = calc(data({ trips: [t, trip('T')] }));
    expect(c.get('S')!.drivingMin).toBe(8 * 60); expect(c.get('T')!.drivingMin).toBeNull();
  });
});

describe('estimaciones de uso', () => {
  it('aplica las fórmulas del modelo', () => {
    const e = estimateUsage(truck().params, 800)!;
    expect(e.maintenance).toBe(120_000); expect(e.tires).toBeCloseTo(80_000); expect(e.depreciation).toBeCloseTo(80_000);
  });
  it('sin parámetros válidos no estima', () => {
    expect(estimateUsage({ ...truck().params, tireLifeKm: 0 }, 100)).toBeNull();
    expect(estimateUsage({ ...truck().params, tireLifeKm: null }, 100)).toBeNull();
  });
  it('no se suman al costo total del viaje', () => {
    const c = calc(data({ trips: [trip('V')] })).get('V')!;
    expect(c.totalCost).toBeCloseTo(c.directTotal + c.allocated!);
    expect(c.economicResult).toBeCloseTo(c.result! - c.estimates!.total);
  });
});

describe('mantenimiento', () => {
  const plan = { id: 'p', name: 'Servicio', intervalKm: 30000, intervalDays: null, lastKm: 100000, lastDate: null, alertBeforeKm: 3000, alertBeforeDays: null, source: 'Configurado' };
  it('estados por kilometraje', () => {
    expect(serviceStatus(plan, 110000, '2026-11-20').status).toBe('al_dia');
    expect(serviceStatus(plan, 127500, '2026-11-20').status).toBe('proximo');
    expect(serviceStatus(plan, 131000, '2026-11-20').status).toBe('vencido');
    expect(serviceStatus({ ...plan, intervalKm: null }, 110000, '2026-11-20').status).toBe('sin_datos');
  });
  it('por fecha', () => {
    const p = { ...plan, intervalKm: null, intervalDays: 180, lastDate: '2026-05-01', alertBeforeDays: 30 };
    expect(serviceStatus(p, null, '2026-10-20').status).toBe('proximo');
    expect(serviceStatus(p, null, '2026-11-20').status).toBe('vencido');
  });
});

describe('versionado de datos del PDF', () => {
  it('la versión cambia solo si cambian datos del informe', () => {
    const d = data({ trips: [trip('V')] });
    const v1 = tripDataVersion(d.trips[0], d);
    expect(tripDataVersion({ ...d.trips[0], updatedAt: 'otro' }, d)).toBe(v1);
    expect(tripDataVersion({ ...d.trips[0], notes: 'nuevo' }, d)).not.toBe(v1);
  });
});

describe('validación de viajes y duplicados', () => {
  it('detecta errores de fechas y odómetro', () => {
    const d = data();
    const v = validateTrip(trip('X', { actualArrival: '2026-10-10T08:00:00Z', odometerStart: 500, odometerEnd: 400, kmLoaded: -1 }), d, true);
    const fields = v.errors.map(e => e.field);
    expect(fields).toEqual(expect.arrayContaining(['actualArrival', 'odometerEnd', 'kmLoaded']));
  });
  it('detecta posibles duplicados', () => {
    const a = trip('A'); const b = trip('B');
    expect(findDuplicates(b, [a], settings.timezone).length).toBe(1);
    expect(findDuplicates(trip('C', { serviceValue: 5 }), [a], settings.timezone).length).toBe(0);
  });
});

describe('importación', () => {
  it('parsea CSV con ; , comillas y números argentinos', () => {
    const rows = parseCsv('a;b\n"x;y";"1.234,50"\n');
    expect(rows[1]).toEqual(['x;y', '1.234,50']);
    expect(parseNumber('1.234,50')).toBe(1234.5); expect(parseNumber('1.500')).toBe(1500); expect(parseNumber('abc')).toBeUndefined(); expect(parseNumber('')).toBeNull();
  });
  it('acepta, rechaza y detecta duplicados', () => {
    const d = data({ trips: [trip('V-2026-0001')] });
    const csv = parseCsv([
      'cliente;origen;destino;camion;chofer;estado;salida_real;llegada_real;km_carga;km_vacio;valor_servicio;combustible;peajes;chofer_pago;viaticos',
      'Cliente 1;Rosario;Córdoba;Camión T1;Chofer 1;finalizado;10/10/2026 09:00;10/10/2026 18:00;400;400;1000000;300000;50000;100000;50000', // duplicado
      'Cliente 1;Rosario;Mendoza;Camión T1;Chofer 1;finalizado;20/10/2026 09:00;20/10/2026 18:00;900;900;2000000;;0;300000;50000',
      'Cliente 1;Rosario;Mendoza;Camión T9;Chofer 1;finalizado;25/10/2026 09:00;;x;;2000000;;;;',
    ].join('\n'));
    const r = mapRows(csv, autoMap(csv[0]), d, '2026-11-20T00:00:00Z', ex => `V-2026-${String(ex.length + 1).padStart(4, '0')}`);
    expect(r.accepted).toBe(1); expect(r.rejected).toBe(2); expect(r.duplicates).toBe(1);
    const ok = r.rows.find(x => x.trip)!.trip!;
    expect(categoryAmount(ok, 'fuel')).toBeNull(); expect(categoryAmount(ok, 'tolls')).toBe(0);
    expect(r.rows[2].errors.join()).toContain('no existe en la flota');
  });
});

describe('informe mensual', () => {
  it('cierre mensual con comparación, cobros y análisis de reglas', () => {
    const d = data({
      trips: [trip('A'), trip('P', { actualDeparture: '2026-09-10T09:00:00Z', actualArrival: '2026-09-10T18:00:00Z' })],
      invoices: [{ id: 'I', number: '1', clientId: 'C1', issueDate: '2026-09-15', dueDate: '2026-10-15', ivaRate: 0.21, lines: [{ tripId: 'P', net: 1_000_000 }], adjustments: [] }],
    });
    const f = buildMonthlyFigures(d, '2026-10', NOW);
    expect(f.previous?.trips).toBe(1);
    expect(f.receivables.overdue).toBeCloseTo(1_210_000); expect(f.receivables.fromPreviousMonths).toBeCloseTo(1_210_000);
    expect(f.unbilledTrips).toBe(1);
    const a = buildAnalysis(f, settings);
    expect(a.priorities.length).toBe(3);
    expect(a.facts.join(' ')).toContain('p. p.');
  });
  it('sin mes anterior comparable omite variaciones', () => {
    const f = buildMonthlyFigures(data({ trips: [trip('A')] }), '2026-10', NOW);
    expect(f.previous).toBeNull();
  });
});
