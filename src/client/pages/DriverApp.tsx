// Portal del chofer: interfaz móvil. Toda la autorización la hace el servidor (cada chofer solo recibe sus viajes).
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Camera, CheckCircle2, ClipboardList, Flag, LogOut, MapPin, Play, Receipt, RefreshCw, Square, Timer, WifiOff } from 'lucide-react';
import { api, ApiError, setToken, toBase64 } from '../api';
import { SessionUser } from '../store';
import { Field, Modal, NumField } from '../components/ui';
import { InstallButton } from '../components/InstallButton';
import { ByRumbo, TgLogo } from '../components/Brand';
import { useBlobUrl } from '../hooks';
import { fmtDate, fmtDateTime, fmtMoney } from '../../shared/format';
import { EXPENSE_LABEL, ExpenseCategory } from '../../shared/types';
import { localDate, localInputToIso } from '../../shared/time';

interface DTrip {
  id: string; status: string; origin: string; destination: string; client: string; truck: string; plate: string; plannedDeparture: string | null; plannedArrival: string | null; actualDeparture: string | null; actualArrival: string | null;
  kmLoaded: number | null; odometerStart: number | null; odometerEnd: number | null; instructions: string; notes: string; stops: { id: string; start: string; end: string; reason?: string }[];
  incidents: { id: string; at: string; by: string; text: string }[]; timeCorrections: { id: string; field: string; oldValue: string | null; newValue: string; reason: string; by: string; at: string }[]; driverDone: { at: string; by: string } | null; reviewedAt: string | null;
  expenses: { id: string; category: ExpenseCategory; amount: number; date?: string; note?: string; status: string; rejectionReason?: string }[];
  files: { id: string; name: string; mime: string; size: number; uploadedAt: string; uploadedBy: string; description: string; expenseId: string | null }[]; serviceValue?: number | null; expenseTotal?: number;
}
type Save = { kind: 'idle' } | { kind: 'saving' } | { kind: 'ok'; at: string; msg: string } | { kind: 'err'; msg: string };
const STATUS: Record<string, string> = { planificado: 'Planificado', en_curso: 'En curso', finalizado: 'Terminado', cancelado: 'Cancelado' };
const EXP_STATUS: Record<string, { l: string; c: string }> = { pendiente_revision: { l: 'Pendiente de revisión', c: 'amber' }, aprobado: { l: 'Aprobado', c: 'accent' }, rechazado: { l: 'Rechazado', c: 'red' } };
const CATS: ExpenseCategory[] = ['fuel', 'tolls', 'perDiem', 'other'];

