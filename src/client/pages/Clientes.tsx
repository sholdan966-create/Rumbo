import { useMemo, useState } from 'react';
import { ArrowLeft, Copy, FileText, Mail, Pencil, Plus, Trash2 } from 'lucide-react';
import { useApp } from '../store';
import { api } from '../api';
import { Route, href, navigate } from '../router';
import { Field, InvChip, Kpi, Modal, NumField, PdfModal, Tabs, TripChip } from '../components/ui';
import { FilesPanel, HistoryPanel } from '../components/Attach';
import { QuoteChip } from './Cotizaciones';
import { clientAccount } from '../../shared/account';
import { invoiceTotals, routeKey } from '../../shared/calc';
import { quoteCalc, quoteStatus } from '../../shared/quote';
import { addDays } from '../../shared/time';
import { fmtDate, fmtDateTime, fmtPct } from '../../shared/format';
import { Client, Contact } from '../../shared/types';

type Tab = 'resumen' | 'cotizaciones' | 'viajes' | 'facturas' | 'documentos' | 'gestiones' | 'historial';

export function Clientes({ route }: { route: Route }) {
  const id = route.path[1]; return id ? <Ficha id={id} tab={(route.query.get('tab') as Tab) ?? 'resumen'} /> : <Lista />;
}

function Lista() {
  const { data, today, money, canEdit, run } = useApp(); const [q, setQ] = useState(''); const [adding, setAdding] = useState(false);
  const rows = useMemo(() => data.clients.filter(c => !q || `${c.name} ${c.cuit}`.toLowerCase().includes(q.toLowerCase())).map(c => ({ c, a: clientAccount(data, c.id, today, `${today.slice(0, 7)}-01`, today), promises: data.collections.filter(g => g.clientId === c.id && g.promise?.status === 'pendiente').length })).sort((a, b) => b.a.overdue - a.a.overdue || b.a.pending - a.a.pending), [data, today, q]);
  return (
    <>
      <div className="page-head"><div><h1>Clientes</h1><p>Ficha con cuenta corriente, cotizaciones, viajes, facturas y gestiones de cobro. Los saldos salen de las facturas y pagos de Cobros.</p></div>
        <div className="page-actions"><button className="btn primary" disabled={!canEdit} onClick={() => setAdding(true)}><Plus size={16} /> Nuevo cliente</button></div></div>
      <div className="filters"><Field label="Buscar" className="grow"><input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Nombre o CUIT" /></Field></div>
      <section className="panel"><div className="table-wrap"><table className="tbl"><thead><tr><th>Cliente</th><th className="hide-sm">CUIT</th><th className="num">Saldo pendiente</th><th className="num">Vencido</th><th className="hide-sm">Compromisos</th><th className="hide-md">Plazo</th></tr></thead><tbody>
        {rows.map(({ c, a, promises }) => <tr key={c.id} className="click" onClick={() => navigate(`clientes/${c.id}`)}><td><a href={href(`clientes/${c.id}`)}>{c.name}</a></td><td className="hide-sm">{c.cuit || '—'}</td><td className="num">{money(a.pending)}</td><td className={`num ${a.overdue > 0 ? 'neg' : ''}`}>{money(a.overdue)}</td><td className="hide-sm">{promises ? <span className="chip amber">{promises} pendiente(s)</span> : '—'}</td><td className="hide-md">{c.paymentTermDays} días</td></tr>)}</tbody></table></div></section>
      {adding && <ClientModal client={null} onClose={() => setAdding(false)} run={run} onSaved={id => navigate(`clientes/${id}`)} />}
    </>
  );
}

