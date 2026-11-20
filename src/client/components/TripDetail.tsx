import { useMemo, useState } from 'react';
import { Paperclip, AlertTriangle, ArrowLeft, Download, Eye, FilePlus2, Pencil, RotateCw, Trash2, Receipt, Plus } from 'lucide-react';
import { useApp } from '../store';
import { api, saveBlob } from '../api';
import { href, navigate } from '../router';
import { Tabs } from './ui';
import { Field, InvChip, Kpi, Modal, NumField, PdfModal, ReportChip, TripChip, DateTimeField } from './ui';
import { plannedCosts } from '../../shared/budget';
import { InvoiceModal, PaymentModal } from './BillingModals';
import { TripForm } from './TripForm';
import { FilesPanel, HistoryPanel, filesFor } from './Attach';
import { BudgetPanel } from './BudgetPanel';
import { EXPENSE_CATEGORIES, EXPENSE_LABEL, ExpenseCategory, Invoice, Trip } from '../../shared/types';
import { categoryAmount, invoiceTotals, routeKey } from '../../shared/calc';
import { fmtDate, fmtDateTime, fmtDuration, fmtKm, fmtNum, fmtPct, NA } from '../../shared/format';
import { localDate } from '../../shared/time';
import { nameOf } from '../lib';
import { STATIC } from '../static/backend';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