export function DriverApp({ user }: { user: SessionUser }) {
  const [trips, setTrips] = useState<DTrip[] | null>(null); const [tz, setTz] = useState('America/Argentina/Buenos_Aires'); const [sel, setSel] = useState<string | null>(null); const [tab, setTab] = useState<'viaje' | 'gastos' | 'fotos' | 'novedades'>('viaje');
  const [loadErr, setLoadErr] = useState(''); const [save, setSave] = useState<Save>({ kind: 'idle' });
  const load = useCallback(async () => { try { const r = await api<{ trips: DTrip[]; tz: string }>('GET', '/api/driver/trips'); setTrips(r.trips); setTz(r.tz); setLoadErr(''); } catch (e) { setLoadErr(e instanceof ApiError ? e.errors.join(' ') : 'Sin conexión'); } }, []);
  useEffect(() => { load(); }, [load]);
  const trip = trips?.find(t => t.id === sel) ?? null;
  /** Ejecuta una operación y muestra con claridad si se guardó en el servidor o no. El formulario no se limpia si falla. */
  const act = async <T,>(fn: () => Promise<T & { trip?: DTrip }>, msg: string): Promise<boolean> => {
    setSave({ kind: 'saving' });
    try { const r = await fn(); if (r.trip) setTrips(ts => ts?.map(t => t.id === r.trip!.id ? r.trip! : t) ?? ts); else await load(); setSave({ kind: 'ok', at: new Date().toISOString(), msg }); return true; }
    catch (e) { setSave({ kind: 'err', msg: e instanceof ApiError ? e.errors.join(' ') : 'No se pudo guardar.' }); return false; }
  };
  const logout = async () => { try { await api('POST', '/api/auth/logout'); } catch { /* ignorar */ } setToken(null); window.location.reload(); };
  const cur = trips?.filter(t => t.status !== 'finalizado') ?? []; const done = trips?.filter(t => t.status === 'finalizado') ?? [];

  return (
    <div className="mobile-app">
      <div className="m-top"><div className="row" style={{ flexWrap: 'nowrap' }}>{trip && <button className="btn icon" style={{ background: 'transparent', color: '#fff', borderColor: '#2B4357' }} aria-label="Volver" onClick={() => { setSel(null); setSave({ kind: 'idle' }); }}><ArrowLeft size={20} /></button>}<div><TgLogo onDark size={30} /><div style={{ fontSize: 14, color: '#C5D3DD', marginTop: 4 }}>Chofer · {user.name}</div></div></div>
        <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}><InstallButton style={{ background: 'transparent', color: '#fff', borderColor: '#2B4357' }} className="btn sm" /><button className="btn sm" style={{ background: 'transparent', color: '#fff', borderColor: '#2B4357' }} onClick={logout}><LogOut size={15} /> Salir</button></div></div>
      <div className="m-body">
        <div className="banner blue" style={{ fontSize: 14 }}><WifiOff size={18} /><div>Necesita conexión a internet. Sin señal, los datos <b>no se guardan</b>: el formulario queda como lo dejaste para que reintentes. No hay modo sin conexión.</div></div>
        {loadErr && <div className="banner red"><AlertTriangle size={18} /><div>{loadErr} <button className="btn sm" onClick={load}><RefreshCw size={14} /> Reintentar</button></div></div>}
        <SaveBar s={save} tz={tz} />
        {!trips && !loadErr && <p className="muted">Cargando tus viajes…</p>}
        {trips && !trip && <>
          <h2>Mis viajes</h2>
          {cur.map(t => <TripCard key={t.id} t={t} tz={tz} onOpen={() => { setSel(t.id); setTab('viaje'); }} />)}{!cur.length && <p className="muted">No tenés viajes pendientes.</p>}
          {done.length > 0 && <><h2 style={{ marginTop: 8 }}>Terminados (últimos 7 días)</h2>{done.map(t => <TripCard key={t.id} t={t} tz={tz} onOpen={() => { setSel(t.id); setTab('viaje'); }} />)}</>}</>}
        {trip && <>
          {tab === 'viaje' && <Resumen t={trip} tz={tz} act={act} />}{tab === 'gastos' && <Gastos t={trip} tz={tz} act={act} setSave={setSave} />}
          {tab === 'fotos' && <Fotos t={trip} act={act} />}{tab === 'novedades' && <Novedades t={trip} tz={tz} act={act} />}</>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0 16px' }}><ByRumbo /></div>
      {trip && <nav className="m-tabs" aria-label="Secciones del viaje">
        {([['viaje', 'Viaje', MapPin], ['gastos', 'Gastos', Receipt], ['fotos', 'Fotos', Camera], ['novedades', 'Novedades', ClipboardList]] as const).map(([id, l, I]) => <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}><I size={22} />{l}</button>)}</nav>}
    </div>
  );
}

function SaveBar({ s, tz }: { s: Save; tz: string }) {
  if (s.kind === 'idle') return null;
  if (s.kind === 'saving') return <div className="banner blue save-state"><RefreshCw size={16} className="spin" /> Guardando… todavía no está guardado.</div>;
  if (s.kind === 'ok') return <div className="banner" style={{ background: 'var(--accent-soft)', borderColor: '#9FD6CD', color: '#065E52' }} role="status"><CheckCircle2 size={18} /><div><b>Guardado en el servidor</b> a las {fmtDateTime(s.at, tz).slice(-5)}. {s.msg}</div></div>;
  return <div className="banner red" role="alert"><AlertTriangle size={18} /><div><b>No se guardó.</b> {s.msg} <div>Tus datos siguen en el formulario: corregí o reintentá.</div></div></div>;
}