function ClientModal({ client, onClose, run, onSaved }: { client: Client | null; onClose: () => void; run: ReturnType<typeof useApp>['run']; onSaved?: (id: string) => void }) {
  const [c, setC] = useState<Client>(client ?? { id: `C${Date.now().toString(36)}`, name: '', cuit: '', paymentTermDays: 30, contacts: [], notes: '' });
  const setK = (i: number, p: Partial<Contact>) => setC(x => ({ ...x, contacts: (x.contacts ?? []).map((k, j) => j === i ? { ...k, ...p } : k) }));
  const save = async () => { if (await run(() => api('PUT', `/api/clients/${c.id}`, c), 'Cliente guardado')) { onSaved?.(c.id); onClose(); } };
  return (
    <Modal title={client ? 'Editar cliente' : 'Nuevo cliente'} size="wide" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!c.name.trim()} onClick={save}>Guardar</button></>}>
      <div className="grid g3"><Field label="Razón social o nombre"><input type="text" value={c.name} onChange={e => setC({ ...c, name: e.target.value })} /></Field><Field label="Identificación fiscal (CUIT)"><input type="text" value={c.cuit} onChange={e => setC({ ...c, cuit: e.target.value })} /></Field>
        <NumField label="Plazo de pago (días)" value={c.paymentTermDays} onChange={v => setC({ ...c, paymentTermDays: v ?? 0 })} /></div>
      <div className="form-section">Contactos</div>
      {(c.contacts ?? []).map((k, i) => <div key={k.id} className="grid g4" style={{ marginBottom: 8, alignItems: 'end' }}><Field label="Nombre"><input type="text" value={k.name} onChange={e => setK(i, { name: e.target.value })} /></Field><Field label="Rol"><input type="text" value={k.role} onChange={e => setK(i, { role: e.target.value })} /></Field>
        <Field label="Correo"><input type="email" value={k.email} onChange={e => setK(i, { email: e.target.value })} /></Field><div className="row" style={{ flexWrap: 'nowrap' }}><Field label="Teléfono" className="grow"><input type="text" value={k.phone} onChange={e => setK(i, { phone: e.target.value })} /></Field><button className="btn icon ghost danger" aria-label="Quitar contacto" onClick={() => setC({ ...c, contacts: (c.contacts ?? []).filter((_, j) => j !== i) })}><Trash2 size={16} /></button></div></div>)}
      <button className="btn sm" onClick={() => setC({ ...c, contacts: [...(c.contacts ?? []), { id: crypto.randomUUID(), name: '', role: '', email: '', phone: '' }] })}><Plus size={14} /> Agregar contacto</button>
      <Field label="Notas" className=""><textarea value={c.notes ?? ''} onChange={e => setC({ ...c, notes: e.target.value })} /></Field>
    </Modal>
  );
}

