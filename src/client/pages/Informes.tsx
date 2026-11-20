import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Download, Eye, FilePlus2, RotateCw, Mail } from 'lucide-react';
import { useApp } from '../store';
import { api, saveBlob } from '../api';
import { Route, href, navigate } from '../router';
import { Field, Kpi, PdfModal, ReportChip, Tabs } from '../components/ui';
import { EXPENSE_CATEGORIES, EXPENSE_LABEL, MonthlyReport } from '../../shared/types';
import { pctChange, ppChange } from '../../shared/calc';
import { fmtDateTime, fmtKm, fmtNum, fmtPct, fmtPctChange, fmtPp, NA } from '../../shared/format';
import { monthLabel, prevMonth } from '../../shared/time';
import { monthName } from '../lib';
import { AuditTable } from '../components/Attach';
import { STATIC } from '../static/backend';

type Tab = 'viajes' | 'mensuales' | 'procesos' | 'registro';
const JOB: Record<string, string> = { trip_pdf: 'PDF de viaje', monthly_report: 'Informe mensual', send_email: 'Envío de correo', notifications: 'Notificaciones' };
const JSTATUS: Record<string, { l: string; c: string }> = { en_cola: { l: 'En cola', c: 'amber' }, ejecutando: { l: 'Ejecutando', c: 'blue pulse' }, hecho: { l: 'Hecho', c: 'accent' }, error: { l: 'Error', c: 'red' }, omitido: { l: 'Omitido', c: 'gray' } };
const ESTATUS: Record<string, { l: string; c: string }> = { pendiente: { l: 'En cola', c: 'amber' }, sin_configurar: { l: 'No enviado: sin configurar', c: 'gray' }, enviado: { l: 'Enviado', c: 'accent' }, error: { l: 'Error de envío', c: 'red' } };

export function Informes({ route }: { route: Route }) {
  if (route.path[1] === 'mensual' && route.path[2]) return <MonthlyView id={route.path[2]} />;
  return <Lists tab={(route.query.get('tab') as Tab) ?? 'viajes'} />;
}