function TripCard({ t, tz, onOpen }: { t: DTrip; tz: string; onOpen: () => void }) {
  const pend = t.expenses.filter(e => e.status === 'pendiente_revision').length, rej = t.expenses.filter(e => e.status === 'rechazado').length;
  return <button className="panel" style={{ textAlign: 'left', padding: 14, cursor: 'pointer', width: '100%' }} onClick={onOpen}>
    <div className="row between" style={{ flexWrap: 'nowrap' }}><b style={{ fontSize: 17 }}>{t.origin} – {t.destination}</b><span className={`chip ${t.status === 'en_curso' ? 'blue' : t.status === 'finalizado' ? 'accent' : 'gray'}`}>{STATUS[t.status]}</span></div>
    <div className="muted">{t.client} · {t.truck} ({t.plate})</div><div className="small">Salida prevista: {fmtDateTime(t.plannedDeparture, 'America/Argentina/Buenos_Aires')}</div>
    <div className="row" style={{ marginTop: 6 }}>{pend > 0 && <span className="chip amber">{pend} gasto(s) por revisar</span>}{rej > 0 && <span className="chip red">{rej} rechazado(s)</span>}{t.driverDone && <span className="chip accent">Enviado a revisión</span>}</div></button>;
  void tz;
}

type Act = <T>(fn: () => Promise<T & { trip?: DTrip }>, msg: string) => Promise<boolean>;

