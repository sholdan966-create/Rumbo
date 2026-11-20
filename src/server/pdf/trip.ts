import { CompanyData, EXPENSE_CATEGORIES, EXPENSE_LABEL, Trip, TripCalc } from '../../shared/types';
import { fmtDate, fmtDateTime, fmtDuration, fmtKm, fmtMoney, fmtNum, fmtPct, NA } from '../../shared/format';
import { EXPENSE_LABEL as _EL } from '../../shared/types';
import { invoiceTotals, routeKey } from '../../shared/calc';
import { budgetVsActual, plannedCosts, Row } from '../../shared/budget';
import { BUDGET_LABEL } from '../../shared/types';
import { C, M, W, badge, bullet, docHeader, finish, kpis, kv, newDoc, para, section, table, toBuffer } from './kit';

const STATUS: Record<string, string> = { planificado: 'Planificado', en_curso: 'En curso', finalizado: 'Finalizado', cancelado: 'Cancelado' };

export interface TripPdfInput {
  data: CompanyData; trip: Trip; calc: TripCalc; version: number; provisional: boolean; generatedAt: string; preview?: boolean;
}
export async function renderTripPdf(inp: TripPdfInput): Promise<Buffer> {
  const { data, trip: t, calc: c } = inp; const s = data.settings; const tz = s.timezone; const $ = (v: number | null, d = 0) => fmtMoney(v, s.currency, d);
  const client = data.clients.find(x => x.id === t.clientId); const driver = data.drivers.find(x => x.id === t.driverId); const truck = data.trucks.find(x => x.id === t.truckId);
  const doc = newDoc(`Ficha de viaje ${t.id}`, s.companyName);
  docHeader(doc, s, {
    title: 'Ficha de viaje', subtitle: `${t.id}  ·  Informe v${inp.version}  ·  Generado ${fmtDateTime(inp.generatedAt, tz)}`,
    badges: [{ text: inp.provisional ? 'PROVISORIO' : 'COMPLETO', color: inp.provisional ? C.amber : C.accent }, ...(data.isDemo ? [{ text: 'DATOS DE DEMOSTRACIÓN', color: C.muted }] : [])],
  });

  // Resumen
  const y0 = doc.y;
  const yl = kv(doc, [['Cliente', client?.name ?? NA], ['Ruta', routeKey(t)], ['Vehículo', truck ? `${truck.name} (${truck.plate})` : NA], ['Chofer', driver?.name ?? NA], ['Estado', STATUS[t.status]]], M, y0, W * 0.55);
  doc.y = Math.max(yl, y0 + 10);
  const resColor = c.result == null ? C.ink : c.result < 0 ? C.red : C.ink;
  doc.y = yl + 6; doc.x = M;
  kpis(doc, [
    { label: `Ingreso (${s.profitabilityBasis === 'net' ? 'neto' : 'con IVA'})`, value: $(c.revenue) },
    { label: 'Costo total', value: $(c.totalCost), sub: 'gastos + costos asignados' },
    { label: 'Resultado', value: $(c.result), color: resColor },
    { label: 'Margen', value: fmtPct(c.marginPct), sub: inp.provisional ? 'Provisorio: faltan datos' : `Objetivo ${fmtPct(s.marginTarget)}`, color: c.marginPct != null && c.marginPct < s.marginTarget ? C.amber : C.ink },
  ]);

  // Recorrido y horarios
  section(doc, 'Recorrido, horarios y kilómetros');
  table(doc, [{ label: '', w: 22 }, { label: 'Previsto', w: 30 }, { label: 'Real', w: 30 }], [
    ['Salida', fmtDateTime(t.plannedDeparture, tz), fmtDateTime(t.actualDeparture, tz)],
    ['Llegada', fmtDateTime(t.plannedArrival, tz), fmtDateTime(t.actualArrival, tz)],
    ['Duración', fmtDuration(c.plannedDurationMin), c.durationMin == null ? 'No disponible (faltan horarios reales)' : fmtDuration(c.durationMin)],
    ...(c.stopsMin != null ? [['Paradas registradas', '', fmtDuration(c.stopsMin)], ['Tiempo de conducción', '', c.drivingMin == null ? NA : fmtDuration(c.drivingMin)]] : []),
  ]);
  table(doc, [{ label: 'Kilómetros', w: 22 }, { label: 'Con carga', w: 15, align: 'right' }, { label: 'Vacíos', w: 15, align: 'right' }, { label: 'Totales', w: 15, align: 'right' }, { label: 'Odómetro inicial / final', w: 25, align: 'right' }], [[
    'Recorrido', fmtKm(t.kmLoaded), fmtKm(t.kmEmpty), fmtKm(c.kmTotal),
    t.odometerStart != null && t.odometerEnd != null ? `${fmtNum(t.odometerStart)} / ${fmtNum(t.odometerEnd)}` : 'No registrado',
  ]]);
  if (c.stopsMin == null) para(doc, 'El tiempo de conducción y las paradas solo se muestran cuando existen registros de paradas del viaje.', { color: C.muted, size: 8.5 });

  // Gastos y costos
  const planned = plannedCosts(t);
  section(doc, 'Gastos registrados y costos asignados');
  const rows = EXPENSE_CATEGORIES.map(k => {
    const v = c.direct[k]; const b = planned?.[k];
    const diff = v != null && b != null ? v - b : null;
    return [EXPENSE_LABEL[k], v == null ? { t: 'Pendiente de carga', color: C.amber } : $(v), b != null ? $(b) : '—', diff == null ? '—' : { t: `${diff > 0 ? '+' : ''}${$(diff)}`, color: diff > 0 ? C.amber : C.ink }];
  });
  rows.push(['Costos directos registrados', $(c.directTotal), '', '']);
  rows.push([`Costos operativos asignados (${truck?.name ?? ''}, por km)`, c.allocated == null ? NA : $(c.allocated), '', '']);
  rows.push(['Costo total', $(c.totalCost), '', '']);
  table(doc, [{ label: 'Concepto', w: 46 }, { label: 'Registrado', w: 22, align: 'right' }, { label: 'Presupuesto', w: 20, align: 'right' }, { label: 'Diferencia', w: 20, align: 'right' }], rows, { totalRows: [5, 7] });
  para(doc, 'Los costos operativos mensuales del camión (seguro, patentes, rastreo y administración) se reparten entre los viajes finalizados del mes en proporción a sus kilómetros; cada importe se cuenta una sola vez.', { color: C.muted, size: 8.5 });

  section(doc, 'Indicadores');
  table(doc, [{ label: 'Indicador', w: 40 }, { label: 'Valor', w: 25, align: 'right' }, { label: 'Detalle', w: 45 }], [
    ['Costo por km', $(c.costPerKm), 'Costo total / km totales'], ['Ingreso por km', $(c.revenuePerKm), 'Ingreso / km totales'],
    ['Resultado', $(c.result), 'Ingreso − costo total'], ['Margen', fmtPct(c.marginPct), 'Resultado / ingreso'],
  ]);

  // Facturación
  section(doc, 'Facturación y cobros');
  const invs = data.invoices.filter(i => i.lines.some(l => l.tripId === t.id));
  if (!invs.length) para(doc, t.status === 'finalizado' ? 'Este viaje todavía no está facturado.' : 'Sin facturas asociadas.', { color: C.muted });
  else {
    const today = new Date().toISOString().slice(0, 10);
    table(doc, [{ label: 'Factura', w: 26 }, { label: 'Emisión', w: 17 }, { label: 'Vencimiento', w: 17 }, { label: 'Total', w: 20, align: 'right' }, { label: 'Cobrado', w: 20, align: 'right' }, { label: 'Saldo', w: 20, align: 'right' }],
      invs.map(i => { const it = invoiceTotals(i, data.payments, today, s.dueSoonDays); return [i.number, fmtDate(i.issueDate), fmtDate(i.dueDate), $(it.adjusted), $(it.paid), it.balance > 0.005 ? { t: $(it.balance), color: it.status === 'vencida' ? C.red : C.ink } : $(0)]; }));
    const pays = data.payments.filter(p => invs.some(i => i.id === p.invoiceId));
    if (pays.length) table(doc, [{ label: 'Cobro', w: 20 }, { label: 'Factura', w: 30 }, { label: 'Medio', w: 25 }, { label: 'Importe', w: 25, align: 'right' }], pays.map(p => [fmtDate(p.date), invs.find(i => i.id === p.invoiceId)!.number, p.method, $(p.amount)]));
    para(doc, `Facturado neto del viaje: ${$(c.invoicedNet)}  ·  Cobrado (parte de este viaje): ${$(c.paid)}  ·  Saldo pendiente: ${$(c.balance)}. Los cobros de facturas que agrupan varios viajes se atribuyen en proporción.`, { size: 9 });
  }

  // Presupuesto vs. resultado real (solo viajes originados en una cotización aceptada)
  const bva = budgetVsActual(t, c);
  if (bva && t.budgetSnapshot) {
    const sn = t.budgetSnapshot;
    section(doc, 'Presupuesto y resultado real', 150);
    para(doc, `Presupuesto aceptado de la cotización ${sn.quoteNumber} (${fmtDate(sn.acceptedAt.slice(0, 10))}). Es una copia histórica: los cambios posteriores de tarifas o parámetros no la modifican.`, { color: C.muted, size: 8.5 });
    const fmtRow = (r: Row, v: number | null) => v == null ? NA : r.unit === 'money' ? $(v) : r.unit === 'km' ? fmtKm(v) : r.unit === 'min' ? fmtDuration(v) : fmtPct(v);
    const TONE: Record<string, { t: string; color: string }> = { favorable: { t: 'Favorable', color: C.accent }, desfavorable: { t: 'Desfavorable', color: C.red }, sin_confirmar: { t: 'Sin confirmar', color: C.amber }, neutral: { t: '—', color: C.muted } };
    const line = (r: Row) => {
      const diff = r.diff == null ? NA : r.unit === 'pct' ? `${r.diff > 0 ? '+' : ''}${r.diff.toFixed(1).replace('.', ',')} p. p.` : r.unit === 'money' ? `${r.diff > 0 ? '+' : ''}${$(r.diff)}` : r.unit === 'km' ? `${r.diff > 0 ? '+' : ''}${fmtNum(r.diff)} km` : `${r.diff > 0 ? '+' : ''}${fmtDuration(Math.abs(r.diff))}`;
      return [r.label, fmtRow(r, r.planned), fmtRow(r, r.actual), diff, r.unit === 'pct' ? '—' : r.pctNA ? 'No aplica' : r.pct == null ? NA : `${r.pct > 0 ? '+' : ''}${r.pct.toFixed(1).replace('.', ',')} %`, { t: TONE[r.tone].t, color: TONE[r.tone].color }];
    };
    table(doc, [{ label: 'Indicador', w: 30 }, { label: 'Previsto', w: 19, align: 'right' }, { label: 'Real', w: 19, align: 'right' }, { label: 'Desvío', w: 19, align: 'right' }, { label: 'Desvío %', w: 13, align: 'right' }, { label: 'Lectura', w: 16 }],
      [...bva.rows.map(line), line(bva.totalCost), line(bva.revenue), line(bva.result), line(bva.margin), line(bva.km), line(bva.duration)], { totalRows: [6, 7, 8, 9] });
    if (!bva.reliable) para(doc, `Comparación provisoria: ${bva.why.join(' · ') || 'faltan registros'}. Un costo menor no se interpreta como ahorro hasta completar los registros.`, { color: C.amber, size: 8.5 });
    const notes = Object.entries(t.deviationNotes ?? {}); if (notes.length) { para(doc, 'Explicaciones registradas por los usuarios:', { font: 'S' }); notes.forEach(([k, n]) => bullet(doc, `${BUDGET_LABEL[k as keyof typeof BUDGET_LABEL] ?? k}: ${n.text} (${n.by}, ${fmtDate(n.at.slice(0, 10))})`)); }
    para(doc, 'Supuestos del presupuesto:', { font: 'S' }); (Object.keys(sn.assumptions) as (keyof typeof sn.assumptions)[]).filter(k => sn.included[k]).forEach(k => bullet(doc, `${BUDGET_LABEL[k]}: ${sn.assumptions[k]}`));
  }
  // Revisión de gastos cargados por choferes
  const reviewed = t.expenses.filter(e => e.status);
  if (reviewed.length) {
    section(doc, 'Revisión de gastos cargados por choferes', 100);
    table(doc, [{ label: 'Gasto', w: 26 }, { label: 'Importe', w: 18, align: 'right' }, { label: 'Estado', w: 24 }, { label: 'Detalle', w: 40 }], reviewed.map(e => [EXPENSE_LABEL[e.category], $(e.amount, 2),
      { t: e.status === 'aprobado' ? 'Aprobado' : e.status === 'rechazado' ? 'Rechazado' : 'Pendiente de revisión', color: e.status === 'aprobado' ? C.accent : e.status === 'rechazado' ? C.red : C.amber }, e.status === 'rechazado' ? (e.rejectionReason ?? '') : e.reviewedBy ? `Revisado por ${e.reviewedBy}` : `Cargado por ${e.createdBy ?? ''}`]));
    if (c.pendingReview.count) para(doc, `Hay ${c.pendingReview.count} gasto(s) pendiente(s) de revisión por ${$(c.pendingReview.amount)}: no están incluidos en el costo total. Resultado si se aprueban todos: ${$(c.resultIfApproved)}.`, { color: C.amber, size: 9 });
  }
  // Comprobantes y incidentes
  const files = data.files.filter(f => f.entityId === t.id || f.links.some(l => l.id === t.id));
  if (files.length) { section(doc, 'Comprobantes asociados', 80); table(doc, [{ label: 'Archivo', w: 40 }, { label: 'Cargado', w: 22 }, { label: 'Por', w: 22 }, { label: 'Vinculado a', w: 22 }], files.map(f => [f.name, fmtDate(f.uploadedAt.slice(0, 10)), f.uploadedBy, f.entityType === 'gasto' ? 'Gasto y viaje' : 'Viaje'])); para(doc, 'Los archivos son privados: se consultan en la aplicación con acceso autorizado. Una foto adjunta no confirma por sí sola un gasto.', { color: C.muted, size: 8.5 }); }
  if ((t.incidents ?? []).length || (t.timeCorrections ?? []).length) {
    section(doc, 'Incidentes y correcciones de horarios', 80);
    (t.incidents ?? []).forEach(i => bullet(doc, `${fmtDateTime(i.at, tz)} · ${i.by}: ${i.text}`, C.amber));
    (t.timeCorrections ?? []).forEach(x => bullet(doc, `${fmtDateTime(x.at, tz)} · ${x.by} corrigió la ${x.field === 'actualDeparture' ? 'salida' : 'llegada'} real (${x.oldValue ? fmtDateTime(x.oldValue, tz) : 'sin registro'} a ${fmtDateTime(x.newValue, tz)}). Motivo: ${x.reason}`));
  }

  // Estimaciones
  section(doc, 'Estimaciones de uso del vehículo', 120);
  if (!c.estimates) para(doc, 'No disponible: faltan kilómetros del viaje o parámetros válidos del vehículo.', { color: C.muted });
  else {
    const p = truck!.params;
    table(doc, [{ label: 'Concepto', w: 44 }, { label: 'Estimación', w: 22, align: 'right' }, { label: 'Parámetro', w: 54 }], [
      ['Mantenimiento', $(c.estimates.maintenance), `${$(p.maintenancePerKm, 2)}/km × ${fmtNum(c.kmTotal)} km`],
      ['Neumáticos', $(c.estimates.tires), `${$(p.tireSetCost)} / ${fmtNum(p.tireLifeKm)} km × km del viaje`],
      ['Depreciación económica', $(c.estimates.depreciation), `(${$(p.baseValue)} − ${$(p.residualValue)}) / ${fmtNum(p.lifeKm)} km × km`],
      ['Total estimado', $(c.estimates.total), ''],
    ], { totalRows: [3] });
    para(doc, `Resultado económico después de estimaciones: ${$(c.economicResult)} (resultado − estimaciones). Son estimaciones económicas calculadas con los parámetros configurados (actualizados el ${fmtDate(p.updatedAt)}); no miden el desgaste físico ni constituyen un diagnóstico mecánico. No están incluidas en el costo total ni en el resultado de arriba.`, { color: C.muted, size: 8.5 });
  }

  // Observaciones
  section(doc, 'Observaciones y datos faltantes', 90);
  if (t.notes) para(doc, t.notes);
  if (c.missing.length) { para(doc, 'Datos pendientes que hacen provisorio este informe:', { font: 'S' }); c.missing.forEach(m => bullet(doc, m, C.amber)); }
  else if (t.status === 'finalizado') para(doc, 'Sin datos pendientes.', { color: C.muted });
  else para(doc, `El viaje está ${STATUS[t.status].toLowerCase()}: los resultados se calculan al finalizarlo.`, { color: C.muted });

  finish(doc, `${s.companyName}  ·  ${t.id}  ·  v${inp.version}${inp.provisional ? '  ·  PROVISORIO' : ''}${data.isDemo ? '  ·  Datos de demostración' : ''}`, inp.preview ? 'VISTA PREVIA' : undefined);
  void badge; void W;
  return toBuffer(doc);
}
