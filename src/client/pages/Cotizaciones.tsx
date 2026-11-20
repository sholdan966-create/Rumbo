import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Copy, Eye, FileDown, Plus, Send, Wand2, X } from 'lucide-react';
import { useApp } from '../store';
import { api, saveBlob } from '../api';
import { Route, href, navigate } from '../router';
import { Field, Kpi, Modal, NumField, PdfModal } from '../components/ui';
import { HistoryPanel } from '../components/Attach';
import { BUDGET_CATS, BUDGET_LABEL, BudgetCat, Quote, QuoteCost, QuoteStatus } from '../../shared/types';
import { QUOTE_LABEL, emptyCosts, quoteCalc, quoteStatus, validateQuote } from '../../shared/quote';
import { fmtDate, fmtDateTime, fmtMoney, fmtPct, NA } from '../../shared/format';
import { addDays, localInputToIso } from '../../shared/time';
import { nameOf } from '../lib';
import { STATIC } from '../static/backend';

const CHIP: Record<QuoteStatus, string> = { borrador: 'gray', enviada: 'blue', aceptada: 'accent', rechazada: 'red', vencida: 'amber' };
export const QuoteChip = ({ s }: { s: QuoteStatus }) => <span className={`chip ${CHIP[s]}`}>{QUOTE_LABEL[s]}</span>;

export function Cotizaciones({ route }: { route: Route }) {
  const id = route.path[1];
  return id ? <QuoteView id={id} /> : <QuoteList route={route} />;
}