function Lists({ tab }: { tab: Tab }) {
  const { data, tz, today, canEdit, run, toast, meta } = useApp();
  const [pdf, setPdf] = useState<{ title: string; src: string } | null>(null);
  const [estado, setEstado] = useState(''); const [q, setQ] = useState('');
  const prev = prevMonth(today.slice(0, 7)); const [month, setMonth] = useState(prev);
  const months = useMemo(() => { const out: string[] = []; let m = today.slice(0, 7); for (let i = 0; i < 6; i++) { m = prevMonth(m); out.push(m); } return out; }, [today]);
  const trips = useMemo(() => [...data.tripReports].sort((a, b) => (b.generatedAt ?? b.createdAt).localeCompare(a.generatedAt ?? a.createdAt)).filter(r => (!estado || r.status === estado) && (!q || r.tripId.toLowerCase().includes(q.toLowerCase()))), [data, estado, q]);
  const monthly = useMemo(() => [...data.monthlyReports].sort((a, b) => b.month.localeCompare(a.month) || b.version - a.version), [data]);
  const gen = async () => { const r = await run(() => api<{ created: boolean; reason: string }>('POST', '/api/reports/monthly', { month })); if (r) toast(r.created ? `Informe de ${monthLabel(month)} programado.` : r.reason, r.created ? 'ok' : 'warn'); };
  const s = data.settings;

  return (
    <>
      <div className="page-head"><div><h1>Informes</h1><p>Fichas PDF por viaje e informes mensuales, con versiones, estado y fecha de generación.</p></div></div>
      <Tabs<Tab> value={tab} onChange={t => navigate('informes', t === 'viajes' ? {} : { tab: t })} tabs={[{ id: 'viajes', label: `Fichas por viaje (${data.tripReports.length})` }, { id: 'mensuales', label: `Informes mensuales (${data.monthlyReports.length})` }, { id: 'procesos', label: 'Procesos y correos' }, { id: 'registro', label: 'Registro de modificaciones' }]} />

      {tab === 'viajes' && <>
        <div className="filters"><Field label="Buscar viaje" className="grow"><input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="V-2026-0123" /></Field>
          <Field label="Estado"><select value={estado} onChange={e => setEstado(e.target.value)}><option value="">Todos</option><option value="pendiente">Pendiente</option><option value="generando">Generando</option><option value="disponible">Disponible</option><option value="error">Error</option></select></Field></div>
        <section className="panel"><div className="table-wrap"><table className="tbl"><thead><tr><th>Viaje</th><th>Versión</th><th>Estado</th><th>Tipo</th><th>Generada</th><th className="hide-sm num">Tamaño</th><th></th></tr></thead><tbody>
          {trips.slice(0, 80).map(r => <tr key={r.id}><td><a href={href(`viajes/${r.tripId}`)}>{r.tripId}</a></td><td>v{r.version}</td><td><ReportChip s={r.status} /></td>
            <td>{r.status === 'disponible' ? (r.provisional ? <span className="chip amber">Provisorio</span> : <span className="chip accent">Completo</span>) : '—'}</td>
            <td className="nowrap">{r.generatedAt ? fmtDateTime(r.generatedAt, tz) : r.status === 'error' ? <span className="neg small">{r.error}</span> : `Programada ${fmtDateTime(r.scheduledFor, tz)}`}</td><td className="hide-sm num">{r.fileSize ? `${Math.round(r.fileSize / 1024)} KB` : '—'}</td>
            <td className="num"><div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>{r.status === 'disponible' && <><button className="btn sm" onClick={() => setPdf({ title: `${r.tripId} · v${r.version}`, src: `/api/reports/trip/${r.id}/file` })}><Eye size={15} /> Ver</button>{!STATIC && <button className="btn sm" onClick={() => saveBlob(`/api/reports/trip/${r.id}/file?download=1`, 'informe.pdf').catch(e => toast(e.message, 'err'))}><Download size={15} /> PDF</button>}</>}
              {r.status === 'error' && canEdit && <button className="btn sm" onClick={() => run(() => api('POST', `/api/reports/trip/${r.id}/retry`, {}), 'Reintento programado')}><RotateCw size={15} /> Reintentar</button>}</div></td></tr>)}
          {!trips.length && <tr><td colSpan={7} className="empty">No hay fichas con esos filtros.</td></tr>}</tbody></table></div></section></>}

      {tab === 'mensuales' && <div className="stack">
        <section className="panel"><div className="panel-b row between"><div>{STATIC ? <><b>Simulación en el navegador:</b> el informe del mes anterior se generó al abrir la demostración. En la versión con servidor lo genera el servidor solo, el día </> : <><b>Generación automática:</b> el día </>} {s.monthlyReportDay} de cada mes a las {String(s.monthlyReportHour).padStart(2, '0')}:00 ({tz}), el servidor genera el informe del mes calendario anterior aunque nadie tenga la aplicación abierta. Se configura en Configuración.</div>
          <div className="row" style={{ alignItems: 'flex-end' }}><Field label="Mes"><select value={month} onChange={e => setMonth(e.target.value)}>{months.map(m => <option key={m} value={m}>{monthName(m)}</option>)}</select></Field>
            <button className="btn" onClick={() => setPdf({ title: `Vista previa · ${monthLabel(month)}`, src: `/api/reports/monthly/preview.pdf?month=${month}` })}><Eye size={16} /> Vista previa</button>
            <button className="btn primary" disabled={!canEdit} onClick={gen}><FilePlus2 size={16} /> Generar informe</button></div></div></section>
        <section className="panel"><div className="table-wrap"><table className="tbl"><thead><tr><th>Mes</th><th>Versión</th><th>Estado</th><th>Tipo</th><th>Origen</th><th>Generado</th><th></th></tr></thead><tbody>
          {monthly.map(r => <tr key={r.id}><td>{monthName(r.month)}</td><td>v{r.version}</td><td><ReportChip s={r.status} /></td><td>{r.status === 'disponible' ? (r.provisional ? <span className="chip amber">Provisorio</span> : <span className="chip accent">Completo</span>) : '—'}</td><td>{r.trigger === 'automatico' ? 'Automático (servidor)' : 'Manual'}</td><td className="nowrap">{fmtDateTime(r.generatedAt, tz)}</td>
            <td className="num"><div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>{r.status === 'disponible' && <><a className="btn sm" href={href(`informes/mensual/${r.id}`)}><Eye size={15} /> Abrir</a>{!STATIC && <button className="btn sm" onClick={() => saveBlob(`/api/reports/monthly/${r.id}/file?download=1`, 'informe.pdf').catch(e => toast(e.message, 'err'))}><Download size={15} /> PDF</button>}</>}
              {r.status === 'error' && canEdit && <button className="btn sm" onClick={() => run(() => api('POST', `/api/reports/monthly/${r.id}/retry`, {}), 'Reintento programado')}><RotateCw size={15} /> Reintentar</button>}</div></td></tr>)}
          {!monthly.length && <tr><td colSpan={7} className="empty">Todavía no hay informes mensuales.</td></tr>}</tbody></table></div></section></div>}

      {tab === 'procesos' && <div className="stack">
        <div className="banner blue"><div><b>Cómo funcionan.</b> Los PDF, el cierre mensual, las notificaciones y los correos son trabajos de una cola persistente que ejecuta el servidor, con estado, intentos (hasta 3, con espera creciente) y control de duplicados. No dependen de que haya una pestaña abierta.</div></div>
        {!meta.mailConfigured && <div className="banner amber"><Mail size={18} /><div><b>Correo sin configurar.</b> Falta definir <code>SMTP_URL</code> y <code>MAIL_FROM</code> en el servidor: los correos quedan registrados como “No enviado” y nunca figuran como enviados.</div></div>}
        <section className="panel"><div className="panel-h"><h2>Trabajos recientes</h2></div><div className="table-wrap"><table className="tbl"><thead><tr><th>Tipo</th><th>Referencia</th><th>Estado</th><th className="num">Intentos</th><th>Programado</th><th className="hide-sm">Resultado</th></tr></thead><tbody>
          {data.jobs.slice(0, 25).map(j => <tr key={j.id}><td>{JOB[j.type]}</td><td className="small muted">{String(j.payload.tripId ?? j.payload.month ?? '')}</td><td><span className={`chip ${JSTATUS[j.status].c}`}>{JSTATUS[j.status].l}</span></td><td className="num">{j.attempts}/{j.maxAttempts}</td><td className="nowrap">{fmtDateTime(j.runAt, tz)}</td><td className="hide-sm wrap small">{j.error && j.status !== 'hecho' ? <span className="neg">{j.error}</span> : j.result}</td></tr>)}
          {!data.jobs.length && <tr><td colSpan={6} className="empty">Sin trabajos.</td></tr>}</tbody></table></div></section>
        <section className="panel"><div className="panel-h"><h2>Correos</h2></div><div className="table-wrap"><table className="tbl"><thead><tr><th>Asunto</th><th>Destinatarios</th><th>Estado</th><th className="hide-sm">Detalle</th></tr></thead><tbody>
          {data.emails.slice(0, 20).map(e => <tr key={e.id}><td className="wrap">{e.subject}<div className="small muted">{e.summary}</div></td><td className="small">{e.to.join(', ')}</td><td><span className={`chip ${ESTATUS[e.status].c}`}>{ESTATUS[e.status].l}</span></td><td className="hide-sm small muted wrap">{e.detail}{canEdit && (e.status === 'error' || e.status === 'sin_configurar') && <div><button className="btn sm" onClick={() => run(() => api('POST', `/api/emails/${e.id}/retry`, {}), 'Reintento en cola')}>Reintentar envío</button></div>}</td></tr>)}
          {!data.emails.length && <tr><td colSpan={4} className="empty">Sin correos. Se generan al completarse un informe si está activado el envío en Configuración.</td></tr>}</tbody></table></div></section></div>}

      {tab === 'registro' && <AuditView />}
      {pdf && <PdfModal title={pdf.title} src={pdf.src} onClose={() => setPdf(null)} />}
    </>
  );
}