type TTab = 'resumen' | 'presupuesto' | 'gastos' | 'documentos' | 'informes' | 'historial';
export function TripDetail({ id, tab }: { id: string; tab: TTab }) {
  const { data, calcs, money, tz, today, canEdit, run, toast, meta, ask } = useApp();
  const t = data.trips.find(x => x.id === id); const [edit, setEdit] = useState(false);
  const [pdf, setPdf] = useState<{ title: string; src: string } | null>(null);
  const [payFor, setPayFor] = useState<Invoice | null>(null); const [invoicing, setInvoicing] = useState(false);
  const [exp, setExp] = useState<{ category: ExpenseCategory; amount: number | null; date: string; note: string }>({ category: 'fuel', amount: null, date: today, note: '' });
  const [reject, setReject] = useState<string | null>(null); const [rejReason, setRejReason] = useState('');
  const [stop, setStop] = useState<{ start: string | null; end: string | null; reason: string }>({ start: null, end: null, reason: '' });
  const reports = useMemo(() => data.tripReports.filter(r => r.tripId === id).sort((a, b) => b.version - a.version), [data, id]);
  if (!t) return <div className="empty">El viaje no existe. <a href={href('viajes')}>Volver a Viajes</a></div>;
  const c = calcs.get(t.id)!; const s = data.settings; const below = c.marginPct != null && c.marginPct < s.marginTarget;
  const invs = data.invoices.filter(i => i.lines.some(l => l.tripId === t.id));
  const save = (nt: Trip, msg: string) => run(() => api('PUT', `/api/trips/${t.id}`, nt), msg);
  const addExpense = async () => {
    if (exp.amount == null || exp.amount < 0) { toast('Ingresá un importe válido', 'err'); return; }
    const ex = exp.amount === 0 ? undefined : { id: uid(), category: exp.category, amount: exp.amount, date: exp.date, note: exp.note || undefined };
    const nt = ex ? { ...t, expenses: [...t.expenses, ex] } : { ...t, expenseConfirmed: { ...t.expenseConfirmed, [exp.category]: true } };
    if (await save(nt, ex ? 'Gasto registrado' : `${EXPENSE_LABEL[exp.category]} confirmado en $0`)) setExp(e => ({ ...e, amount: null, note: '' }));
  };
  const confirmZero = (cat: ExpenseCategory) => save({ ...t, expenseConfirmed: { ...t.expenseConfirmed, [cat]: true } }, `${EXPENSE_LABEL[cat]} confirmado en $0`);
  const generate = async () => { const r = await run(() => api<{ created: boolean; reason: string }>('POST', `/api/trips/${t.id}/reports`, {})); if (r) toast(r.created ? 'Nueva versión programada.' : r.reason, r.created ? 'ok' : 'warn'); };
  const retry = (rid: string) => run(() => api('POST', `/api/reports/trip/${rid}/retry`, {}), 'Reintento programado');
  const remove = async () => { if (await ask(`¿Eliminar el viaje ${t.id}?`, 'Eliminar')) { if (await run(() => api('DELETE', `/api/trips/${t.id}`), 'Viaje eliminado')) navigate('viajes'); } };
  const history = data.audit.filter(a => a.entityId === t.id).slice(0, 12);
  const uninvoiced = t.status === 'finalizado' && t.serviceValue != null && t.serviceValue - c.invoicedNet > 0.5;
  const planned = plannedCosts(t); const hasBudget = !!planned;

  return (
    <>
      <a className="back" href={href('viajes')}><ArrowLeft size={16} /> Viajes</a>
      <div className="page-head">
        <div><div className="row" style={{ gap: 10 }}><h1>{t.id}</h1><TripChip s={t.status} />{t.status === 'finalizado' && !c.complete && <span className="chip amber"><AlertTriangle size={14} /> Datos pendientes</span>}</div>
          <p>{nameOf.client(data, t.clientId)} · {routeKey(t)} · {nameOf.truck(data, t.truckId)}</p></div>
        <div className="page-actions">
          <button className="btn" onClick={() => setPdf({ title: `Vista previa actual · ${t.id}`, src: `/api/trips/${t.id}/preview.pdf` })}><Eye size={16} /> Vista previa PDF</button>
          <button className="btn" disabled={!canEdit} onClick={generate}><FilePlus2 size={16} /> Generar nueva versión</button>
          <button className="btn primary" disabled={!canEdit} onClick={() => setEdit(true)}><Pencil size={16} /> Editar viaje</button>
        </div>
      </div>

      {t.driverDone && !t.reviewedAt && <div className="banner blue" style={{ marginBottom: 16 }}><div><b>Terminado por {t.driverDone.by}</b> el {fmtDateTime(t.driverDone.at, tz)}: pendiente de revisión administrativa.{canEdit && <> <button className="btn sm" onClick={() => run(() => api('POST', `/api/trips/${t.id}/reviewed`, {}), 'Revisión administrativa registrada')}>Marcar revisión completada</button></>}</div></div>}
      {t.status === 'finalizado' && !c.complete && <div className="banner amber" style={{ marginBottom: 16 }}><AlertTriangle size={18} /><div><b>Resultado provisorio.</b> Faltan: {c.missing.join(' · ')}.</div></div>}
      <div className="kpis" style={{ marginBottom: 16 }}>
        <Kpi label={`Ingreso (${s.profitabilityBasis === 'net' ? 'neto' : 'con IVA'})`} value={money(c.revenue)} sub="Valor del servicio" />
        <Kpi label="Costo total" value={money(c.totalCost)} sub={c.totalCost == null ? 'Se calcula al finalizar' : 'Gastos + asignados'} />
        <Kpi label="Resultado" value={money(c.result)} tone={c.result != null && c.result < 0 ? 'bad' : undefined} sub="Ingreso − costo total" />
        <Kpi label="Margen" value={fmtPct(c.marginPct)} tone={below ? 'warn' : undefined} sub={`Objetivo ${fmtPct(s.marginTarget)}`} />
        <Kpi label="Costo por km" value={money(c.costPerKm)} sub={`Ingreso/km ${money(c.revenuePerKm)}`} />
        <Kpi label="Saldo pendiente" value={money(c.balance)} tone={c.balance > 0.5 && invs.some(i => invoiceTotals(i, data.payments, today, s.dueSoonDays).status === 'vencida') ? 'warn' : undefined} sub={invs.length ? `Facturado ${money(c.invoicedTotal)}` : 'Sin facturar'} />
      </div>

      <Tabs<TTab> value={tab} onChange={x => navigate(`viajes/${t.id}`, { tab: x === 'resumen' ? undefined : x })} tabs={[{ id: 'resumen', label: 'Resumen' }, { id: 'presupuesto', label: 'Presupuesto y resultado' }, { id: 'gastos', label: `Gastos${c.pendingReview.count ? ` (${c.pendingReview.count} por revisar)` : ''}` }, { id: 'documentos', label: `Documentos (${data.files.filter(f => f.entityId === t.id || f.links.some(l => l.id === t.id || t.expenses.some(e => e.id === l.id)) || t.expenses.some(e => e.id === f.entityId)).length})` }, { id: 'informes', label: 'Informes' }, { id: 'historial', label: 'Historial' }]} />
      {tab === 'resumen' && <>
      <div className="cols" style={{ marginBottom: 16 }}>
        <div className="stack">
          <section className="panel"><div className="panel-h"><h2>Datos del viaje</h2></div><div className="panel-b">
            <dl className="kv">
              <dt>Cliente</dt><dd>{nameOf.client(data, t.clientId)}</dd><dt>Ruta</dt><dd>{routeKey(t)}</dd>
              <dt>Camión</dt><dd><a href={href(`flota/${t.truckId}`)}>{nameOf.truck(data, t.truckId)}</a> · {data.trucks.find(x => x.id === t.truckId)?.plate}</dd><dt>Chofer</dt><dd>{nameOf.driver(data, t.driverId)}</dd>
              <dt>Fecha de operación</dt><dd>{fmtDate(localDate(t.actualDeparture ?? t.plannedDeparture ?? t.createdAt, tz))} <span className="muted small">(salida {t.actualDeparture ? 'real' : 'prevista'}; define el mes del viaje)</span></dd>
            </dl></div>
            <div className="table-wrap"><table className="tbl"><thead><tr><th></th><th>Previsto</th><th>Real</th></tr></thead><tbody>
              <tr><td>Salida</td><td>{fmtDateTime(t.plannedDeparture, tz)}</td><td>{fmtDateTime(t.actualDeparture, tz)}</td></tr>
              <tr><td>Llegada</td><td>{fmtDateTime(t.plannedArrival, tz)}</td><td>{fmtDateTime(t.actualArrival, tz)}</td></tr>
              <tr><td>Duración</td><td>{fmtDuration(c.plannedDurationMin)}</td><td>{c.durationMin == null ? <span className="muted">No disponible (requiere horarios reales)</span> : fmtDuration(c.durationMin)}</td></tr>
              {c.stopsMin != null && <><tr><td>Paradas registradas</td><td></td><td>{fmtDuration(c.stopsMin)}</td></tr><tr><td>Tiempo de conducción</td><td></td><td>{fmtDuration(c.drivingMin)}</td></tr></>}
            </tbody></table></div>
            <div className="table-wrap"><table className="tbl"><thead><tr><th>Kilómetros</th><th className="num">Con carga</th><th className="num">Vacíos</th><th className="num">Totales</th><th className="num">Odómetro</th></tr></thead><tbody>
              <tr><td>Recorrido</td><td className="num">{fmtKm(t.kmLoaded)}</td><td className="num">{fmtKm(t.kmEmpty)}</td><td className="num"><b>{fmtKm(c.kmTotal)}</b></td><td className="num">{t.odometerStart != null && t.odometerEnd != null ? `${fmtNum(t.odometerStart)} → ${fmtNum(t.odometerEnd)}` : <span className="muted">No registrado</span>}</td></tr></tbody></table></div>
            {t.notes && <div className="panel-b"><div className="muted small">Observaciones</div>{t.notes}</div>}
            {t.instructions && <div className="panel-b" style={{ borderTop: '1px solid var(--line)' }}><div className="muted small">Instrucciones para el chofer</div>{t.instructions}</div>}
            {(t.incidents ?? []).length > 0 && <div className="panel-b" style={{ borderTop: '1px solid var(--line)' }}><div className="muted small">Incidentes y observaciones del chofer</div>{t.incidents!.map(i => <div key={i.id} className="small"><AlertTriangle size={13} style={{ verticalAlign: -2 }} /> {fmtDateTime(i.at, tz)} · {i.by}: {i.text}</div>)}</div>}
            {(t.timeCorrections ?? []).length > 0 && <div className="panel-b" style={{ borderTop: '1px solid var(--line)' }}><div className="muted small">Registros y correcciones de horarios</div>{t.timeCorrections!.map(x => <div key={x.id} className="small">{fmtDateTime(x.at, tz)} · {x.by}: {x.field === 'actualDeparture' ? 'salida' : 'llegada'} {x.oldValue ? `${fmtDateTime(x.oldValue, tz)} → ` : ''}{fmtDateTime(x.newValue, tz)} · motivo: {x.reason}</div>)}</div>}
          </section>

          <section className="panel"><div className="panel-h"><h2>Paradas</h2><span className="muted small">Permiten calcular tiempo de conducción</span></div>
            <div className="table-wrap"><table className="tbl"><thead><tr><th>Inicio</th><th>Fin</th><th>Motivo</th><th></th></tr></thead><tbody>
              {(t.stops ?? []).map(sp => <tr key={sp.id}><td>{fmtDateTime(sp.start, tz)}</td><td>{fmtDateTime(sp.end, tz)}</td><td>{sp.reason || '—'}</td><td className="num">{canEdit && <button className="btn sm ghost danger" aria-label="Quitar parada" onClick={() => save({ ...t, stops: (t.stops ?? []).filter(x => x.id !== sp.id) }, 'Parada eliminada')}><Trash2 size={15} /></button>}</td></tr>)}
              {!(t.stops ?? []).length && <tr><td colSpan={4} className="muted">Sin paradas registradas: el tiempo de conducción figura como No disponible.</td></tr>}</tbody></table></div>
            {canEdit && <div className="panel-b grid g4" style={{ alignItems: 'end', borderTop: '1px solid var(--line)' }}>
              <DateTimeField label="Inicio" tz={tz} value={stop.start} onChange={x => setStop(s => ({ ...s, start: x }))} /><DateTimeField label="Fin" tz={tz} value={stop.end} onChange={x => setStop(s => ({ ...s, end: x }))} />
              <Field label="Motivo"><input type="text" value={stop.reason} onChange={e => setStop(s => ({ ...s, reason: e.target.value }))} /></Field>
              <button className="btn" disabled={!stop.start || !stop.end || stop.end <= stop.start} onClick={async () => { if (await save({ ...t, stops: [...(t.stops ?? []), { id: uid(), start: stop.start!, end: stop.end!, reason: stop.reason || undefined }] }, 'Parada registrada')) setStop({ start: null, end: null, reason: '' }); }}><Plus size={16} /> Agregar parada</button></div>}
          </section>
        </div>

        <div className="stack">
          <section className="panel"><div className="panel-h"><h2>Gastos y costos</h2></div>
            <div className="table-wrap"><table className="tbl"><thead><tr><th>Concepto</th><th className="num">Registrado</th>{hasBudget && <th className="num hide-sm">Presupuesto</th>}{hasBudget && <th className="num hide-sm">Diferencia</th>}</tr></thead><tbody>
              {EXPENSE_CATEGORIES.map(cat => { const v = c.direct[cat]; const b = planned?.[cat]; const diff = v != null && b != null ? v - b : null; return (
                <tr key={cat}><td>{EXPENSE_LABEL[cat]}</td>
                  <td className="num">{v == null ? (cat === 'other' ? <span className="muted small">Sin registrar (opcional)</span> : <span className="chip amber">Pendiente de carga</span>) : <>{money(v)}{v === 0 && <span className="muted small"> confirmado</span>}</>}</td>
                  {hasBudget && <td className="num hide-sm">{b != null ? money(b) : '—'}</td>}{hasBudget && <td className={`num hide-sm ${diff != null && diff > 0 ? 'warn' : ''}`}>{diff == null ? '—' : `${diff > 0 ? '+' : ''}${money(diff)}`}</td>}</tr>); })}
              <tr><td><b>Gastos registrados</b></td><td className="num"><b>{money(c.directTotal)}</b></td>{hasBudget && <><td className="num hide-sm"></td><td className="num hide-sm"></td></>}</tr>
              <tr><td>Costos operativos asignados<div className="muted small">Costos mensuales del camión repartidos por km</div></td><td className="num">{c.allocated == null ? <span className="muted">{NA}</span> : money(c.allocated)}</td>{hasBudget && <><td className="num hide-sm"></td><td className="num hide-sm"></td></>}</tr>
              <tr><td><b>Costo total</b></td><td className="num"><b>{money(c.totalCost)}</b></td>{hasBudget && <><td className="num hide-sm"></td><td className="num hide-sm"></td></>}</tr>
            </tbody></table></div></section>

          <section className="panel"><div className="panel-h"><h2>Estimaciones de uso del vehículo</h2><span className="chip gray">Estimación económica</span></div>
            {c.estimates ? <div className="table-wrap"><table className="tbl"><tbody>
              <tr><td>Mantenimiento</td><td className="num">{money(c.estimates.maintenance)}</td></tr><tr><td>Neumáticos</td><td className="num">{money(c.estimates.tires)}</td></tr><tr><td>Depreciación económica</td><td className="num">{money(c.estimates.depreciation)}</td></tr>
              <tr><td><b>Total estimado</b></td><td className="num"><b>{money(c.estimates.total)}</b></td></tr>
              <tr><td className="muted">Resultado económico (resultado − estimaciones)</td><td className="num muted">{money(c.economicResult)}</td></tr></tbody></table></div>
              : <div className="panel-b muted">No disponible: faltan los km del viaje o los parámetros del vehículo (ver Flota → Parámetros).</div>}
            <div className="panel-b muted small" style={{ borderTop: '1px solid var(--line)' }}>Son estimaciones económicas con parámetros configurados; no miden el desgaste físico ni son un diagnóstico mecánico. No se suman al costo total.</div></section>
        </div>
      </div>

      <section className="panel" style={{ marginBottom: 16 }}><div className="panel-h"><h2>Facturación y cobros</h2>
        <div className="row">{uninvoiced && canEdit && <button className="btn" onClick={() => setInvoicing(true)}><Receipt size={16} /> Facturar este viaje</button>}</div></div>
        <div className="table-wrap"><table className="tbl"><thead><tr><th>Factura</th><th>Emisión</th><th>Vencimiento</th><th className="num">Total ajustado</th><th className="num">Cobrado</th><th className="num">Saldo</th><th>Estado</th><th></th></tr></thead><tbody>
          {invs.map(i => { const it = invoiceTotals(i, data.payments, today, s.dueSoonDays); return <tr key={i.id}><td>{i.number}</td><td>{fmtDate(i.issueDate)}</td><td>{fmtDate(i.dueDate)}</td><td className="num">{money(it.adjusted)}</td><td className="num">{money(it.paid)}</td><td className="num">{money(it.balance)}</td><td><InvChip t={it} /></td>
            <td className="num">{canEdit && it.balance > 0.005 && <button className="btn sm" onClick={() => setPayFor(i)}>Registrar cobro</button>}</td></tr>; })}
          {!invs.length && <tr><td colSpan={8} className="muted">{t.status === 'finalizado' ? 'Este viaje todavía no está facturado.' : 'Sin facturas. Se factura cuando el viaje finaliza.'}</td></tr>}</tbody></table></div>
        {invs.length > 0 && <div className="panel-b muted small" style={{ borderTop: '1px solid var(--line)' }}>Facturado neto: {money(c.invoicedNet)} de {money(t.serviceValue)} · Los montos de facturas que agrupan varios viajes se atribuyen en proporción al neto de cada viaje.</div>}
      </section>

      </>}
      {tab === 'presupuesto' && <>
      <BudgetPanel trip={t} calc={c} />
      </>}
      {tab === 'gastos' && <>
      {c.pendingReview.count > 0 && <div className="banner amber" style={{ marginBottom: 16 }}><AlertTriangle size={18} /><div><b>{c.pendingReview.count} gasto(s) pendiente(s) de revisión por {money(c.pendingReview.amount)}.</b> No suman al costo hasta aprobarse. Resultado si se aprueban todos: <b>{money(c.resultIfApproved)}</b>.</div></div>}
      <section className="panel" style={{ marginBottom: 16 }}><div className="panel-h"><h2>Registro de gastos</h2></div>
        <div className="table-wrap"><table className="tbl"><thead><tr><th>Categoría</th><th>Fecha</th><th>Nota / origen</th><th className="num">Importe</th><th>Estado</th><th></th></tr></thead><tbody>
          {t.expenses.map(e => <tr key={e.id}><td>{EXPENSE_LABEL[e.category]}</td><td>{fmtDate(e.date)}</td><td className="wrap">{e.note || '—'}{e.createdBy && <div className="muted small">Cargado por {e.createdBy}</div>}{e.status === 'rechazado' && e.rejectionReason && <div className="small neg">Motivo del rechazo: {e.rejectionReason}</div>}{filesFor(data.files, 'gasto', e.id).length > 0 && <div className="small"><button className="btn sm ghost" onClick={() => navigate(`viajes/${t.id}`, { tab: 'documentos' })}><Paperclip size={13} /> {filesFor(data.files, 'gasto', e.id).length} comprobante(s)</button></div>}</td>
            <td className="num">{money(e.amount, 2)}</td><td>{e.status === 'pendiente_revision' ? <span className="chip amber">Pendiente de revisión</span> : e.status === 'rechazado' ? <span className="chip red">Rechazado</span> : e.status === 'aprobado' ? <span className="chip accent">Aprobado</span> : <span className="chip gray">Oficina</span>}</td>
            <td className="num"><div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>{canEdit && e.status === 'pendiente_revision' && <><button className="btn sm primary" onClick={() => run(() => api('POST', `/api/trips/${t.id}/expenses/${e.id}/review`, { decision: 'aprobado' }), 'Gasto aprobado (no se duplica: es el mismo registro)')}>Aprobar</button><button className="btn sm" onClick={() => setReject(e.id)}>Rechazar</button></>}
              {canEdit && !e.createdById && <button className="btn sm ghost danger" aria-label="Eliminar gasto" onClick={() => save({ ...t, expenses: t.expenses.filter(x => x.id !== e.id) }, 'Gasto eliminado')}><Trash2 size={15} /></button>}</div></td></tr>)}
          {c.pendingCategories.map(cat => <tr key={cat}><td>{EXPENSE_LABEL[cat]}</td><td colSpan={2}><span className="chip amber">Pendiente de carga</span></td><td className="num"></td><td></td><td className="num">{canEdit && <button className="btn sm" onClick={() => confirmZero(cat)}>Confirmar $0</button>}</td></tr>)}
          {!t.expenses.length && !c.pendingCategories.length && <tr><td colSpan={6} className="muted">Sin gastos registrados.</td></tr>}</tbody></table></div>
        {canEdit && <div className="panel-b grid g4" style={{ alignItems: 'end', borderTop: '1px solid var(--line)' }}>
          <Field label="Categoría"><select value={exp.category} onChange={e => setExp(x => ({ ...x, category: e.target.value as ExpenseCategory }))}>{EXPENSE_CATEGORIES.map(k => <option key={k} value={k}>{EXPENSE_LABEL[k]}</option>)}</select></Field>
          <NumField label="Importe" prefix="$" value={exp.amount} onChange={v => setExp(x => ({ ...x, amount: v }))} hint="0 confirma el gasto en $0" />
          <Field label="Fecha"><input type="date" value={exp.date} onChange={e => setExp(x => ({ ...x, date: e.target.value }))} /></Field>
          <Field label="Nota"><input type="text" value={exp.note} onChange={e => setExp(x => ({ ...x, note: e.target.value }))} /></Field>
          <div><button className="btn primary" disabled={exp.amount == null} onClick={addExpense}><Plus size={16} /> Registrar gasto</button></div></div>}
      </section>

      </>}
      {tab === 'documentos' && <>
      <FilesPanel entityType="viaje" entityId={t.id} title="Comprobantes y documentos del viaje" extraIds={t.expenses.map(e => e.id)} expenseOptions={t.expenses.map(e => ({ id: e.id, label: `${EXPENSE_LABEL[e.category]} ${money(e.amount, 2)}` }))} />
      </>}
      {tab === 'informes' && <>
      <section className="panel" style={{ marginBottom: 16 }}><div className="panel-h"><h2>Fichas PDF y versiones</h2><span className="muted small">Se generan en el servidor tras guardar (agrupa cambios por {Math.round(meta.debounceMs / 1000)} s; objetivo: disponible en 2–3 min)</span></div>
        <div className="table-wrap"><table className="tbl"><thead><tr><th>Versión</th><th>Estado</th><th>Tipo</th><th>Generada</th><th className="hide-sm">Detalle</th><th></th></tr></thead><tbody>
          {reports.map(r => <tr key={r.id}><td>v{r.version}</td><td><ReportChip s={r.status} /></td><td>{r.status === 'disponible' ? (r.provisional ? <span className="chip amber">Provisorio</span> : <span className="chip accent">Completo</span>) : '—'}</td>
            <td>{r.generatedAt ? fmtDateTime(r.generatedAt, tz) : r.status === 'pendiente' && r.scheduledFor ? `Programada ${fmtDateTime(r.scheduledFor, tz)}` : '—'}</td>
            <td className="hide-sm wrap small muted">{r.status === 'error' ? `${r.error} (intentos: ${r.attempts})` : r.status === 'generando' ? `Intento ${r.attempts}` : r.missing.length ? `Faltaba: ${r.missing.join('; ')}` : ''}</td>
            <td className="num"><div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
              {r.status === 'disponible' && <><button className="btn sm" onClick={() => setPdf({ title: `${t.id} · v${r.version}`, src: `/api/reports/trip/${r.id}/file` })}><Eye size={15} /> Ver</button>{!STATIC && <button className="btn sm" onClick={() => saveBlob(`/api/reports/trip/${r.id}/file?download=1`, 'informe.pdf').catch(e => toast(e.message, 'err'))}><Download size={15} /> PDF</button>}</>}
              {r.status === 'error' && canEdit && <button className="btn sm" onClick={() => retry(r.id)}><RotateCw size={15} /> Reintentar</button>}</div></td></tr>)}
          {!reports.length && <tr><td colSpan={6} className="muted">Todavía no hay fichas. Guardá el viaje o pedí una nueva versión.</td></tr>}</tbody></table></div></section>

      </>}
      {tab === 'historial' && <>
      <HistoryPanel refId={t.id} />
      {canEdit && (t.status === 'planificado' || t.status === 'cancelado') && !invs.length && <div style={{ marginTop: 16 }}><button className="btn danger sm" onClick={remove}><Trash2 size={15} /> Eliminar viaje</button></div>}
      </>}
      {reject && <Modal title="Rechazar gasto" onClose={() => { setReject(null); setRejReason(''); }} footer={<><button className="btn" onClick={() => setReject(null)}>Cancelar</button><button className="btn primary" disabled={!rejReason.trim()} onClick={async () => { if (await run(() => api('POST', `/api/trips/${t.id}/expenses/${reject}/review`, { decision: 'rechazado', reason: rejReason }), 'Gasto rechazado')) { setReject(null); setRejReason(''); } }}>Rechazar</button></>}><Field label="Motivo (lo ve el chofer)"><textarea value={rejReason} onChange={e => setRejReason(e.target.value)} /></Field></Modal>}
      {edit && <TripForm trip={t} isNew={false} onClose={() => setEdit(false)} />}
      {pdf && <PdfModal title={pdf.title} src={pdf.src} onClose={() => setPdf(null)} />}
      {payFor && <PaymentModal invoice={payFor} onClose={() => setPayFor(null)} />}
      {invoicing && <InvoiceModal clientId={t.clientId} tripIds={[t.id]} onClose={() => setInvoicing(false)} />}
    </>
  );
}
void categoryAmount;