function Resumen({ t, tz, act }: { t: DTrip; tz: string; act: Act }) {
  const [dlg, setDlg] = useState<'depart' | 'arrive' | 'stop' | 'finish' | 'fix' | null>(null);
  const canDepart = !t.actualDeparture && (t.status === 'planificado' || t.status === 'en_curso'); const canArrive = !!t.actualDeparture && !t.actualArrival && t.status !== 'finalizado';
  return <>
    <section className="panel"><div className="panel-b stack" style={{ gap: 8 }}>
      <h2>{t.origin} – {t.destination}</h2><div><b>{t.client}</b></div><div className="muted">{t.truck} · {t.plate}{t.kmLoaded ? ` · ${t.kmLoaded} km con carga` : ''}</div>
      {t.instructions ? <div className="banner blue"><div><b>Instrucciones</b><br />{t.instructions}</div></div> : <div className="muted small">Sin instrucciones especiales.</div>}
      <dl className="kv" style={{ gridTemplateColumns: '120px 1fr' }}><dt>Salida prevista</dt><dd>{fmtDateTime(t.plannedDeparture, tz)}</dd><dt>Llegada prevista</dt><dd>{fmtDateTime(t.plannedArrival, tz)}</dd>
        <dt>Salida real</dt><dd>{t.actualDeparture ? fmtDateTime(t.actualDeparture, tz) : '—'}</dd><dt>Llegada real</dt><dd>{t.actualArrival ? fmtDateTime(t.actualArrival, tz) : '—'}</dd>
        <dt>Odómetro</dt><dd>{t.odometerStart ?? '—'} → {t.odometerEnd ?? '—'}</dd>{t.serviceValue !== undefined && <><dt>Valor del servicio</dt><dd>{fmtMoney(t.serviceValue, 'ARS')}</dd></>}</dl>
      {t.timeCorrections.length > 0 && <div className="small muted">Correcciones: {t.timeCorrections.map(x => `${x.field === 'actualDeparture' ? 'salida' : 'llegada'} (${x.by}: ${x.reason})`).join(' · ')}</div>}</div></section>
    {canDepart && <button className="btn primary big-btn" onClick={() => setDlg('depart')}><Play size={22} /> Registrar salida</button>}
    {canArrive && <button className="btn primary big-btn" onClick={() => setDlg('arrive')}><Flag size={22} /> Registrar llegada</button>}
    {t.actualDeparture && t.status !== 'finalizado' && <button className="btn big-btn" onClick={() => setDlg('stop')}><Timer size={22} /> Registrar parada</button>}
    {t.actualDeparture && <button className="btn" onClick={() => setDlg('fix')}>Corregir un horario o el odómetro</button>}
    {t.actualArrival && !t.driverDone && <button className="btn primary big-btn" style={{ background: 'var(--nav)', borderColor: 'var(--nav)' }} onClick={() => setDlg('finish')}><Square size={22} /> Marcar trabajo terminado</button>}
    {t.driverDone && <div className="banner" style={{ background: 'var(--accent-soft)', borderColor: '#9FD6CD' }}><CheckCircle2 size={18} /><div><b>Enviado a revisión</b> el {fmtDateTime(t.driverDone.at, tz)}.{t.reviewedAt ? ' La oficina ya lo revisó.' : ' La oficina todavía no lo revisó.'}</div></div>}
    {t.stops.length > 0 && <section className="panel"><div className="panel-h"><h2>Paradas</h2></div><div className="panel-b stack" style={{ gap: 4 }}>{t.stops.map(s => <div key={s.id} className="small">{fmtDateTime(s.start, tz).slice(-5)} a {fmtDateTime(s.end, tz).slice(-5)} · {s.reason || 'sin motivo'}</div>)}</div></section>}
    {dlg === 'depart' && <TimeDialog kind="depart" t={t} tz={tz} act={act} onClose={() => setDlg(null)} />}{dlg === 'arrive' && <TimeDialog kind="arrive" t={t} tz={tz} act={act} onClose={() => setDlg(null)} />}
    {dlg === 'fix' && <FixDialog t={t} tz={tz} act={act} onClose={() => setDlg(null)} />}{dlg === 'stop' && <StopDialog t={t} tz={tz} act={act} onClose={() => setDlg(null)} />}
    {dlg === 'finish' && <Modal title="Marcar trabajo terminado" onClose={() => setDlg(null)} footer={<><button className="btn" onClick={() => setDlg(null)}>Cancelar</button><button className="btn primary" onClick={async () => { if (await act(() => api('POST', `/api/driver/trips/${t.id}/finish`, {}), 'El viaje quedó enviado a revisión administrativa.')) setDlg(null); }}>Sí, terminé</button></>}>
      <p>Se envía el viaje a revisión. Los gastos que cargaste quedan pendientes hasta que la oficina los apruebe o rechace.</p></Modal>}
  </>;
}