function AuditView() {
  const { data } = useApp(); const [entity, setEntity] = useState(''); const [user, setUser] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [q, setQ] = useState(''); const [lim, setLim] = useState(100);
  const entities = [...new Set(data.audit.map(a => a.entity))].sort(); const users = [...new Set(data.audit.map(a => a.user))].sort();
  const rows = data.audit.filter(a => (!entity || a.entity === entity) && (!user || a.user === user) && (!from || a.at.slice(0, 10) >= from) && (!to || a.at.slice(0, 10) <= to) && (!q || `${a.summary} ${a.entityId} ${a.reason ?? ''}`.toLowerCase().includes(q.toLowerCase())));
  return <div className="stack">
    <div className="filters" style={{ marginBottom: 0 }}><Field label="Buscar" className="grow"><input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Texto, id de viaje, motivo…" /></Field>
      <Field label="Entidad"><select value={entity} onChange={e => setEntity(e.target.value)}><option value="">Todas</option>{entities.map(x => <option key={x}>{x}</option>)}</select></Field>
      <Field label="Usuario o proceso"><select value={user} onChange={e => setUser(e.target.value)}><option value="">Todos</option>{users.map(x => <option key={x}>{x}</option>)}</select></Field>
      <Field label="Desde"><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field><Field label="Hasta"><input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field></div>
    <section className="panel"><div className="panel-h"><h2>Registro de cambios</h2><span className="muted small">{rows.length} registros · se genera desde las operaciones del sistema y no se puede editar</span></div><AuditTable entries={rows.slice(0, lim)} showEntity />
      {rows.length > lim && <div className="pager"><span className="muted small">Mostrando {lim} de {rows.length}</span><button className="btn sm" onClick={() => setLim(lim + 100)}>Mostrar más</button></div>}</section></div>;
}

