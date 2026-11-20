import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Filter, FileWarning, Wrench, Receipt, FileX2, X, FileSignature, TrendingUp, ClipboardCheck, FolderOpen, HandCoins } from 'lucide-react';
import { budgetVsActual } from '../../shared/budget';
import { docAttention } from '../../shared/documents';
import { quoteStatus } from '../../shared/quote';
import { addDays } from '../../shared/time';
import { nameOf } from '../lib';
import { useApp } from '../store';
import { Route, href, navigate } from '../router';
import { aggregate, currentOdometer, invoiceTotals, pctChange, ppChange, routeKey, serviceStatus } from '../../shared/calc';
import { fmtKm, fmtNum, fmtPct, fmtPctChange, fmtPp, NA } from '../../shared/format';
import { prevMonth } from '../../shared/time';
import { filterTrips, monthName, monthsOf, routesOf } from '../lib';
import { Field, Kpi } from '../components/ui';
import { HBars } from '../components/HBars';
import { fmtDate } from '../../shared/format';

export function Resumen({ route }: { route: Route }) {
  const { data, calcs, money, today } = useApp();
  const s = data.settings; const curMonth = today.slice(0, 7);
  const month = route.query.get('month') ?? curMonth; const truck = route.query.get('truck') ?? ''; const rt = route.query.get('route') ?? '';
  const [rank, setRank] = useState<'low' | 'high'>('low');
  const setQ = (k: string, v: string) => { const q: Record<string, string> = { month, truck, route: rt, [k]: v }; navigate('resumen', Object.fromEntries(Object.entries(q).filter(([, x]) => x))); };
  const months = monthsOf(data);
  const periodAll = month === 'todos';
  const base = { truck: truck || undefined, route: rt || undefined };

  const trips = useMemo(() => filterTrips(data, calcs, { ...base, month: periodAll ? undefined : month, status: 'finalizado' }), [data, calcs, month, truck, rt]); // eslint-disable-line
  const agg = useMemo(() => aggregate(trips.map(t => calcs.get(t.id)!)), [trips, calcs]);
  const prevAgg = useMemo(() => {
    if (periodAll) return null; const p = filterTrips(data, calcs, { ...base, month: prevMonth(month), status: 'finalizado' });
    return p.length ? aggregate(p.map(t => calcs.get(t.id)!)) : null;
  }, [data, calcs, month, truck, rt, periodAll]); // eslint-disable-line

  // Pendiente de cobro (al día de hoy) de las facturas que contienen viajes del filtro, prorrateado por la parte de cada viaje
  const rec = useMemo(() => {
    const ids = new Set(filterTrips(data, calcs, base).map(t => t.id)); const filtered = !!(truck || rt);
    let pending = 0, overdue = 0, n = 0;
    for (const inv of data.invoices) {
      const t = invoiceTotals(inv, data.payments, today, s.dueSoonDays); if (t.balance <= 0.005) continue;
      const share = filtered ? inv.lines.filter(l => ids.has(l.tripId)).reduce((a, l) => a + l.net, 0) / t.net : 1;
      if (share <= 0) continue; pending += t.balance * share; if (t.status === 'vencida') { overdue += t.balance * share; n++; }
    }
    return { pending, overdue, n };
  }, [data, calcs, truck, rt, today]); // eslint-disable-line

  const byRoute = useMemo(() => {
    const m = new Map<string, typeof trips>(); for (const t of trips) (m.get(routeKey(t)) ?? m.set(routeKey(t), []).get(routeKey(t))!).push(t);
    return [...m].map(([r, ts]) => ({ r, a: aggregate(ts.map(t => calcs.get(t.id)!)) })).filter(x => x.a.marginPct != null).sort((a, b) => b.a.marginPct! - a.a.marginPct!);
  }, [trips, calcs]);
  const byTruck = useMemo(() => {
    const m = new Map<string, typeof trips>(); for (const t of trips) (m.get(t.truckId) ?? m.set(t.truckId, []).get(t.truckId)!).push(t);
    return [...m].map(([id, ts]) => ({ id, a: aggregate(ts.map(t => calcs.get(t.id)!)) })).filter(x => x.a.costPerKm != null).sort((a, b) => b.a.costPerKm! - a.a.costPerKm!);
  }, [trips, calcs]);

  // Asuntos que necesitan atención (independientes del período)
  const attention = useMemo(() => {
    const items: { sev: 'red' | 'amber' | 'blue'; icon: typeof AlertTriangle; title: string; detail: string; to: string }[] = [];
    const overdueInv = data.invoices.map(i => ({ i, t: invoiceTotals(i, data.payments, today, s.dueSoonDays) })).filter(x => x.t.status === 'vencida');
    if (overdueInv.length) items.push({ sev: 'red', icon: Receipt, title: `${overdueInv.length} factura(s) vencida(s)`, detail: `${money(overdueInv.reduce((a, x) => a + x.t.balance, 0))} para gestionar`, to: href('cobros', { estado: 'vencida' }) });
    const inc = data.trips.filter(t => t.status === 'finalizado' && !calcs.get(t.id)!.complete);
    if (inc.length) items.push({ sev: 'amber', icon: FileWarning, title: `${inc.length} viaje(s) finalizado(s) con datos pendientes`, detail: `Sus resultados son provisorios. Ej.: ${inc[0].id}${calcs.get(inc[0].id)!.missing[0] ? ' · ' + calcs.get(inc[0].id)!.missing[0] : ''}`, to: href('viajes', { pendientes: '1' }) });
    const unbilled = data.trips.filter(t => t.status === 'finalizado' && t.serviceValue != null && t.serviceValue > 0 && calcs.get(t.id)!.invoicedNet < t.serviceValue - 0.5);
    if (unbilled.length) items.push({ sev: 'amber', icon: Receipt, title: `${unbilled.length} viaje(s) finalizado(s) sin facturar`, detail: `${money(unbilled.reduce((a, t) => a + t.serviceValue! - calcs.get(t.id)!.invoicedNet, 0))} netos por facturar`, to: href('cobros', { tab: 'sin-facturar' }) });
    for (const tr of data.trucks) for (const p of tr.servicePlans) {
      const st = serviceStatus(p, currentOdometer(tr, data.trips), today);
      if (st.status === 'vencido' || st.status === 'proximo') items.push({ sev: st.status === 'vencido' ? 'red' : 'amber', icon: Wrench, title: `${tr.name}: ${p.name} ${st.status === 'vencido' ? 'vencido' : 'próximo'}`, detail: [st.remainingKm != null ? `${st.remainingKm <= 0 ? 'Excedido' : 'Faltan'} ${fmtNum(Math.abs(st.remainingKm))} km` : '', st.remainingDays != null ? `${st.remainingDays < 0 ? 'Vencido hace' : 'Faltan'} ${Math.abs(st.remainingDays)} días` : ''].filter(Boolean).join(' · '), to: href(`flota/${tr.id}`, { tab: 'mantenimiento' }) });
    }
    // Cotizaciones, desvíos, gastos por revisar, documentos y compromisos de pago
    const openQ = data.quotes.filter(q => quoteStatus(q, today) === 'enviada');
    if (openQ.length) items.push({ sev: openQ.some(q => q.validUntil <= addDays(today, 3)) ? 'amber' : 'blue', icon: FileSignature, title: `${openQ.length} cotización(es) enviada(s) sin respuesta`, detail: `${openQ.filter(q => q.validUntil <= addDays(today, 7)).length} vencen en los próximos 7 días`, to: href('cotizaciones', { estado: 'enviada' }) });
    const accNoTrip = data.quotes.filter(q => q.status === 'aceptada' && !q.tripId);
    if (accNoTrip.length) items.push({ sev: 'amber', icon: FileSignature, title: `${accNoTrip.length} cotización(es) aceptada(s) sin convertir en viaje`, detail: accNoTrip.map(q => q.number).join(', '), to: href('cotizaciones', { estado: 'aceptada' }) });
    const bigDev = data.trips.filter(t => { const b = budgetVsActual(t, calcs.get(t.id)!); return !!b && b.reliable && b.totalCost.pct != null && Math.abs(b.totalCost.pct) >= data.settings.deviationAlertPct; });
    if (bigDev.length) items.push({ sev: 'amber', icon: TrendingUp, title: `${bigDev.length} viaje(s) con desvío de costo ≥ ${data.settings.deviationAlertPct} %`, detail: 'Frente al presupuesto de su cotización, con registros completos', to: href('viajes', { desvios: '1' }) });
    const inReview = data.trips.reduce((n, t) => n + t.expenses.filter(e => e.status === 'pendiente_revision').length, 0);
    if (inReview) items.push({ sev: 'amber', icon: ClipboardCheck, title: `${inReview} gasto(s) cargado(s) por choferes esperan revisión`, detail: 'Mientras tanto, los resultados de esos viajes son provisorios', to: href('viajes', { revision: '1' }) });
    const docsA = docAttention(data, today);
    if (docsA.length) items.push({ sev: docsA.some(r => r.status === 'vencido') ? 'red' : 'amber', icon: FolderOpen, title: `${docsA.length} documento(s) requieren atención`, detail: `${docsA.filter(r => r.status === 'vencido').length} vencido(s) · ${docsA.filter(r => r.status === 'proximo').length} próximo(s) · ${docsA.filter(r => r.status === 'pendiente').length} pendiente(s) de cargar`, to: href('documentos', { estado: docsA.some(r => r.status === 'vencido') ? 'vencido' : '' }) });
    const prom = data.collections.filter(g => g.promise?.status === 'pendiente' && g.promise.date <= addDays(today, 7));
    if (prom.length) items.push({ sev: prom.some(g => g.promise!.date < today) ? 'red' : 'blue', icon: HandCoins, title: `${prom.length} compromiso(s) de pago por vencer o vencidos`, detail: prom.map(g => `${nameOf.client(data, g.clientId)} (${fmtDate(g.promise!.date)})`).slice(0, 3).join(' · '), to: href(`clientes/${prom[0].clientId}`, { tab: 'gestiones' }) });
    const failed = data.tripReports.filter(r => r.status === 'error').length + data.monthlyReports.filter(r => r.status === 'error').length;
    if (failed) items.push({ sev: 'red', icon: FileX2, title: `${failed} informe(s) con error de generación`, detail: 'Reintentá desde Informes', to: href('informes') });
    return items.sort((a, b) => (a.sev === b.sev ? 0 : a.sev === 'red' ? -1 : b.sev === 'red' ? 1 : 0));
  }, [data, calcs, today]); // eslint-disable-line

  const ranked = useMemo(() => [...trips].filter(t => calcs.get(t.id)!.marginPct != null).sort((a, b) => rank === 'low' ? calcs.get(a.id)!.marginPct! - calcs.get(b.id)!.marginPct! : calcs.get(b.id)!.marginPct! - calcs.get(a.id)!.marginPct!).slice(0, 6), [trips, calcs, rank]);
  const active = !!(truck || rt || (month !== curMonth));
  const vsLabel = prevAgg && !periodAll && month !== curMonth ? `vs ${monthName(prevMonth(month)).split(' ')[0]}` : ''; // el mes en curso no es comparable con un mes completo
  const tripsLink = (extra: Record<string, string> = {}) => href('viajes', { month: periodAll ? '' : month, truck, route: rt, estado: 'finalizado', ...extra });
  const below = (m: number | null) => m != null && m < s.marginTarget;

  return (
    <>
      <div className="page-head">
        <div><h1>Resumen</h1><p>Resultados de los viajes finalizados · {periodAll ? 'todo el período cargado' : `${monthName(month)}${month === curMonth ? ' (mes en curso, parcial)' : ''}`}.</p></div>
        <div className="page-actions"><a className="btn primary" href={href('viajes', { nuevo: '1' })}>Nuevo viaje</a></div>
      </div>
      {(data.trucks.length === 0 || data.drivers.length === 0 || data.clients.length === 0 || data.trips.length === 0) && <section className="panel" style={{ marginBottom: 16 }}><div className="panel-h"><h2>Primeros pasos</h2><span className="muted small">Completá estos datos para empezar a trabajar</span></div>
        <ul className="attn steps">{([[data.trucks.length > 0, 'Cargá tus camiones', 'Patente, kilometraje, costos mensuales y parámetros de estimación', href('flota')], [data.drivers.length > 0, 'Cargá a tus choferes y creá sus usuarios del portal móvil', 'Configuración → Clientes y choferes / Usuarios', href('configuracion')], [data.clients.length > 0, 'Cargá a tus clientes', 'Razón social, CUIT, contactos y plazo de pago', href('clientes')], [data.settings.documentTypes.length > 0 && data.documents.length > 0, 'Cargá la documentación (seguros, RTO, licencias)', 'Se controlan vencimientos y se avisa con anticipación', href('documentos')], [data.trips.length > 0 || data.quotes.length > 0, 'Cotizá o cargá tu primer viaje', 'También podés importar viajes desde Excel o CSV', href('cotizaciones/nueva')]] as [boolean, string, string, string][]).map(([done, t, d, to]) => <li key={t}><a href={to}><span className={done ? 'chip accent' : 'chip gray'}>{done ? 'Listo' : 'Falta'}</span><div><div className="t">{t}</div><div className="d">{d}</div></div><ArrowRight size={16} className="muted" /></a></li>)}</ul></section>}
      <div className="filters" role="group" aria-label="Filtros del resumen">
        <Field label="Período (fecha de salida)"><select value={month} onChange={e => setQ('month', e.target.value)}>
          {!months.includes(curMonth) && <option value={curMonth}>{monthName(curMonth)} (en curso)</option>}
          {months.map(m => <option key={m} value={m}>{monthName(m)}{m === curMonth ? ' (en curso)' : ''}</option>)}<option value="todos">Todos los meses</option></select></Field>
        <Field label="Camión"><select value={truck} onChange={e => setQ('truck', e.target.value)}><option value="">Todos</option>{data.trucks.map(t => <option key={t.id} value={t.id}>{t.name} · {t.plate}</option>)}</select></Field>
        <Field label="Ruta" className="grow"><select value={rt} onChange={e => setQ('route', e.target.value)}><option value="">Todas</option>{routesOf(data).map(r => <option key={r}>{r}</option>)}</select></Field>
        {active && <div className="row"><span className="filter-flag"><Filter size={15} /> Filtros activos</span><button className="btn sm ghost" onClick={() => navigate('resumen')}><X size={14} /> Restablecer</button></div>}
      </div>

      <div className="kpis" style={{ marginBottom: 16 }}>
        <Kpi label="Ingresos" value={money(agg.revenue)} sub={<>{agg.trips} viajes · {s.profitabilityBasis === 'net' ? 'neto' : 'con IVA'}{vsLabel && prevAgg && <> · {vsLabel} {fmtPctChange(pctChange(agg.revenue, prevAgg.revenue))}</>}</>} />
        <Kpi label="Costos totales" value={money(agg.totalCost)} sub={`Gastos ${money(agg.directTotal)} + asignados ${money(agg.allocated)}`} />
        <Kpi label="Resultado" value={money(agg.result)} tone={agg.result < 0 ? 'bad' : undefined} sub="Ingresos − costos" />
        <Kpi label="Margen" value={fmtPct(agg.marginPct)} tone={below(agg.marginPct) ? 'warn' : undefined} sub={<>Objetivo {fmtPct(s.marginTarget)}{vsLabel && prevAgg && <> · {fmtPp(ppChange(agg.marginPct, prevAgg.marginPct))}</>}</>} />
        <Kpi label="Costo por km" value={money(agg.costPerKm)} sub={`${fmtKm(agg.km)} · ingreso/km ${money(agg.revenuePerKm)}`} />
        <Kpi label="Pendiente de cobro" value={money(rec.pending)} tone={rec.overdue > 0 ? 'warn' : undefined} sub={`Vencido ${money(rec.overdue)} · al día de hoy`} />
      </div>
      {agg.incomplete > 0 && <div className="banner amber" style={{ marginBottom: 16 }}><AlertTriangle size={18} /><div><b>{agg.incomplete} de {agg.trips} viajes incluidos tienen datos pendientes.</b> Los indicadores son provisorios hasta completarlos. <a href={tripsLink({ pendientes: '1' })}>Ver esos viajes</a></div></div>}
      <p className="muted small" style={{ margin: '-4px 0 16px' }}>Fechas: ingresos, costos y márgenes por <b>fecha de salida</b> del viaje; pendiente de cobro por <b>factura</b> al día de hoy ({fmtDate(today)}). {truck || rt ? 'Con filtros, el pendiente incluye solo la parte de cada factura que corresponde a los viajes filtrados.' : ''}</p>

      <div className="cols even" style={{ marginBottom: 16 }}>
        <section className="panel"><div className="panel-h"><h2>Margen por ruta</h2><span className="muted small">Clic para ver los viajes</span></div>
          <HBars ariaLabel="Margen por ruta" bars={byRoute.map(x => ({ key: x.r, label: x.r, value: Math.max(0, x.a.marginPct!), text: fmtPct(x.a.marginPct), below: below(x.a.marginPct), onClick: () => navigate('viajes', { month: periodAll ? '' : month, truck, route: x.r, estado: 'finalizado' }) }))} refValue={s.marginTarget} refLabel={`Objetivo ${fmtPct(s.marginTarget, 0)}`} /></section>
        <section className="panel"><div className="panel-h"><h2>Costo por km por camión</h2><span className="muted small">Costo total ÷ km totales</span></div>
          <HBars ariaLabel="Costo por kilómetro por camión" bars={byTruck.map(x => ({ key: x.id, label: data.trucks.find(t => t.id === x.id)?.name ?? x.id, value: x.a.costPerKm, text: money(x.a.costPerKm), onClick: () => navigate('viajes', { month: periodAll ? '' : month, truck: x.id, route: rt, estado: 'finalizado' }) }))} />
          <div className="chart-legend"><span>Promedio ponderado de la selección: <b>{money(agg.costPerKm)}</b></span></div></section>
      </div>

      <div className="cols" style={{ marginBottom: 16 }}>
        <section className="panel"><div className="panel-h"><h2>Viajes que explican el resultado</h2>
          <div className="row"><div className="seg" role="group" aria-label="Orden"><button className={rank === 'low' ? 'on' : ''} onClick={() => setRank('low')}>Menor margen</button><button className={rank === 'high' ? 'on' : ''} onClick={() => setRank('high')}>Mayor margen</button></div></div></div>
          <div className="table-wrap"><table className="tbl"><thead><tr><th>Viaje</th><th className="hide-sm">Ruta</th><th className="hide-sm">Camión</th><th className="num">Resultado</th><th className="num">Margen</th></tr></thead><tbody>
            {ranked.map(t => { const c = calcs.get(t.id)!; return <tr key={t.id} className="click" onClick={() => navigate(`viajes/${t.id}`)}>
              <td><a href={href(`viajes/${t.id}`)} onClick={e => e.stopPropagation()}>{t.id}</a>{!c.complete && <span className="chip amber" style={{ marginLeft: 6 }}>Provisorio</span>}</td>
              <td className="hide-sm">{routeKey(t)}</td><td className="hide-sm">{data.trucks.find(x => x.id === t.truckId)?.name}</td>
              <td className={`num ${c.result! < 0 ? 'neg' : ''}`}>{money(c.result)}</td><td className={`num ${below(c.marginPct) ? 'warn' : ''}`}>{fmtPct(c.marginPct)}</td></tr>; })}
            {!ranked.length && <tr><td colSpan={5} className="empty">No hay viajes finalizados para estos filtros.</td></tr>}</tbody></table></div>
          <div className="pager"><span className="muted small">{trips.length} viajes finalizados en la selección</span><a href={tripsLink()}>Ver todos los viajes <ArrowRight size={14} style={{ verticalAlign: -2 }} /></a></div></section>

        <div className="stack">
          <section className="panel"><div className="panel-h"><h2>Requiere atención</h2><span className="chip gray">{attention.length}</span></div>
            {attention.length ? <ul className="attn">{attention.map((a, i) => <li key={i}><a href={a.to}><a.icon size={20} className={a.sev} /><div><div className="t">{a.title}</div><div className="d">{a.detail}</div></div><ArrowRight size={16} className="muted" /></a></li>)}</ul> : <div className="empty">Nada pendiente por ahora.</div>}</section>
          <section className="panel"><div className="panel-h"><h2>Registrado, asignado y estimado</h2></div>
            <div className="table-wrap"><table className="tbl"><tbody>
              <tr><td>Gastos registrados<div className="muted small">Combustible, peajes, chofer, viáticos, otros</div></td><td className="num">{money(agg.directTotal)}</td></tr>
              <tr><td>Costos operativos asignados<div className="muted small">Seguro, patentes, rastreo, administración (por km)</div></td><td className="num">{money(agg.allocated)}</td></tr>
              <tr><td><b>Costo total</b> <span className="muted small">(suma de las dos filas anteriores)</span></td><td className="num"><b>{money(agg.totalCost)}</b></td></tr>
              <tr><td className="muted">Estimaciones de uso del vehículo<div className="small">Mantenimiento, neumáticos, depreciación. <b>No se suman</b> al costo total.</div></td><td className="num muted">{agg.trips ? money(agg.estimates) : NA}</td></tr>
            </tbody></table></div></section>
        </div>
      </div>
    </>
  );
}