function TimeDialog({ kind, t, tz, act, onClose }: { kind: 'depart' | 'arrive'; t: DTrip; tz: string; act: Act; onClose: () => void }) {
  const [odo, setOdo] = useState<number | null>(null); const [other, setOther] = useState(false); const [when, setWhen] = useState(''); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); const body: Record<string, unknown> = { odometer: odo ?? undefined }; if (other) { body.at = localInputToIso(when, tz); body.reason = reason; } if (await act(() => api('POST', `/api/driver/trips/${t.id}/${kind}`, body), kind === 'depart' ? 'Salida registrada.' : 'Llegada registrada.')) onClose(); setBusy(false); };
  return <Modal title={kind === 'depart' ? 'Registrar salida' : 'Registrar llegada'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || (other && (!when || !reason.trim()))} onClick={go}>{busy ? 'Guardando…' : 'Confirmar'}</button></>}>
    <div className="stack"><p style={{ margin: 0 }}>Se registra la hora actual.</p><NumField label={kind === 'depart' ? 'Odómetro inicial (km)' : 'Odómetro final (km)'} value={odo} onChange={setOdo} />
      <label className="check"><input type="checkbox" checked={other} onChange={e => setOther(e.target.checked)} /> Usar otra hora (requiere motivo)</label>
      {other && <><Field label="Fecha y hora real"><input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} /></Field><Field label="Motivo"><input type="text" value={reason} onChange={e => setReason(e.target.value)} placeholder="Ej.: no tenía señal al salir" /></Field></>}</div></Modal>;
}
function FixDialog({ t, tz, act, onClose }: { t: DTrip; tz: string; act: Act; onClose: () => void }) {
  const [what, setWhat] = useState<'actualDeparture' | 'actualArrival' | 'odometer'>('actualDeparture'); const [when, setWhen] = useState(''); const [os, setOs] = useState<number | null>(t.odometerStart); const [oe, setOe] = useState<number | null>(t.odometerEnd); const [reason, setReason] = useState('');
  const go = async () => { const fn = what === 'odometer' ? () => api('POST', `/api/driver/trips/${t.id}/odometer`, { start: os, end: oe, reason }) : () => api('POST', `/api/driver/trips/${t.id}/${what === 'actualDeparture' ? 'depart' : 'arrive'}`, { at: localInputToIso(when, tz), reason }); if (await act(fn as never, 'Corrección registrada con tu nombre y el motivo.')) onClose(); };
  return <Modal title="Corregir registro" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!reason.trim() || (what !== 'odometer' && !when)} onClick={go}>Guardar corrección</button></>}>
    <div className="stack"><Field label="¿Qué corregís?"><select value={what} onChange={e => setWhat(e.target.value as 'odometer')}><option value="actualDeparture">Hora de salida</option><option value="actualArrival" disabled={!t.actualArrival}>Hora de llegada</option><option value="odometer">Odómetro</option></select></Field>
      {what === 'odometer' ? <div className="grid g2"><NumField label="Inicial" value={os} onChange={setOs} /><NumField label="Final" value={oe} onChange={setOe} /></div> : <Field label="Hora correcta"><input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} /></Field>}
      <Field label="Motivo de la corrección (obligatorio)"><input type="text" value={reason} onChange={e => setReason(e.target.value)} /></Field><p className="muted small" style={{ margin: 0 }}>Se conserva el valor anterior, tu nombre y el motivo.</p></div></Modal>;
}
function StopDialog({ t, tz, act, onClose }: { t: DTrip; tz: string; act: Act; onClose: () => void }) {
  const [s, setS] = useState(''); const [e, setE] = useState(''); const [r, setR] = useState('Descanso');
  const go = async () => { if (await act(() => api('POST', `/api/driver/trips/${t.id}/stops`, { start: localInputToIso(s, tz), end: localInputToIso(e, tz), reason: r }), 'Parada registrada.')) onClose(); };
  return <Modal title="Registrar parada" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!s || !e} onClick={go}>Guardar parada</button></>}>
    <div className="stack"><Field label="Inicio"><input type="datetime-local" value={s} onChange={x => setS(x.target.value)} /></Field><Field label="Fin"><input type="datetime-local" value={e} onChange={x => setE(x.target.value)} /></Field><Field label="Motivo"><select value={r} onChange={x => setR(x.target.value)}>{['Descanso', 'Carga', 'Descarga', 'Control en ruta', 'Espera', 'Otro'].map(o => <option key={o}>{o}</option>)}</select></Field></div></Modal>;
}

function Thumb({ id, name, mime }: { id: string; name: string; mime: string }) {
  const { url } = useBlobUrl(mime.startsWith('image/') ? `/api/files/${id}` : null); const [big, setBig] = useState(false);
  return <>{url ? <img src={url} alt={name} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--line)', cursor: 'pointer' }} onClick={() => setBig(true)} /> : <span className="chip gray">{mime === 'application/pdf' ? 'PDF' : '…'}</span>}
    {big && url && <Modal title={name} onClose={() => setBig(false)}><img src={url} alt={name} style={{ maxWidth: '100%' }} /></Modal>}</>;
}