function MonthlyView({ id }: { id: string }) {
  const { data, money, tz } = useApp(); const r = data.monthlyReports.find(x => x.id === id);
  const [pdf, setPdf] = useState(false);
  if (!r || !r.figures || !r.analysis) return <div className="empty">El informe no está disponible. <a href={href('informes', { tab: 'mensuales' })}>Volver</a></div>;
  return <MonthlyBody r={r} money={money} tz={tz} pdf={pdf} setPdf={setPdf} target={data.settings.marginTarget} />;
}
export function MonthlyBody({ r, money, tz, pdf, setPdf, target, embedded }: { embedded?: boolean; r: MonthlyReport; money: (v: number | null, d?: number) => string; tz: string; pdf: boolean; setPdf: (b: boolean) => void; target: number }) {
  const { toast } = useApp(); const f = r.figures!, a = r.analysis!, c = f.current, p = f.previous; const rec = f.receivables;
  const row = (label: string, cur: number | null, prev: number | null | undefined, fmt: (v: number | null) => string, pp = false) => <tr><td>{label}</td><td className="num">{fmt(cur)}</td><td className="num">{p ? fmt(prev ?? null) : '—'}</td><td className="num">{p ? (pp ? fmtPp(ppChange(cur, prev ?? null)) : fmtPctChange(pctChange(cur, prev ?? null))) : NA}</td></tr>;
  return (
    <>
      {!embedded && <a className="back" href={href('informes', { tab: 'mensuales' })}><ArrowLeft size={16} /> Informes mensuales</a>}
      <div className="page-head"><div><div className="row"><h1>Informe de {monthLabel(r.month)}</h1>{r.provisional ? <span className="chip amber"><AlertTriangle size={14} /> Provisorio</span> : <span className="chip accent">Completo</span>}<span className="chip gray">v{r.version}</span></div><p>Generado {fmtDateTime(r.generatedAt, tz)} · {r.trigger === 'automatico' ? 'automático (servidor)' : 'manual'} · cierre al {f.cutoffDate.split('-').reverse().join('/')}</p></div>
        {!embedded && <div className="page-actions"><button className="btn" onClick={() => setPdf(true)}><Eye size={16} /> Ver PDF</button>{!STATIC && <button className="btn primary" onClick={() => saveBlob(`/api/reports/monthly/${r.id}/file?download=1`, 'informe.pdf').catch(e => toast(e.message, 'err'))}><Download size={16} /> Descargar PDF</button>}</div>}</div>
      {r.provisional && <div className="banner amber" style={{ marginBottom: 16 }}><AlertTriangle size={18} /><div><b>Informe provisorio.</b> Datos pendientes:<ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{r.missing.map(m => <li key={m}>{m}</li>)}</ul></div></div>}
      <div className="kpis" style={{ marginBottom: 16 }}><Kpi label="Ingresos" value={money(c.revenue)} sub={`${c.trips} viajes`} /><Kpi label="Costos" value={money(c.totalCost)} /><Kpi label="Resultado" value={money(c.result)} tone={c.result < 0 ? 'bad' : undefined} /><Kpi label="Margen" value={fmtPct(c.marginPct)} tone={c.marginPct != null && c.marginPct < target ? 'warn' : undefined} sub={`Objetivo ${fmtPct(target)}`} /><Kpi label="Costo por km" value={money(c.costPerKm)} sub={fmtKm(c.km)} /><Kpi label="Pendiente al cierre" value={money(rec.pending)} tone={rec.overdue > 0 ? 'warn' : undefined} sub={`Vencido ${money(rec.overdue)}`} /></div>
      <div className="cols even" style={{ marginBottom: 16 }}>
        <section className="panel"><div className="panel-h"><h2>Comparación con {monthLabel(f.prevMonth)}</h2></div><div className="table-wrap"><table className="tbl"><thead><tr><th></th><th className="num">Este mes</th><th className="num">Mes anterior</th><th className="num">Variación</th></tr></thead><tbody>
          {row('Ingresos', c.revenue, p?.revenue, v => money(v))}{row('Costo total', c.totalCost, p?.totalCost, v => money(v))}{row('Resultado', c.result, p?.result, v => money(v))}{row('Margen', c.marginPct, p?.marginPct, v => fmtPct(v), true)}{row('Viajes', c.trips, p?.trips, v => fmtNum(v))}{row('Kilómetros', c.km, p?.km, v => fmtKm(v))}{row('Costo por km', c.costPerKm, p?.costPerKm, v => money(v))}</tbody></table></div>
          <div className="panel-b muted small">Importes: variación porcentual. Margen: cambio en puntos porcentuales (p. p.). {p ? '' : 'No hay datos comparables del mes anterior.'}</div></section>
        <section className="panel"><div className="panel-h"><h2>Costos desglosados</h2></div><div className="table-wrap"><table className="tbl"><tbody>
          {EXPENSE_CATEGORIES.map(k => <tr key={k}><td>{EXPENSE_LABEL[k]}</td><td className="num">{money(c.direct[k])}</td><td className="num muted">{fmtPct(c.totalCost ? (c.direct[k] / c.totalCost) * 100 : null)}</td></tr>)}
          <tr><td>Costos operativos asignados</td><td className="num">{money(c.allocated)}</td><td className="num muted">{fmtPct(c.totalCost ? (c.allocated / c.totalCost) * 100 : null)}</td></tr><tr><td><b>Total</b></td><td className="num"><b>{money(c.totalCost)}</b></td><td></td></tr></tbody></table></div></section></div>
      <div className="cols even" style={{ marginBottom: 16 }}>
        <section className="panel"><div className="panel-h"><h2>Por ruta</h2></div><div className="table-wrap"><table className="tbl"><thead><tr><th>Ruta</th><th className="num">Viajes</th><th className="num">Resultado</th><th className="num">Margen</th></tr></thead><tbody>{f.byRoute.map(x => <tr key={x.route}><td>{x.route}</td><td className="num">{x.trips}</td><td className="num">{money(x.result)}</td><td className={`num ${x.marginPct != null && x.marginPct < target ? 'warn' : ''}`}>{fmtPct(x.marginPct)}</td></tr>)}</tbody></table></div></section>
        <section className="panel"><div className="panel-h"><h2>Por camión</h2></div><div className="table-wrap"><table className="tbl"><thead><tr><th>Camión</th><th className="num">Viajes</th><th className="num">Margen</th><th className="num">Costo/km</th></tr></thead><tbody>{f.byTruck.map(x => <tr key={x.truckId}><td>{x.truck}</td><td className="num">{x.trips}</td><td className={`num ${x.marginPct != null && x.marginPct < target ? 'warn' : ''}`}>{fmtPct(x.marginPct)}</td><td className="num">{money(x.costPerKm)}</td></tr>)}</tbody></table></div></section></div>
      {(f.quoted || f.deviations.length > 0) && <div className="cols even" style={{ marginBottom: 16 }}>
        {f.quoted && <section className="panel"><div className="panel-h"><h2>Viajes cotizados: presupuesto vs. real</h2></div><div className="table-wrap"><table className="tbl"><thead><tr><th></th><th className="num">Previsto</th><th className="num">Real</th><th className="num">Diferencia</th></tr></thead><tbody>
          <tr><td>Ingresos</td><td className="num">{money(f.quoted.plannedRevenue)}</td><td className="num">{money(f.quoted.actualRevenue)}</td><td className="num">{money(f.quoted.actualRevenue - f.quoted.plannedRevenue)}</td></tr><tr><td>Resultado</td><td className="num">{money(f.quoted.plannedResult)}</td><td className="num">{money(f.quoted.actualResult)}</td><td className="num">{money(f.quoted.actualResult - f.quoted.plannedResult)}</td></tr></tbody></table></div>
          <div className="panel-b muted small">{f.quoted.trips} viaje(s) con presupuesto aceptado{f.quoted.incomplete ? `; ${f.quoted.incomplete} con datos incompletos (comparación provisoria)` : ''}.</div></section>}
        {f.deviations.length > 0 && <section className="panel"><div className="panel-h"><h2>Desvíos de costo más relevantes</h2></div><div className="table-wrap"><table className="tbl"><thead><tr><th>Viaje</th><th className="num">Presup.</th><th className="num">Real</th><th className="num">Desvío</th></tr></thead><tbody>
          {f.deviations.map(x => <tr key={x.tripId}><td><a href={href(`viajes/${x.tripId}`, { tab: 'presupuesto' })}>{x.tripId}</a></td><td className="num">{money(x.planned)}</td><td className="num">{money(x.actual)}</td><td className={`num ${x.reliable ? (x.diff > 0 ? 'neg' : '') : 'warn'}`}>{money(x.diff)}{x.pct != null ? ` (${fmtPctChange(x.pct)})` : ' (No aplica)'}</td></tr>)}</tbody></table></div><div className="panel-b muted small">Diferencias comprobadas; las causas surgen de los registros y explicaciones. En ámbar: comparación provisoria.</div></section>}</div>}
      <section className="panel" style={{ marginBottom: 16 }}><div className="panel-h"><h2>Cobros por cliente al cierre</h2></div><div className="table-wrap"><table className="tbl"><thead><tr><th>Cliente</th><th className="num">Pendiente</th><th className="num">Vencido</th></tr></thead><tbody>{f.receivables.byClient.slice(0, 8).map(c => <tr key={c.clientId}><td><a href={href(`clientes/${c.clientId}`)}>{c.client}</a></td><td className="num">{money(c.pending)}</td><td className={`num ${c.overdue > 0 ? 'neg' : ''}`}>{money(c.overdue)}</td></tr>)}</tbody></table></div></section>
      {(f.docsAttention.length > 0 || f.maintenanceDue.length > 0 || f.collectionPromises.length > 0) && <div className="cols even" style={{ marginBottom: 16 }}>
        <section className="panel"><div className="panel-h"><h2>Documentación y mantenimiento</h2></div><div className="panel-b stack" style={{ gap: 6 }}>{f.docsAttention.slice(0, 8).map((x, i) => <div key={i} className="small"><span className={`chip ${x.status === 'vencido' ? 'red' : 'amber'}`}>{x.status === 'vencido' ? 'Vencido' : x.status === 'pendiente' ? 'Pendiente' : `Vence en ${x.days} d`}</span> {x.owner}: {x.type}</div>)}{f.maintenanceDue.map((x, i) => <div key={`m${i}`} className="small"><span className={`chip ${x.status === 'vencido' ? 'red' : 'amber'}`}>{x.status === 'vencido' ? 'Vencido' : 'Próximo'}</span> {x.truck}: {x.service}</div>)}{!f.docsAttention.length && !f.maintenanceDue.length && <span className="muted">Sin pendientes.</span>}</div></section>
        <section className="panel"><div className="panel-h"><h2>Compromisos de pago pendientes</h2></div><div className="panel-b stack" style={{ gap: 6 }}>{f.collectionPromises.map((x, i) => <div key={i} className="small">{x.client}: {x.date.split('-').reverse().join('/')}{x.amount ? ` · ${money(x.amount)}` : ''}</div>)}{!f.collectionPromises.length && <span className="muted">Sin compromisos pendientes.</span>}</div></section></div>}
      <section className="panel" style={{ marginBottom: 16 }}><div className="panel-h"><h2>Pendiente de cobro al cierre</h2><span className="muted small">Incluye {money(rec.fromPreviousMonths)} de facturas de meses anteriores</span></div>
        <div className="kpis" style={{ border: 0, gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}><Kpi label="Total pendiente" value={money(rec.pending)} /><Kpi label="Vencido" value={money(rec.overdue)} tone={rec.overdue > 0 ? 'bad' : undefined} /><Kpi label="Por vencer" value={money(rec.dueSoon)} /><Kpi label="Vigente" value={money(rec.current)} /></div></section>
      <div className="cols even">
        <section className="panel"><div className="panel-h"><h2>Qué muestran los datos</h2><span className="chip accent">Hechos calculados</span></div><ul style={{ margin: 0, padding: '14px 16px 14px 34px', display: 'grid', gap: 8 }}>{a.facts.map((x, i) => <li key={i}>{x}</li>)}</ul>
          {a.hypotheses.length > 0 && <><div className="panel-h" style={{ borderTop: '1px solid var(--line)' }}><h2>Posibles causas a investigar</h2><span className="chip amber">No comprobadas</span></div><ul style={{ margin: 0, padding: '14px 16px 14px 34px', display: 'grid', gap: 8 }}>{a.hypotheses.map((x, i) => <li key={i}>{x}</li>)}</ul></>}</section>
        <section className="panel"><div className="panel-h"><h2>Tres prioridades de revisión</h2></div><ol style={{ margin: 0, padding: '14px 16px 14px 34px', display: 'grid', gap: 12 }}>{a.priorities.map((x, i) => <li key={i}><b>{x.title}</b><div className="muted">{x.detail}</div></li>)}</ol><div className="panel-b muted small" style={{ borderTop: '1px solid var(--line)' }}>Análisis generado con reglas y plantillas sobre las cifras del sistema.</div></section></div>
      {pdf && <PdfModal title={`Informe ${monthLabel(r.month)} · v${r.version}`} src={`/api/reports/monthly/${r.id}/file`} onClose={() => setPdf(false)} />}
    </>
  );
}