function QuoteList({ route }: { route: Route }) {
  const { data, today, money, canEdit } = useApp(); const q = route.query;
  const f = { estado: q.get('estado') ?? '', client: q.get('client') ?? '', q: q.get('q') ?? '' };
  const set = (k: string, v: string) => navigate('cotizaciones', Object.fromEntries(Object.entries({ ...f, [k]: v }).filter(([, x]) => x)));
  const rows = useMemo(() => data.quotes.map(x => ({ x, st: quoteStatus(x, today), c: quoteCalc(x) })).filter(({ x, st }) => (!f.estado || st === f.estado) && (!f.client || x.clientId === f.client) && (!f.q || `${x.number} ${x.origin} ${x.destination} ${nameOf.client(data, x.clientId)}`.toLowerCase().includes(f.q.toLowerCase()))).sort((a, b) => b.x.createdAt.localeCompare(a.x.createdAt)), [data, today, f.estado, f.client, f.q]); // eslint-disable-line
  const open = data.quotes.filter(x => quoteStatus(x, today) === 'enviada'); const unconverted = data.quotes.filter(x => x.status === 'aceptada' && !x.tripId);
  return (
    <>
      <div className="page-head"><div><h1>Cotizaciones</h1><p>Propuestas comerciales con costo estimado, precio sugerido y margen. Una cotización aceptada se convierte en viaje sin volver a cargar datos.</p></div>
        <div className="page-actions"><button className="btn primary" disabled={!canEdit} onClick={() => navigate('cotizaciones/nueva')}><Plus size={16} /> Nueva cotización</button></div></div>
      <div className="kpis" style={{ marginBottom: 16, gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
        <Kpi label="Enviadas sin respuesta" value={open.length} sub={money(open.reduce((a, x) => a + (quoteCalc(x).priceNet ?? 0), 0)) + ' netos'} />
        <Kpi label="Por vencer (7 días)" value={open.filter(x => x.validUntil <= addDays(today, 7)).length} tone={open.some(x => x.validUntil <= addDays(today, 7)) ? 'warn' : undefined} sub="Vigencia próxima" />
        <Kpi label="Aceptadas sin viaje" value={unconverted.length} tone={unconverted.length ? 'warn' : undefined} sub="Pendientes de convertir" />
        <Kpi label="Borradores" value={data.quotes.filter(x => x.status === 'borrador' && quoteStatus(x, today) === 'borrador').length} sub="Sin enviar" />
      </div>
      <div className="filters"><Field label="Buscar" className="grow"><input type="search" value={f.q} onChange={e => set('q', e.target.value)} placeholder="Número, cliente o ruta" /></Field>
        <Field label="Estado"><select value={f.estado} onChange={e => set('estado', e.target.value)}><option value="">Todos</option>{(Object.keys(QUOTE_LABEL) as QuoteStatus[]).map(s => <option key={s} value={s}>{QUOTE_LABEL[s]}</option>)}</select></Field>
        <Field label="Cliente"><select value={f.client} onChange={e => set('client', e.target.value)}><option value="">Todos</option>{data.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field></div>
      <section className="panel"><div className="table-wrap"><table className="tbl"><thead><tr><th>Número</th><th>Cliente</th><th>Ruta</th><th className="num">Precio neto</th><th className="num hide-sm">Margen esperado</th><th>Vigencia</th><th>Estado</th></tr></thead><tbody>
        {rows.map(({ x, st, c }) => <tr key={x.id} className="click" onClick={() => navigate(`cotizaciones/${x.id}`)}><td className="id"><a href={href(`cotizaciones/${x.id}`)}>{x.number}</a></td><td className="trunc">{nameOf.client(data, x.clientId)}</td><td className="nowrap">{x.origin} – {x.destination}</td>
          <td className="num">{money(c.priceNet)}</td><td className={`num hide-sm ${c.marginPct != null && c.marginPct < data.settings.marginTarget ? 'warn' : ''}`}>{fmtPct(c.marginPct)}</td><td className="nowrap">{fmtDate(x.validUntil)}</td><td><QuoteChip s={st} />{x.tripId && <a className="chip accent" style={{ marginLeft: 4 }} href={href(`viajes/${x.tripId}`)} onClick={e => e.stopPropagation()}>{x.tripId}</a>}</td></tr>)}
        {!rows.length && <tr><td colSpan={7} className="empty">No hay cotizaciones con esos filtros.</td></tr>}</tbody></table></div></section>
    </>
  );
}

function blank(d: ReturnType<typeof useApp>['data'], today: string, clientId?: string): Quote {
  return { id: crypto.randomUUID(), number: '', clientId: clientId ?? d.clients[0]?.id ?? '', origin: 'Rosario', destination: '', truckId: d.trucks[0]?.id ?? null, vehicleType: d.trucks.length ? '' : 'Semirremolque', kmLoaded: null, kmEmpty: null, plannedHours: null, costs: emptyCosts(), marginTarget: d.settings.marginTarget, priceNet: null,
    ivaRate: d.settings.defaultIvaRate, validUntil: addDays(today, d.settings.quoteValidityDays), notes: '', terms: d.settings.quoteTerms, status: 'borrador', shares: [], acceptance: null, rejection: null, tripId: null, createdAt: '', updatedAt: '', createdBy: '' };
}

function QuoteView({ id }: { id: string }) {
  const { data, today, money, canEdit, run, toast, tz } = useApp(); const isNew = id === 'nueva';
  const saved = data.quotes.find(x => x.id === id);
  const [q, setQ] = useState<Quote | null>(() => (isNew ? blank(data, today) : saved ? JSON.parse(JSON.stringify(saved)) : null));
  const [newClient, setNewClient] = useState<string | null>(data.clients.length === 0 ? '' : null);
  const [dialog, setDialog] = useState<'share' | 'accept' | 'reject' | 'convert' | null>(null); const [pdf, setPdf] = useState(false); const [saving, setSaving] = useState(false); const [touched, setTouched] = useState(false);
  // el servidor es la fuente de verdad: al confirmarse un guardado (cambia updatedAt) se recarga el formulario con lo guardado
  useEffect(() => { if (saved && !isNew) setQ(JSON.parse(JSON.stringify(saved))); }, [saved?.updatedAt, isNew]); // eslint-disable-line
  if (!q) return <div className="empty">La cotización no existe. <a href={href('cotizaciones')}>Volver</a></div>;
  const locked = !isNew && (q.status === 'aceptada' || q.status === 'rechazada'); const dis = locked || !canEdit;
  const calc = quoteCalc(q); const pendingClient = newClient != null; const errs = validateQuote(pendingClient ? { ...q, clientId: newClient!.trim() ? '__nuevo' : '' } : q, pendingClient && newClient!.trim() ? { ...data, clients: [...data.clients, { id: '__nuevo', name: newClient!, cuit: '', paymentTermDays: 30 }] } : data); const st = quoteStatus(q, today);
  const set = <K extends keyof Quote>(k: K, v: Quote[K]) => setQ(x => x && ({ ...x, [k]: v }));
  const setCost = (c: BudgetCat, patch: Partial<QuoteCost>) => setQ(x => x && ({ ...x, costs: { ...x.costs, [c]: { ...x.costs[c], ...patch } } }));
  const suggest = async () => {
    const r = await run(() => api<{ costs: Record<BudgetCat, QuoteCost> }>('POST', '/api/quotes/suggest', { truckId: q.truckId, origin: q.origin, destination: q.destination, kmLoaded: q.kmLoaded, kmEmpty: q.kmEmpty }));
    if (r) { setQ(x => x && ({ ...x, costs: r.costs })); const found = BUDGET_CATS.some(c => r.costs[c].amount > 0); toast(found ? 'Costos sugeridos con su origen. Revisalos y ajustalos si hace falta.' : 'Todavía no hay datos para sugerir: cargá los costos a mano. Con viajes finalizados de la ruta y el consumo del camión (Flota → Parámetros) más el precio del combustible (Configuración), se sugieren solos.', found ? 'ok' : 'warn'); }
  };
  const save = async () => {
    setTouched(true); if (errs.length) { toast(`Falta completar: ${errs.join(' · ')}`, 'err'); return; } setSaving(true);
    let body = q;
    if (pendingClient && newClient!.trim()) { const cid = `C${Date.now().toString(36)}`; const c = await run(() => api('PUT', `/api/clients/${cid}`, { id: cid, name: newClient!.trim(), cuit: '', paymentTermDays: 30 })); if (!c) { setSaving(false); return; } body = { ...q, clientId: cid }; setNewClient(null); setQ(body); }
    const r = await run(() => api<{ quote: Quote }>('PUT', `/api/quotes/${q.id}`, body), 'Cotización guardada'); setSaving(false); if (r && isNew) navigate(`cotizaciones/${q.id}`);
  };
  const act = async (path: string, body: unknown, msg: string) => { const r = await run(() => api('POST', `/api/quotes/${q.id}/${path}`, body), msg); if (r) setDialog(null); return r as any; };
  const margin = calc.marginPct; const belowTarget = margin != null && margin < q.marginTarget - 0.05;
  const e = (f: string) => touched ? errs.find(x => x.toLowerCase().includes(f)) : undefined;

  return (
    <>
      <a className="back" href={href('cotizaciones')}><ArrowLeft size={16} /> Cotizaciones</a>
      <div className="page-head"><div><div className="row"><h1>{isNew ? 'Nueva cotización' : q.number}</h1>{!isNew && <QuoteChip s={st} />}{q.tripId && <a className="chip accent" href={href(`viajes/${q.tripId}`)}>Viaje {q.tripId}</a>}</div>
        <p>{nameOf.client(data, q.clientId)} · {q.origin || '…'} – {q.destination || '…'}{!isNew && st === 'vencida' ? ' · la vigencia venció: duplicá la cotización para renovarla' : ''}</p></div>
        <div className="page-actions">
          {!isNew && <><button className="btn" onClick={() => setPdf(true)}><Eye size={16} /> PDF para el cliente</button><button className="btn" disabled={!canEdit} onClick={async () => { const r = await run(() => api<{ quote: Quote }>('POST', `/api/quotes/${q.id}/duplicate`, {}), 'Cotización duplicada como borrador'); if (r) navigate(`cotizaciones/${r.quote.id}`); }}><Copy size={16} /> Duplicar</button></>}
          {!dis && <button className="btn primary" disabled={saving} onClick={save}>{saving ? 'Guardando…' : 'Guardar'}</button>}
        </div></div>
      {locked && <div className="banner blue" style={{ marginBottom: 14 }}><div>{q.status === 'aceptada' ? 'Cotización aceptada: queda como registro y no se modifica. ' : 'Cotización rechazada. '}Para una nueva propuesta usá <b>Duplicar</b>.</div></div>}

      {!isNew && <section className="panel" style={{ marginBottom: 16 }}><div className="panel-b row between">
        <div className="small"><b>Seguimiento comercial.</b> {q.shares.length ? `Compartida ${q.shares.length} vez/veces; la última por ${q.shares[q.shares.length - 1].channel} el ${fmtDateTime(q.shares[q.shares.length - 1].at, tz)}.` : 'Todavía no se registró que se haya compartido.'}{q.acceptance && <> Aceptación registrada manualmente por {q.acceptance.by} el {fmtDateTime(q.acceptance.at, tz)}{q.acceptance.note ? ` (${q.acceptance.note})` : ''}.</>}{q.rejection && <> Rechazada: {q.rejection.reason}</>}</div>
        <div className="row">{canEdit && (q.status === 'borrador' || q.status === 'enviada') && <button className="btn" onClick={() => setDialog('share')}><Send size={15} /> Registrar envío</button>}
          {canEdit && (q.status === 'borrador' || q.status === 'enviada') && <button className="btn" onClick={() => setDialog('accept')}><Check size={15} /> Registrar aceptación</button>}
          {canEdit && (q.status === 'borrador' || q.status === 'enviada') && <button className="btn" onClick={() => setDialog('reject')}><X size={15} /> Registrar rechazo</button>}
          {canEdit && q.status === 'aceptada' && !q.tripId && <button className="btn primary" onClick={() => setDialog('convert')}><ArrowRight size={15} /> Convertir en viaje</button>}</div></div>
        <div className="panel-b muted small" style={{ borderTop: '1px solid var(--line)' }}>La aceptación y el envío se registran manualmente: RUMBO no tiene un mecanismo para que el cliente confirme la propuesta por su cuenta.</div></section>}

      <div className="cols" style={{ marginBottom: 16 }}>
        <div className="stack">
          <section className="panel"><div className="panel-h"><h2>Servicio</h2></div><div className="panel-b grid g2">
            {newClient != null
              ? <Field label="Cliente nuevo" error={e('cliente')} hint={data.clients.length === 0 ? 'Todavía no hay clientes: escribí el nombre y se crea al guardar.' : undefined}><div className="row" style={{ flexWrap: 'nowrap' }}><input type="text" autoFocus={!data.clients.length} value={newClient} onChange={ev => setNewClient(ev.target.value)} placeholder="Razón social del cliente" />{data.clients.length > 0 && <button type="button" className="btn sm" onClick={() => setNewClient(null)}>Cancelar</button>}</div></Field>
              : <Field label="Cliente" error={e('cliente')}><select disabled={dis} value={q.clientId} onChange={ev => ev.target.value === '__new' ? setNewClient('') : set('clientId', ev.target.value)}>{data.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}{!dis && <option value="__new">+ Agregar cliente nuevo…</option>}</select></Field>}
            <Field label="Vehículo"><select disabled={dis} value={q.truckId ?? ''} onChange={ev => set('truckId', ev.target.value || null)}><option value="">Otro tipo de vehículo…</option>{data.trucks.map(t => <option key={t.id} value={t.id}>{t.name} · {t.model}</option>)}</select></Field>
            {!q.truckId && <Field label="Tipo de vehículo" error={e('vehículo')}><input disabled={dis} type="text" value={q.vehicleType} onChange={ev => set('vehicleType', ev.target.value)} placeholder="Ej.: Semirremolque 28 t" /></Field>}
            <Field label="Origen" error={e('origen')}><input disabled={dis} type="text" list="places" value={q.origin} onChange={ev => set('origin', ev.target.value)} /></Field><Field label="Destino"><input disabled={dis} type="text" list="places" value={q.destination} onChange={ev => set('destination', ev.target.value)} /></Field>
            <NumField label="Km estimados con carga" disabled={dis} value={q.kmLoaded} onChange={v => set('kmLoaded', v)} /><NumField label="Km estimados vacíos" disabled={dis} value={q.kmEmpty} onChange={v => set('kmEmpty', v)} />
            <NumField label="Duración prevista (horas)" disabled={dis} value={q.plannedHours} onChange={v => set('plannedHours', v)} />
            <Field label="Vigencia de la propuesta (hasta)" error={e('vigencia')}><input disabled={dis} type="date" value={q.validUntil} onChange={ev => set('validUntil', ev.target.value)} /></Field></div></section>

          <section className="panel"><div className="panel-h"><h2>Costos estimados</h2>{!dis && <button className="btn sm" onClick={suggest}><Wand2 size={14} /> Sugerir desde parámetros e historial</button>}</div>
            <div className="table-wrap"><table className="tbl"><thead><tr><th style={{ width: 36 }}>Incl.</th><th>Concepto</th><th className="num" style={{ width: 170 }}>Importe</th><th>Origen de la estimación</th></tr></thead><tbody>
              {BUDGET_CATS.map(c => <tr key={c}><td><input type="checkbox" aria-label={`Incluir ${BUDGET_LABEL[c]}`} disabled={dis} checked={q.costs[c].included} onChange={ev => setCost(c, { included: ev.target.checked })} /></td><td>{BUDGET_LABEL[c]}</td>
                <td><input type="number" min={0} style={{ textAlign: 'right' }} disabled={dis} value={q.costs[c].amount} onChange={ev => setCost(c, { amount: Number(ev.target.value), source: q.costs[c].source.startsWith('Ajuste manual') ? q.costs[c].source : `Ajuste manual (antes: ${q.costs[c].source})`.slice(0, 160) })} /></td>
                <td><input type="text" aria-label={`Origen ${BUDGET_LABEL[c]}`} disabled={dis} value={q.costs[c].source} onChange={ev => setCost(c, { source: ev.target.value })} /></td></tr>)}</tbody>
              <tfoot><tr><td></td><td>Costo estimado (suma de los incluidos)</td><td className="num">{money(calc.cost, 2)}</td><td></td></tr></tfoot></table></div>
            <div className="panel-b muted small" style={{ borderTop: '1px solid var(--line)' }}>Combustible usa los parámetros del vehículo (consumo y precio configurados) cuando existen; peajes, chofer y viáticos usan el promedio de viajes finalizados de la ruta. Si no hay dato, queda en $0 como “Sin dato: completar”. Podés ajustar cualquier importe: el origen se anota junto al valor.</div></section>

          <section className="panel"><div className="panel-h"><h2>Condiciones comerciales</h2></div><div className="panel-b stack">
            <Field label="Condiciones (se imprimen en el PDF del cliente)"><textarea disabled={dis} value={q.terms} onChange={ev => set('terms', ev.target.value)} /></Field>
            <Field label="Observaciones"><textarea disabled={dis} value={q.notes} onChange={ev => set('notes', ev.target.value)} /></Field></div></section>
        </div>

        <div className="stack">
          <section className="panel"><div className="panel-h"><h2>Precio y margen</h2><span className="chip gray">Interno</span></div><div className="panel-b stack">
            <NumField label="Margen objetivo (%)" disabled={dis} value={q.marginTarget} onChange={v => set('marginTarget', v ?? 0)} error={touched ? errs.find(x => x.includes('margen')) : undefined} hint="Debe ser menor que 100 %" />
            <div className="table-wrap"><table className="tbl"><tbody>
              <tr><td>Costo estimado</td><td className="num">{money(calc.cost, 2)}</td></tr>
              <tr><td>Precio neto sugerido<div className="muted small">costo ÷ (1 − margen objetivo)</div></td><td className="num">{calc.suggestedNet == null ? NA : money(calc.suggestedNet, 2)}</td></tr></tbody></table></div>
            <NumField label="Precio neto ofrecido (opcional)" prefix="$" disabled={dis} value={q.priceNet} onChange={v => set('priceNet', v)} hint={q.priceNet == null ? 'Vacío = se ofrece el precio sugerido' : <button className="btn sm ghost" disabled={dis} onClick={() => set('priceNet', null)}>Volver al sugerido</button>} />
            <div className="table-wrap"><table className="tbl"><tbody>
              <tr><td><b>Precio neto</b></td><td className="num"><b>{calc.priceNet == null ? NA : money(calc.priceNet, 2)}</b></td></tr>
              <tr><td>IVA ({(q.ivaRate * 100).toFixed(1).replace('.0', '')} %)<div className="muted small">Impuestos por separado</div></td><td className="num">{calc.iva == null ? NA : money(calc.iva, 2)}</td></tr>
              <tr><td><b>Total con impuestos</b></td><td className="num"><b>{calc.total == null ? NA : money(calc.total, 2)}</b></td></tr>
              <tr><td>Resultado esperado</td><td className={`num ${calc.result != null && calc.result < 0 ? 'neg' : ''}`}>{calc.result == null ? NA : money(calc.result, 2)}</td></tr>
              <tr><td>Margen esperado</td><td className={`num ${belowTarget ? 'warn' : ''}`}>{fmtPct(margin)}</td></tr></tbody></table></div>
            <Field label="IVA (%)"><input disabled={dis} type="number" value={q.ivaRate * 100} step={0.5} onChange={ev => set('ivaRate', Number(ev.target.value) / 100)} /></Field>
            {calc.cost === 0 && <div className="banner amber"><div>El costo estimado es $0, por eso el precio sugerido también. Completá los costos incluidos (o usá “Sugerir desde parámetros e historial”).</div></div>}
            {belowTarget && !calc.error && <div className="banner amber"><div>El precio ofrecido deja un margen de {fmtPct(margin)}, por debajo del objetivo de {fmtPct(q.marginTarget)}.</div></div>}
            {margin != null && margin < 0 && <div className="banner red"><div>El precio no cubre el costo estimado.</div></div>}
            {touched && errs.length > 0 && <div className="banner red"><div>{errs.map(x => <div key={x}>{x}</div>)}</div></div>}</div></section>
          {q.shares.length > 0 && <section className="panel"><div className="panel-h"><h2>Envíos registrados</h2></div><div className="table-wrap"><table className="tbl"><tbody>{q.shares.map(s => <tr key={s.id}><td className="nowrap small">{fmtDateTime(s.at, tz)}</td><td>{s.channel}</td><td className="small muted">{s.by}{s.note ? ` · ${s.note}` : ''}</td></tr>)}</tbody></table></div></section>}
        </div>
      </div>
      {!isNew && <HistoryPanel refId={q.id} />}
      {pdf && <PdfModal title={`Propuesta ${q.number}`} src={`/api/quotes/${q.id}/pdf`} onClose={() => setPdf(false)} />}
      {dialog === 'share' && <ShareDialog onClose={() => setDialog(null)} onSave={(channel, note, at) => act('share', { channel, note, at }, 'Envío registrado')} />}
      {dialog === 'accept' && <NoteDialog title="Registrar aceptación" label="¿Cómo y quién confirmó la aceptación?" hint="La aceptación se registra manualmente." ok="Registrar aceptación" onClose={() => setDialog(null)} onSave={note => act('accept', { note }, 'Aceptación registrada')} />}
      {dialog === 'reject' && <NoteDialog title="Registrar rechazo" label="Motivo del rechazo" required ok="Registrar rechazo" onClose={() => setDialog(null)} onSave={reason => act('reject', { reason }, 'Rechazo registrado')} />}
      {dialog === 'convert' && <ConvertDialog quote={q} onClose={() => setDialog(null)} onDone={tid => navigate(`viajes/${tid}`)} />}
    </>
  );
}

function ShareDialog({ onClose, onSave }: { onClose: () => void; onSave: (channel: string, note: string, at: string) => void }) {
  const { today } = useApp(); const [ch, setCh] = useState('Correo'); const [other, setOther] = useState(''); const [note, setNote] = useState(''); const [day, setDay] = useState(today); const [time, setTime] = useState('10:00');
  const channel = ch === 'Otro' ? other : ch;
  return <Modal title="Registrar que se compartió" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!channel.trim()} onClick={() => onSave(channel, note, new Date(`${day}T${time}:00`).toISOString())}>Registrar</button></>}>
    <div className="grid g2"><Field label="Canal"><select value={ch} onChange={e => setCh(e.target.value)}>{['Correo', 'WhatsApp', 'En persona', 'Portal del cliente', 'Otro'].map(c => <option key={c}>{c}</option>)}</select></Field>{ch === 'Otro' && <Field label="¿Cuál?"><input type="text" value={other} onChange={e => setOther(e.target.value)} /></Field>}
      <Field label="Fecha"><input type="date" value={day} onChange={e => setDay(e.target.value)} /></Field><Field label="Hora"><input type="time" value={time} onChange={e => setTime(e.target.value)} /></Field></div>
    <Field label="Nota (a quién, qué se envió)"><input type="text" value={note} onChange={e => setNote(e.target.value)} /></Field>
    <p className="muted small">Esto deja constancia de que lo compartiste vos; RUMBO no envía la propuesta.</p></Modal>;
}
function NoteDialog({ title, label, hint, required, ok, onClose, onSave }: { title: string; label: string; hint?: string; required?: boolean; ok: string; onClose: () => void; onSave: (t: string) => void }) {
  const [t, setT] = useState(''); return <Modal title={title} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!!required && !t.trim()} onClick={() => onSave(t)}>{ok}</button></>}><Field label={label} hint={hint}><textarea value={t} onChange={e => setT(e.target.value)} /></Field></Modal>;
}
function ConvertDialog({ quote, onClose, onDone }: { quote: Quote; onClose: () => void; onDone: (tripId: string) => void }) {
  const { data, run, tz } = useApp(); const [truckId, setTruck] = useState(quote.truckId ?? ''); const [driverId, setDriver] = useState(''); const [dep, setDep] = useState(''); const [arr, setArr] = useState(''); const [ins, setIns] = useState(''); const [busy, setBusy] = useState(false);
  const iso = (v: string) => v ? localInputToIso(v, tz) : null;
  const go = async () => { setBusy(true); const r = await run(() => api<{ tripId: string }>('POST', `/api/quotes/${quote.id}/convert`, { truckId, driverId, plannedDeparture: iso(dep), plannedArrival: iso(arr), instructions: ins }), 'Viaje creado con el presupuesto de la cotización'); setBusy(false); if (r) onDone(r.tripId); };
  return <Modal title="Convertir en viaje" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!truckId || !driverId || !dep || busy} onClick={go}>Crear viaje</button></>}>
    <p className="muted" style={{ marginTop: 0 }}>Se crean el viaje y una copia inmodificable del presupuesto aceptado. Solo falta asignar vehículo y chofer.</p>
    <div className="grid g2"><Field label="Vehículo"><select value={truckId} onChange={e => setTruck(e.target.value)}><option value="">Elegí…</option>{data.trucks.map(t => <option key={t.id} value={t.id}>{t.name} · {t.plate}</option>)}</select></Field>
      <Field label="Chofer"><select value={driverId} onChange={e => setDriver(e.target.value)}><option value="">Elegí…</option>{data.drivers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
      <Field label="Salida prevista (obligatoria)"><input type="datetime-local" value={dep} onChange={e => setDep(e.target.value)} /></Field><Field label="Llegada prevista"><input type="datetime-local" value={arr} onChange={e => setArr(e.target.value)} /></Field></div>
    <Field label="Instrucciones para el chofer"><textarea value={ins} onChange={e => setIns(e.target.value)} /></Field></Modal>;
}
void FileDown; void saveBlob; void fmtMoney;