function Ficha({ id, tab }: { id: string; tab: Tab }) {
  const { data, calcs, today, money, canEdit, run, tz } = useApp(); const c = data.clients.find(x => x.id === id);
  const [asof, setAsof] = useState(today); const [from, setFrom] = useState(`${today.slice(0, 7)}-01`); const [to, setTo] = useState(today);
  const [edit, setEdit] = useState(false); const [pdf, setPdf] = useState(false); const [gestion, setGestion] = useState(false); const [reminder, setReminder] = useState(false);
  if (!c) return <div className="empty">Cliente inexistente. <a href={href('clientes')}>Volver</a></div>;
  const acc = clientAccount(data, id, asof, from, to); const invs = data.invoices.filter(i => i.clientId === id).sort((a, b) => b.issueDate.localeCompare(a.issueDate));
  const trips = data.trips.filter(t => t.clientId === id).sort((a, b) => b.id.localeCompare(a.id)); const quotes = data.quotes.filter(x => x.clientId === id);
  const actions = data.collections.filter(g => g.clientId === id).sort((a, b) => b.at.localeCompare(a.at)); const msgs = data.messages.filter(m => m.clientId === id);
  const maxAging = Math.max(1, ...acc.aging.map(a => a.amount));
  return (
    <>
      <a className="back" href={href('clientes')}><ArrowLeft size={16} /> Clientes</a>
      <div className="page-head"><div><h1>{c.name}</h1><p>CUIT {c.cuit || '—'} · plazo de pago {c.paymentTermDays} días · {(c.contacts ?? []).map(k => `${k.name}${k.email ? ` (${k.email})` : ''}`).join(' · ') || 'sin contactos'}</p></div>
        <div className="page-actions"><button className="btn" onClick={() => setPdf(true)}><FileText size={16} /> Estado de cuenta PDF</button><button className="btn" disabled={!canEdit} onClick={() => setReminder(true)}><Mail size={16} /> Recordatorio de pago</button><button className="btn" disabled={!canEdit} onClick={() => setEdit(true)}><Pencil size={16} /> Editar</button></div></div>
      <Tabs<Tab> value={tab} onChange={t => navigate(`clientes/${id}`, { tab: t })} tabs={[{ id: 'resumen', label: 'Cuenta' }, { id: 'cotizaciones', label: `Cotizaciones (${quotes.length})` }, { id: 'viajes', label: `Viajes (${trips.length})` }, { id: 'facturas', label: `Facturas y pagos (${invs.length})` }, { id: 'gestiones', label: `Gestiones de cobro (${actions.length})` }, { id: 'documentos', label: 'Documentos' }, { id: 'historial', label: 'Historial' }]} />

      {tab === 'resumen' && <div className="stack">
        <div className="filters" style={{ marginBottom: 0 }}><Field label="Saldo a la fecha"><input type="date" value={asof} max={today} onChange={e => setAsof(e.target.value || today)} /></Field><Field label="Facturación desde"><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field><Field label="Hasta"><input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field></div>
        <div className="kpis" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}><Kpi label="Facturación del período" value={money(acc.billed)} sub={`${fmtDate(from)} a ${fmtDate(to)} · por fecha de factura`} /><Kpi label={`Saldo pendiente al ${fmtDate(asof)}`} value={money(acc.pending)} /><Kpi label="Saldo vencido" value={money(acc.overdue)} tone={acc.overdue > 0 ? 'bad' : undefined} sub="Vencimiento anterior a la fecha" /><Kpi label="Próximos vencimientos (30 días)" value={money(acc.upcoming.reduce((a, x) => a + x.balance, 0))} sub={`${acc.upcoming.length} factura(s)`} /></div>
        <div className="cols even">
          <section className="panel"><div className="panel-h"><h2>Antigüedad de la deuda</h2><span className="muted small">Tramos configurables en Configuración</span></div><div className="hbars">
            {acc.aging.map((a, i) => <div className="hbar" key={a.label} style={{ cursor: 'default' }}><span className="lbl">{a.label}</span><span className="track"><span className={`fill ${i >= 2 ? 'below' : ''}`} style={{ width: `${(a.amount / maxAging) * 100}%` }} /></span><span className="val">{money(a.amount)}</span></div>)}</div></section>
          <section className="panel"><div className="panel-h"><h2>Próximos vencimientos</h2></div><div className="table-wrap"><table className="tbl"><tbody>{acc.upcoming.map(u => <tr key={u.number}><td>{u.number}</td><td>{fmtDate(u.dueDate)}</td><td className="num">{money(u.balance)}</td></tr>)}{!acc.upcoming.length && <tr><td className="muted">Sin vencimientos en los próximos 30 días.</td></tr>}</tbody></table></div>
            {actions.some(g => g.promise?.status === 'pendiente') && <div className="panel-b" style={{ borderTop: '1px solid var(--line)' }}><b>Compromisos de pago pendientes</b>{actions.filter(g => g.promise?.status === 'pendiente').map(g => <div key={g.id} className="small">{fmtDate(g.promise!.date)}{g.promise!.amount ? ` · ${money(g.promise!.amount)}` : ''}{g.promise!.date < today && <span className="chip red" style={{ marginLeft: 6 }}>Fecha cumplida sin registrar pago</span>}</div>)}</div>}</section></div></div>}

      {tab === 'cotizaciones' && <section className="panel"><div className="table-wrap"><table className="tbl"><thead><tr><th>Número</th><th>Ruta</th><th className="num">Precio neto</th><th className="num hide-sm">Margen</th><th>Estado</th></tr></thead><tbody>
        {quotes.map(x => <tr key={x.id} className="click" onClick={() => navigate(`cotizaciones/${x.id}`)}><td><a href={href(`cotizaciones/${x.id}`)}>{x.number}</a></td><td>{x.origin} – {x.destination}</td><td className="num">{money(quoteCalc(x).priceNet)}</td><td className="num hide-sm">{fmtPct(quoteCalc(x).marginPct)}</td><td><QuoteChip s={quoteStatus(x, today)} /></td></tr>)}{!quotes.length && <tr><td colSpan={5} className="empty">Sin cotizaciones.</td></tr>}</tbody></table></div></section>}
      {tab === 'viajes' && <section className="panel"><div className="table-wrap"><table className="tbl"><thead><tr><th>Viaje</th><th>Ruta</th><th>Estado</th><th className="num">Ingreso</th><th className="num hide-sm">Margen</th></tr></thead><tbody>
        {trips.map(t => { const k = calcs.get(t.id)!; return <tr key={t.id} className="click" onClick={() => navigate(`viajes/${t.id}`)}><td><a href={href(`viajes/${t.id}`)}>{t.id}</a></td><td>{routeKey(t)}</td><td><TripChip s={t.status} /></td><td className="num">{money(k.revenue)}</td><td className="num hide-sm">{t.status === 'finalizado' ? fmtPct(k.marginPct) : '—'}</td></tr>; })}{!trips.length && <tr><td colSpan={5} className="empty">Sin viajes.</td></tr>}</tbody></table></div></section>}
      {tab === 'facturas' && <div className="stack"><section className="panel"><div className="panel-h"><h2>Facturas</h2><a href={href('cobros', { client: id })}>Abrir en Cobros para registrar cobros</a></div><div className="table-wrap"><table className="tbl"><thead><tr><th>Factura</th><th className="hide-sm">Emisión</th><th>Vence</th><th className="num">Total</th><th className="num">Saldo</th><th>Estado</th></tr></thead><tbody>
        {invs.map(i => { const t = invoiceTotals(i, data.payments, today, data.settings.dueSoonDays); return <tr key={i.id}><td className="id">{i.number}</td><td className="hide-sm">{fmtDate(i.issueDate)}</td><td>{fmtDate(i.dueDate)}</td><td className="num">{money(t.adjusted)}</td><td className="num">{money(t.balance)}</td><td><InvChip t={t} /></td></tr>; })}{!invs.length && <tr><td colSpan={6} className="empty">Sin facturas.</td></tr>}</tbody></table></div></section>
        <section className="panel"><div className="panel-h"><h2>Pagos</h2></div><div className="table-wrap"><table className="tbl"><tbody>{data.payments.filter(p => invs.some(i => i.id === p.invoiceId)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30).map(p => <tr key={p.id}><td>{fmtDate(p.date)}</td><td>{invs.find(i => i.id === p.invoiceId)!.number}</td><td>{p.method}</td><td className="num">{money(p.amount, 2)}</td></tr>)}</tbody></table></div></section></div>}
      {tab === 'gestiones' && <div className="stack">
        <div className="row"><button className="btn primary" disabled={!canEdit} onClick={() => setGestion(true)}><Plus size={16} /> Registrar gestión</button></div>
        <section className="panel"><div className="table-wrap"><table className="tbl"><thead><tr><th>Fecha</th><th>Responsable</th><th>Canal</th><th>Observación</th><th>Compromiso / próxima acción</th></tr></thead><tbody>
          {actions.map(g => <tr key={g.id}><td className="nowrap small">{fmtDateTime(g.at, tz)}</td><td className="small">{g.by}</td><td>{g.channel}</td><td className="wrap">{g.note}</td>
            <td className="wrap small">{g.promise && <div>Pago prometido {fmtDate(g.promise.date)}{g.promise.amount ? ` · ${money(g.promise.amount)}` : ''} <span className={`chip ${g.promise.status === 'cumplido' ? 'accent' : g.promise.status === 'incumplido' ? 'red' : 'amber'}`}>{g.promise.status}</span>
              {canEdit && g.promise.status === 'pendiente' && <span style={{ marginLeft: 6 }}><button className="btn sm" onClick={() => run(() => api('PUT', `/api/collections/${g.id}/promise`, { status: 'cumplido' }), 'Compromiso marcado como cumplido')}>Cumplido</button> <button className="btn sm" onClick={() => run(() => api('PUT', `/api/collections/${g.id}/promise`, { status: 'incumplido' }), 'Compromiso marcado como incumplido')}>Incumplido</button></span>}</div>}{g.nextAction && <div>Próxima acción ({fmtDate(g.nextAction.date)}): {g.nextAction.text}</div>}</td></tr>)}{!actions.length && <tr><td colSpan={5} className="empty">Sin gestiones registradas.</td></tr>}</tbody></table></div></section>
        <section className="panel"><div className="panel-h"><h2>Mensajes registrados</h2></div><div className="table-wrap"><table className="tbl"><thead><tr><th>Fecha</th><th>Tipo</th><th>Canal</th><th>Resultado</th></tr></thead><tbody>{msgs.map(m => <tr key={m.id}><td className="nowrap small">{fmtDateTime(m.at, tz)}</td><td>{m.kind === 'recordatorio' ? 'Recordatorio' : 'Estado de cuenta'}</td><td>{m.channel}</td><td className="wrap small"><span className={`chip ${m.result === 'enviado' ? 'accent' : m.result === 'error' ? 'red' : 'gray'}`}>{m.result === 'sin_configurar' ? 'No enviado: sin configurar' : m.result === 'manual' ? 'Enviado manualmente (registrado)' : m.result}</span> {m.detail}</td></tr>)}{!msgs.length && <tr><td colSpan={4} className="empty">Sin mensajes registrados.</td></tr>}</tbody></table></div></section></div>}
      {tab === 'documentos' && <FilesPanel entityType="cliente" entityId={id} title="Documentos del cliente" />}
      {tab === 'historial' && <HistoryPanel refId={id} />}
      {edit && <ClientModal client={c} onClose={() => setEdit(false)} run={run} />}{pdf && <PdfModal title={`Estado de cuenta · ${c.name}`} src={`/api/clients/${id}/statement.pdf?asof=${asof}`} onClose={() => setPdf(false)} />}
      {gestion && <GestionModal clientId={id} onClose={() => setGestion(false)} />}{reminder && <ReminderModal client={c} asof={asof} onClose={() => setReminder(false)} />}
    </>
  );
}

