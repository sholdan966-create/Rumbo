// Análisis del cierre mensual basado en reglas y plantillas. Usa solo cifras ya calculadas.
import { fmtMoney, fmtPct, fmtPp, fmtPctChange } from './format';
import { pctChange, ppChange } from './calc';
import { monthLabel } from './time';
import { EXPENSE_LABEL, EXPENSE_CATEGORIES, MonthlyAnalysis, MonthlyFigures, Settings } from './types';

export function buildAnalysis(f: MonthlyFigures, s: Settings): MonthlyAnalysis {
  const $ = (v: number) => fmtMoney(v, s.currency);
  const facts: string[] = [];
  const hypotheses: string[] = [];
  const cand: { score: number; title: string; detail: string }[] = [];
  const c = f.current, p = f.previous;
  const label = monthLabel(f.month);

  if (c.trips === 0) {
    facts.push(`No hay viajes finalizados en ${label}.`);
  } else {
    facts.push(`En ${label} se finalizaron ${c.trips} viajes con ingresos de ${$(c.revenue)} y costos de ${$(c.totalCost)}: resultado ${$(c.result)} (margen ${fmtPct(c.marginPct)}).`);
    if (c.marginPct != null) {
      const gap = c.marginPct - s.marginTarget;
      facts.push(`El margen ${gap >= 0 ? 'está por encima' : 'está por debajo'} del objetivo de ${fmtPct(s.marginTarget)} (${fmtPp(gap)}).`);
    }
  }
  if (p) {
    const rev = pctChange(c.revenue, p.revenue), cost = pctChange(c.totalCost, p.totalCost), mg = ppChange(c.marginPct, p.marginPct);
    facts.push(`Frente a ${monthLabel(f.prevMonth)}: ingresos ${fmtPctChange(rev)}, costos ${fmtPctChange(cost)} y margen ${fmtPp(mg)}.`);
    const cpk = pctChange(c.costPerKm, p.costPerKm);
    if (cpk != null) facts.push(`El costo por km pasó de ${$(p.costPerKm!)} a ${$(c.costPerKm!)} (${fmtPctChange(cpk)}).`);
    if (mg != null && mg < -2) hypotheses.push('La caída del margen puede deberse a tarifas, composición de rutas o gastos; el sistema no puede determinar cuál sin revisar los viajes del período.');
  } else facts.push(`No hay datos comparables de ${monthLabel(f.prevMonth)}: se omiten las variaciones.`);

  // Ruta de menor margen
  const routes = f.byRoute.filter(r => r.trips >= 2 && r.marginPct != null).sort((a, b) => a.marginPct! - b.marginPct!);
  if (routes.length >= 2) {
    const w = routes[0], b = routes[routes.length - 1];
    facts.push(`La ruta de menor margen fue ${w.route} (${fmtPct(w.marginPct)}, ${w.trips} viajes); la de mayor margen, ${b.route} (${fmtPct(b.marginPct)}, ${b.trips} viajes).`);
    const top = (a: typeof w) => EXPENSE_CATEGORIES.map(k => ({ k, v: a.direct[k] })).sort((x, y) => y.v - x.v)[0];
    const wt = top(w);
    if (w.totalCost > 0) facts.push(`En ${w.route}, ${EXPENSE_LABEL[wt.k].toLowerCase()} fue el mayor gasto directo (${fmtPct((wt.v / w.totalCost) * 100)} del costo total de la ruta).`);
    hypotheses.push(`Revisar tarifa, kilómetros vacíos y gastos de ${w.route}. Con los datos cargados no se puede atribuir el menor margen a un gasto en particular.`);
    if (w.marginPct! < s.marginTarget) cand.push({ score: 60 + (s.marginTarget - w.marginPct!), title: `Revisar la rentabilidad de ${w.route}`, detail: `Margen ${fmtPct(w.marginPct)} contra un objetivo de ${fmtPct(s.marginTarget)} en ${w.trips} viajes.` });
  }
  // Camión de mayor costo por km
  const trucks = f.byTruck.filter(t => t.trips >= 2 && t.costPerKm != null).sort((a, b) => b.costPerKm! - a.costPerKm!);
  if (trucks.length >= 2 && c.costPerKm) {
    const t = trucks[0];
    const diff = pctChange(t.costPerKm, c.costPerKm);
    facts.push(`${t.truck} tuvo el mayor costo por km (${$(t.costPerKm!)}), ${fmtPctChange(diff)} respecto del promedio ponderado de la flota (${$(c.costPerKm)}).`);
    if (diff != null && diff > 10) {
      hypotheses.push(`El costo por km de ${t.truck} puede estar influido por la mezcla de rutas, los km vacíos o gastos puntuales; requiere revisar sus viajes antes de sacar conclusiones.`);
      cand.push({ score: 40 + diff / 2, title: `Revisar los viajes de ${t.truck}`, detail: `Costo por km ${fmtPctChange(diff)} sobre el promedio de la flota.` });
    }
  }
  // Cotizaciones y desvíos (hechos comprobados; las causas requieren revisión)
  if (f.quoted) {
    const q = f.quoted;
    facts.push(`${q.trips} viaje(s) del mes tenían presupuesto aceptado: resultado previsto ${$(q.plannedResult)} y real ${$(q.actualResult)} (diferencia ${$(q.actualResult - q.plannedResult)})${q.incomplete ? `; ${q.incomplete} con datos incompletos, por lo que esa comparación es provisoria` : ''}.`);
  }
  const bigDev = f.deviations.filter(x => x.reliable && x.pct != null && Math.abs(x.pct) >= s.deviationAlertPct);
  if (bigDev.length) {
    const t = bigDev[0];
    facts.push(`El mayor desvío de costo fue el de ${t.tripId} (${t.route}): ${$(t.actual)} reales contra ${$(t.planned)} presupuestados (${fmtPctChange(t.pct)}).`);
    hypotheses.push(`Revisar los registros y las observaciones de ${t.tripId} para explicar el desvío; el sistema señala la diferencia pero no determina su causa.`);
    cand.push({ score: 75 + Math.min(10, Math.abs(t.pct!) / 5), title: 'Revisar los desvíos de costo contra presupuesto', detail: `${bigDev.length} viaje(s) superan el ${s.deviationAlertPct} % de desvío; el mayor es ${t.tripId} (${fmtPctChange(t.pct)}).` });
  }
  if (f.docsAttention.length) {
    const v = f.docsAttention.filter(x => x.status === 'vencido').length;
    facts.push(`${f.docsAttention.length} documento(s) requieren atención (${v} vencido(s)). Tener documentos cargados no implica por sí solo que la operación esté habilitada.`);
    cand.push({ score: 85 + v, title: 'Regularizar la documentación', detail: f.docsAttention.slice(0, 3).map(x => `${x.owner}: ${x.type} (${x.status === 'vencido' ? 'vencido' : x.status === 'pendiente' ? 'pendiente de cargar' : 'próximo a vencer'})`).join('; ') });
  }
  if (f.expensesInReview) cand.push({ score: 72, title: 'Revisar los gastos cargados por choferes', detail: `${f.expensesInReview} gasto(s) esperan aprobación; mientras tanto los resultados son provisorios.` });
  if (f.collectionPromises.length) cand.push({ score: 65, title: 'Seguir los compromisos de pago', detail: f.collectionPromises.slice(0, 3).map(x => `${x.client} (${x.date})`).join('; ') });
  // Cobros
  const r = f.receivables;
  facts.push(`Al cierre (${f.cutoffDate.split('-').reverse().join('/')}) el pendiente de cobro era ${$(r.pending)}: vencido ${$(r.overdue)}, por vencer ${$(r.dueSoon)} y vigente ${$(r.current)}. ${$(r.fromPreviousMonths)} corresponden a facturas de meses anteriores.`);
  if (r.overdue > 0) {
    const top = r.byClient.filter(x => x.overdue > 0).sort((a, b) => b.overdue - a.overdue)[0];
    cand.push({ score: 80 + Math.min(20, (r.overdue / Math.max(1, c.revenue)) * 100), title: 'Gestionar los cobros vencidos', detail: `${$(r.overdue)} vencidos al cierre${top ? `; el mayor saldo vencido es de ${top.client} (${$(top.overdue)})` : ''}.` });
  }
  if (f.unbilledTrips > 0) cand.push({ score: 70, title: 'Facturar los viajes pendientes', detail: `${f.unbilledTrips} viaje(s) finalizado(s) del mes no tenían factura al cierre.` });
  if (f.incompleteTripIds.length) cand.push({ score: 95, title: 'Completar los datos de los viajes', detail: `${f.incompleteTripIds.length} viaje(s) con datos pendientes; hasta completarlos el informe es provisorio.` });
  if (f.maintenanceDue.length) cand.push({ score: 50, title: 'Programar servicios de mantenimiento', detail: f.maintenanceDue.slice(0, 3).map(m => `${m.truck}: ${m.service} (${m.status === 'vencido' ? 'vencido' : 'próximo'})`).join('; ') });
  if (c.marginPct != null && c.marginPct < s.marginTarget && !cand.some(x => x.title.startsWith('Revisar la rentabilidad'))) cand.push({ score: 55, title: 'Analizar el margen del mes', detail: `Margen ${fmtPct(c.marginPct)} contra un objetivo de ${fmtPct(s.marginTarget)}.` });
  cand.push({ score: 1, title: 'Mantener la carga de gastos al día', detail: 'Registrar gastos y horarios reales de cada viaje al finalizarlo mantiene confiables los indicadores.' });
  cand.push({ score: 0, title: 'Revisar los objetivos de margen', detail: 'Verificar que el objetivo configurado siga reflejando la realidad de cada ruta.' });
  const priorities = cand.sort((a, b) => b.score - a.score).slice(0, 3).map(({ title, detail }) => ({ title, detail }));
  return { facts, hypotheses, priorities };
}
