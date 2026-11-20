import { CompanyData, EXPENSE_CATEGORIES, EXPENSE_LABEL, MonthlyAnalysis, MonthlyFigures } from '../../shared/types';
import { fmtDate, fmtDateTime, fmtKm, fmtMoney, fmtNum, fmtPct, fmtPctChange, fmtPp, NA } from '../../shared/format';
import { pctChange, ppChange } from '../../shared/calc';
import { monthLabel } from '../../shared/time';
import { C, M, bullet, docHeader, finish, kpis, newDoc, para, section, table, toBuffer } from './kit';

export interface MonthlyPdfInput {
  data: CompanyData; figures: MonthlyFigures; analysis: MonthlyAnalysis; version: number; provisional: boolean; missing: string[]; generatedAt: string; preview?: boolean;
}
export async function renderMonthlyPdf(inp: MonthlyPdfInput): Promise<Buffer> {
  const { data, figures: f, analysis: a } = inp; const s = data.settings; const $ = (v: number | null, d = 0) => fmtMoney(v, s.currency, d);
  const cur = f.current, prev = f.previous;
  const doc = newDoc(`Informe mensual ${f.month}`, s.companyName);
  docHeader(doc, s, {
    title: 'Informe mensual', subtitle: `${monthLabel(f.month)}  ·  v${inp.version}  ·  Generado ${fmtDateTime(inp.generatedAt, s.timezone)}`,
    badges: [{ text: inp.provisional ? 'PROVISORIO' : 'COMPLETO', color: inp.provisional ? C.amber : C.accent }, ...(data.isDemo ? [{ text: 'DATOS DE DEMOSTRACIÓN', color: C.muted }] : [])],
  });
  para(doc, `Los viajes se asignan al mes de su salida real (o prevista, si no hay real) en la zona horaria ${f.timezone}. Ingresos: importe ${f.basis === 'net' ? 'neto (sin IVA)' : 'con IVA'}. Cobros medidos al ${f.cutoffDate.split('-').reverse().join('/')}.`, { color: C.muted, size: 8.5 });

  if (inp.provisional) {
    section(doc, 'Informe provisorio: datos pendientes', 60);
    inp.missing.forEach(m => bullet(doc, m, C.amber));
  }
  section(doc, 'Resultado del mes');
  kpis(doc, [
    { label: 'Ingresos', value: $(cur.revenue), sub: `${cur.trips} viajes finalizados` },
    { label: 'Costos', value: $(cur.totalCost) },
    { label: 'Resultado', value: $(cur.result), color: cur.result < 0 ? C.red : C.ink },
    { label: 'Margen', value: fmtPct(cur.marginPct), sub: `Objetivo ${fmtPct(s.marginTarget)}`, color: cur.marginPct != null && cur.marginPct < s.marginTarget ? C.amber : C.ink },
  ]);
  const row = (label: string, c: number | null, p: number | null | undefined, fmt: (v: number | null) => string, pp = false) => [
    label, fmt(c), prev ? fmt(p ?? null) : '—', prev ? (pp ? fmtPp(ppChange(c, p ?? null)) : fmtPctChange(pctChange(c, p ?? null))) : NA,
  ];
  table(doc, [{ label: 'Indicador', w: 34 }, { label: monthLabel(f.month), w: 22, align: 'right' }, { label: monthLabel(f.prevMonth), w: 22, align: 'right' }, { label: 'Variación', w: 20, align: 'right' }], [
    row('Ingresos', cur.revenue, prev?.revenue, $), row('Costo total', cur.totalCost, prev?.totalCost, $), row('Resultado', cur.result, prev?.result, $),
    row('Margen', cur.marginPct, prev?.marginPct, v => fmtPct(v), true),
    row('Viajes finalizados', cur.trips, prev?.trips, v => fmtNum(v)), row('Kilómetros', cur.km, prev?.km, v => fmtKm(v)),
    row('Costo por km', cur.costPerKm, prev?.costPerKm, $), row('Ingreso por km', cur.revenuePerKm, prev?.revenuePerKm, $),
  ]);
  para(doc, prev ? 'Las variaciones de importes e indicadores son porcentuales; el cambio del margen se expresa en puntos porcentuales (p. p.).' : `No hay datos comparables de ${monthLabel(f.prevMonth)}: no se calculan variaciones.`, { color: C.muted, size: 8.5 });

  section(doc, 'Costos desglosados', 120);
  table(doc, [{ label: 'Concepto', w: 40 }, { label: 'Importe', w: 25, align: 'right' }, { label: '% del costo', w: 18, align: 'right' }, { label: 'Mes anterior', w: 25, align: 'right' }], [
    ...EXPENSE_CATEGORIES.map(k => [EXPENSE_LABEL[k], $(cur.direct[k]), fmtPct(cur.totalCost ? (cur.direct[k] / cur.totalCost) * 100 : null), prev ? $(prev.direct[k]) : '—']),
    ['Costos operativos asignados', $(cur.allocated), fmtPct(cur.totalCost ? (cur.allocated / cur.totalCost) * 100 : null), prev ? $(prev.allocated) : '—'],
    ['Costo total', $(cur.totalCost), '100,0 %', prev ? $(prev.totalCost) : '—'],
  ], { totalRows: [6] });
  para(doc, `Estimaciones de uso de la flota en el mes (mantenimiento, neumáticos y depreciación económica): ${$(cur.estimates)}. Son estimaciones y no están incluidas en los costos de arriba.`, { color: C.muted, size: 8.5 });

  section(doc, 'Resultados por ruta', 110);
  table(doc, [{ label: 'Ruta', w: 34 }, { label: 'Viajes', w: 11, align: 'right' }, { label: 'Ingresos', w: 22, align: 'right' }, { label: 'Resultado', w: 22, align: 'right' }, { label: 'Margen', w: 14, align: 'right' }, { label: 'Costo/km', w: 17, align: 'right' }],
    f.byRoute.map(r => [r.route, String(r.trips), $(r.revenue), $(r.result), { t: fmtPct(r.marginPct), color: r.marginPct != null && r.marginPct < s.marginTarget ? C.amber : C.ink }, $(r.costPerKm)]));
  section(doc, 'Resultados por camión', 110);
  table(doc, [{ label: 'Camión', w: 22 }, { label: 'Viajes', w: 11, align: 'right' }, { label: 'Km', w: 16, align: 'right' }, { label: 'Ingresos', w: 22, align: 'right' }, { label: 'Resultado', w: 22, align: 'right' }, { label: 'Margen', w: 14, align: 'right' }, { label: 'Costo/km', w: 17, align: 'right' }],
    f.byTruck.map(r => [r.truck, String(r.trips), fmtNum(r.km), $(r.revenue), $(r.result), { t: fmtPct(r.marginPct), color: r.marginPct != null && r.marginPct < s.marginTarget ? C.amber : C.ink }, $(r.costPerKm)]));

  section(doc, 'Pendiente de cobro al cierre', 120);
  const r = f.receivables;
  table(doc, [{ label: 'Estado al cierre', w: 50 }, { label: 'Importe (con IVA)', w: 30, align: 'right' }], [
    ['Vencido', { t: $(r.overdue), color: r.overdue > 0 ? C.red : C.ink }], ['Por vencer (próximos ' + s.dueSoonDays + ' días)', $(r.dueSoon)], ['Vigente', $(r.current)], ['Total pendiente', $(r.pending)],
  ], { totalRows: [3] });
  para(doc, `Incluye ${$(r.fromPreviousMonths)} de facturas emitidas antes del mes que seguían impagas al cierre. Facturas abiertas: ${r.invoicesOpen}.`, { size: 9 });
  if (r.byClient.length) table(doc, [{ label: 'Cliente', w: 50 }, { label: 'Pendiente', w: 25, align: 'right' }, { label: 'Vencido', w: 25, align: 'right' }], r.byClient.slice(0, 6).map(c => [c.client, $(c.pending), c.overdue > 0 ? { t: $(c.overdue), color: C.red } : $(0)]));

  if (f.quoted) {
    section(doc, 'Viajes cotizados: presupuesto vs. real', 100); const q = f.quoted;
    table(doc, [{ label: 'Indicador', w: 40 }, { label: 'Previsto', w: 25, align: 'right' }, { label: 'Real', w: 25, align: 'right' }, { label: 'Diferencia', w: 25, align: 'right' }], [
      ['Ingresos', $(q.plannedRevenue), $(q.actualRevenue), $(q.actualRevenue - q.plannedRevenue)], ['Resultado', $(q.plannedResult), $(q.actualResult), $(q.actualResult - q.plannedResult)]]);
    para(doc, `${q.trips} viaje(s) con presupuesto aceptado${q.incomplete ? `; ${q.incomplete} con datos incompletos (comparación provisoria)` : ''}.`, { color: C.muted, size: 8.5 });
  }
  if (f.deviations.length) {
    section(doc, 'Desvíos de costo más relevantes', 100);
    table(doc, [{ label: 'Viaje', w: 22 }, { label: 'Ruta', w: 30 }, { label: 'Presupuestado', w: 22, align: 'right' }, { label: 'Real', w: 22, align: 'right' }, { label: 'Desvío', w: 22, align: 'right' }, { label: '%', w: 14, align: 'right' }],
      f.deviations.map(x => [x.tripId, x.route, $(x.planned), $(x.actual), { t: $(x.diff), color: x.reliable ? (x.diff > 0 ? C.red : C.accent) : C.amber }, x.pct == null ? 'No aplica' : fmtPctChange(x.pct)]));
    para(doc, 'Los desvíos señalan diferencias comprobadas; sus causas deben surgir de los registros u observaciones de los usuarios. En ámbar: comparación provisoria.', { color: C.muted, size: 8.5 });
  }
  if (f.docsAttention.length) { section(doc, 'Documentación que requiere atención', 80); table(doc, [{ label: 'Titular', w: 30 }, { label: 'Documento', w: 40 }, { label: 'Estado', w: 30 }], f.docsAttention.slice(0, 12).map(x => [x.owner, x.type, { t: x.status === 'vencido' ? 'Vencido' : x.status === 'pendiente' ? 'Pendiente de cargar' : `Vence en ${x.days} días`, color: x.status === 'vencido' ? C.red : C.amber }])); para(doc, 'Tener documentos cargados no implica por sí solo que la operación esté habilitada.', { color: C.muted, size: 8.5 }); }
  if (f.maintenanceDue.length) { section(doc, 'Mantenimientos próximos o vencidos', 60); f.maintenanceDue.forEach(x => bullet(doc, `${x.truck}: ${x.service} (${x.status === 'vencido' ? 'vencido' : 'próximo'})`, x.status === 'vencido' ? C.red : C.amber)); }
  if (f.collectionPromises.length) { section(doc, 'Compromisos de pago pendientes', 60); f.collectionPromises.forEach(x => bullet(doc, `${x.client}: ${fmtDate(x.date)}${x.amount ? ' · ' + $(x.amount) : ''}`)); }
  section(doc, 'Qué muestran los datos', 80);
  a.facts.forEach(x => bullet(doc, x));
  if (a.hypotheses.length) { section(doc, 'Posibles causas a investigar (no comprobadas)', 60); para(doc, 'Estas son hipótesis de revisión; el sistema no las verifica con los datos cargados.', { color: C.muted, size: 8.5 }); a.hypotheses.forEach(x => bullet(doc, x, C.amber)); }
  section(doc, 'Tres prioridades de revisión', 100);
  a.priorities.forEach((p, i) => { para(doc, `${i + 1}. ${p.title}`, { font: 'S' }); para(doc, p.detail, { indent: 14, color: C.muted }); });
  para(doc, 'Análisis generado con reglas y plantillas sobre las cifras calculadas por el sistema.', { color: C.muted, size: 8 });

  finish(doc, `${s.companyName}  ·  Informe mensual ${f.month}  ·  v${inp.version}${inp.provisional ? '  ·  PROVISORIO' : ''}${data.isDemo ? '  ·  Datos de demostración' : ''}`, inp.preview ? 'VISTA PREVIA' : undefined);
  void M;
  return toBuffer(doc);
}