function GestionModal({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const { run, today } = useApp(); const [channel, setChannel] = useState('Teléfono'); const [note, setNote] = useState(''); const [pd, setPd] = useState(''); const [pa, setPa] = useState<number | null>(null); const [nd, setNd] = useState(addDays(today, 3)); const [nt, setNt] = useState('');
  const save = async () => { if (await run(() => api('POST', `/api/clients/${clientId}/collections`, { channel, note, promise: pd ? { date: pd, amount: pa } : null, nextAction: nt ? { date: nd, text: nt } : null }), 'Gestión registrada')) onClose(); };
  return <Modal title="Registrar gestión de cobro" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!note.trim()} onClick={save}>Guardar</button></>}>
    <div className="stack"><div className="grid g2"><Field label="Canal de contacto"><select value={channel} onChange={e => setChannel(e.target.value)}>{['Teléfono', 'Correo', 'WhatsApp', 'En persona', 'Otro'].map(c => <option key={c}>{c}</option>)}</select></Field></div>
      <Field label="Observación"><textarea value={note} onChange={e => setNote(e.target.value)} /></Field>
      <div className="grid g2"><Field label="Compromiso de pago: fecha"><input type="date" value={pd} onChange={e => setPd(e.target.value)} /></Field><NumField label="Compromiso: importe (opcional)" prefix="$" value={pa} onChange={setPa} /></div>
      <div className="grid g2"><Field label="Próxima acción: fecha"><input type="date" value={nd} onChange={e => setNd(e.target.value)} /></Field><Field label="Próxima acción"><input type="text" value={nt} onChange={e => setNt(e.target.value)} placeholder="Ej.: llamar para confirmar el pago" /></Field></div></div></Modal>;
}