function Gastos({ t, tz, act, setSave }: { t: DTrip; tz: string; act: Act; setSave: (s: Save) => void }) {
  const [cat, setCat] = useState<ExpenseCategory>('fuel'); const [amount, setAmount] = useState<number | null>(null); const [note, setNote] = useState(''); const [file, setFile] = useState<File | null>(null);
  const [reqId, setReqId] = useState(() => crypto.randomUUID()); const [pendingPhoto, setPendingPhoto] = useState<{ expenseId: string; file: File } | null>(null); const [busy, setBusy] = useState(false); const input = useRef<HTMLInputElement>(null);
  const upload = async (expenseId: string, f: File) => act(async () => api('POST', `/api/driver/trips/${t.id}/files`, { name: f.name, description: `${EXPENSE_LABEL[cat]}`, expenseId, dataBase64: await toBase64(f) }), 'Gasto y foto guardados. Queda pendiente de revisión.');
  const send = async () => {
    if (amount == null || amount <= 0) return; setBusy(true);
    // el identificador de la solicitud hace seguro el reintento: si el servidor ya guardó el gasto, no se duplica
    try {
      const r = await api<{ expenseId?: string; trip: DTrip }>('POST', `/api/driver/trips/${t.id}/expenses`, { category: cat, amount, date: localDate(new Date(), tz), note, clientRequestId: reqId });
      const id = r.expenseId ?? r.trip.expenses.find(e => e.status === 'pendiente_revision' && e.amount === amount && e.category === cat)?.id;
      if (file && id) { const ok = await upload(id, file); if (!ok) { setPendingPhoto({ expenseId: id, file }); setBusy(false); return; } }
      else await act(async () => r, 'Gasto guardado. Queda pendiente de revisión.');
      setAmount(null); setNote(''); setFile(null); setReqId(crypto.randomUUID()); if (input.current) input.current.value = '';
    } catch (e) { setSave({ kind: 'err', msg: e instanceof ApiError ? e.errors.join(' ') : 'No se pudo guardar.' }); }
    setBusy(false);
  };
  return <>
    <section className="panel"><div className="panel-h"><h2>Cargar gasto</h2></div><div className="panel-b stack">
      <Field label="Tipo"><select value={cat} onChange={e => setCat(e.target.value as ExpenseCategory)}>{CATS.map(c => <option key={c} value={c}>{EXPENSE_LABEL[c]}</option>)}</select></Field>
      <NumField label="Importe" prefix="$" value={amount} onChange={setAmount} /><Field label="Nota (opcional)"><input type="text" value={note} onChange={e => setNote(e.target.value)} /></Field>
      <Field label="Foto del ticket o comprobante" hint="La foto queda adjunta pero no confirma el gasto: lo revisa la oficina."><input ref={input} type="file" accept="image/png,image/jpeg,application/pdf" capture="environment" onChange={e => setFile(e.target.files?.[0] ?? null)} /></Field>
      <button className="btn primary big-btn" disabled={busy || !amount || amount <= 0} onClick={send}>{busy ? 'Guardando…' : 'Guardar gasto'}</button>
      {pendingPhoto && <div className="banner amber"><AlertTriangle size={18} /><div><b>El gasto se guardó, pero la foto no.</b> <button className="btn sm" onClick={async () => { if (await upload(pendingPhoto.expenseId, pendingPhoto.file)) { setPendingPhoto(null); setAmount(null); setNote(''); setFile(null); setReqId(crypto.randomUUID()); } }}>Reintentar subir la foto</button></div></div>}</div></section>
    <section className="panel"><div className="panel-h"><h2>Mis gastos en este viaje</h2></div><div className="panel-b stack" style={{ gap: 10 }}>
      {t.expenses.map(e => <div key={e.id} style={{ borderBottom: '1px solid var(--line-2)', paddingBottom: 8 }}><div className="row between" style={{ flexWrap: 'nowrap' }}><b>{EXPENSE_LABEL[e.category]} · {fmtMoney(e.amount, 'ARS', 2)}</b><span className={`chip ${EXP_STATUS[e.status]?.c ?? 'gray'}`}>{EXP_STATUS[e.status]?.l ?? e.status}</span></div>
        <div className="small muted">{fmtDate(e.date)}{e.note ? ` · ${e.note}` : ''}</div>{e.status === 'rechazado' && <div className="banner red" style={{ marginTop: 6, fontSize: 14 }}><div><b>Motivo del rechazo:</b> {e.rejectionReason}</div></div>}
        <div className="row" style={{ marginTop: 4 }}>{t.files.filter(f => f.expenseId === e.id).map(f => <Thumb key={f.id} {...f} />)}
          {e.status === 'pendiente_revision' && <button className="btn sm ghost danger" onClick={() => act(() => api('DELETE', `/api/driver/trips/${t.id}/expenses/${e.id}`), 'Gasto retirado.')}>Retirar</button>}</div></div>)}
      {!t.expenses.length && <p className="muted" style={{ margin: 0 }}>Todavía no cargaste gastos.</p>}</div></section></>;
}