function ReminderModal({ client, asof, onClose }: { client: Client; asof: string; onClose: () => void }) {
  const { run, toast } = useApp(); const [d, setD] = useState<{ to: string[]; subject: string; body: string } | null>(null); const [to, setTo] = useState(''); const [channel, setChannel] = useState<'correo' | 'whatsapp' | 'otro'>('correo'); const [res, setRes] = useState('');
  useMemo(() => { api<{ to: string[]; subject: string; body: string }>('GET', `/api/clients/${client.id}/reminder-draft?asof=${asof}`).then(r => { setD(r); setTo(r.to.join(', ')); }); }, [client.id, asof]);
  if (!d) return <Modal title="Recordatorio de pago" onClose={onClose}><p className="muted">Preparando borrador…</p></Modal>;
  const record = async (send: boolean) => { const r = await run(() => api<{ message: { result: string; detail: string } }>('POST', `/api/clients/${client.id}/messages`, { kind: 'recordatorio', channel, to, subject: d.subject, body: d.body, send, registerOnly: !send })); if (r) { setRes(`${r.message.result === 'enviado' ? 'Enviado' : r.message.result === 'sin_configurar' ? 'NO enviado' : 'Registrado'}: ${r.message.detail}`); } };
  return <Modal title={`Recordatorio de pago · ${client.name}`} size="wide" onClose={onClose} footer={<><button className="btn" onClick={() => { navigator.clipboard?.writeText(`${d.subject}\n\n${d.body}`).then(() => toast('Texto copiado'), () => toast('No se pudo copiar', 'err')); }}><Copy size={15} /> Copiar texto</button>
    <button className="btn" onClick={() => record(false)}>Registrar como enviado por mi cuenta</button><button className="btn primary" disabled={channel !== 'correo'} onClick={() => record(true)}>Enviar por correo desde RUMBO</button></>}>
    <div className="banner blue" style={{ marginBottom: 12 }}><div>Es un <b>borrador</b>: no se envía nada hasta que elijas una acción. El resultado de cada acción queda registrado tal como ocurrió.</div></div>
    <div className="grid g2"><Field label="Canal"><select value={channel} onChange={e => setChannel(e.target.value as 'correo')}><option value="correo">Correo</option><option value="whatsapp">WhatsApp (lo enviás vos)</option><option value="otro">Otro (lo enviás vos)</option></select></Field><Field label="Destinatarios"><input type="text" value={to} onChange={e => setTo(e.target.value)} /></Field></div>
    <Field label="Asunto"><input type="text" value={d.subject} onChange={e => setD({ ...d, subject: e.target.value })} /></Field><Field label="Mensaje"><textarea style={{ minHeight: 220 }} value={d.body} onChange={e => setD({ ...d, body: e.target.value })} /></Field>
    {res && <div className={`banner ${res.startsWith('NO') ? 'amber' : 'blue'}`} style={{ marginTop: 12 }}><div>{res}</div></div>}</Modal>;
}