function Fotos({ t, act }: { t: DTrip; act: Act }) {
  const [file, setFile] = useState<File | null>(null); const [desc, setDesc] = useState(''); const input = useRef<HTMLInputElement>(null);
  const go = async () => { if (!file) return; if (await act(async () => api('POST', `/api/driver/trips/${t.id}/files`, { name: file.name, description: desc, dataBase64: await toBase64(file) }), 'Foto guardada en el viaje.')) { setFile(null); setDesc(''); if (input.current) input.current.value = ''; } };
  return <>
    <section className="panel"><div className="panel-h"><h2>Adjuntar foto o comprobante</h2></div><div className="panel-b stack"><Field label="Foto (remito, ticket, daño…) o PDF"><input ref={input} type="file" accept="image/png,image/jpeg,application/pdf" capture="environment" onChange={e => setFile(e.target.files?.[0] ?? null)} /></Field>
      <Field label="Descripción"><input type="text" value={desc} onChange={e => setDesc(e.target.value)} /></Field><button className="btn primary big-btn" disabled={!file} onClick={go}><Camera size={22} /> Guardar foto</button></div></section>
    <section className="panel"><div className="panel-h"><h2>Archivos del viaje</h2></div><div className="panel-b stack">{t.files.map(f => <div key={f.id} className="row" style={{ flexWrap: 'nowrap' }}><Thumb {...f} /><div><div>{f.name}</div><div className="small muted">{f.description || '—'} · {fmtDate(f.uploadedAt.slice(0, 10))}</div></div></div>)}{!t.files.length && <p className="muted" style={{ margin: 0 }}>Sin archivos.</p>}</div></section></>;
}

function Novedades({ t, tz, act }: { t: DTrip; tz: string; act: Act }) {
  const [text, setText] = useState('');
  return <>
    <section className="panel"><div className="panel-h"><h2>Registrar incidente u observación</h2></div><div className="panel-b stack"><Field label="¿Qué pasó?"><textarea value={text} onChange={e => setText(e.target.value)} placeholder="Demora en carga, desvío por corte de ruta, golpe a la carga…" /></Field>
      <button className="btn primary big-btn" disabled={!text.trim()} onClick={async () => { if (await act(() => api('POST', `/api/driver/trips/${t.id}/incidents`, { text }), 'Novedad registrada.')) setText(''); }}>Guardar novedad</button></div></section>
    <section className="panel"><div className="panel-h"><h2>Novedades registradas</h2></div><div className="panel-b stack">{t.incidents.map(i => <div key={i.id}><div className="small muted">{fmtDateTime(i.at, tz)} · {i.by}</div>{i.text}</div>)}{!t.incidents.length && <p className="muted" style={{ margin: 0 }}>Sin novedades.</p>}</div></section></>;
}
