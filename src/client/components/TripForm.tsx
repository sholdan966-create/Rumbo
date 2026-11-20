import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useApp } from '../store';
import { api, ApiError } from '../api';
import { DateTimeField, Drawer, Field, Modal, NumField } from './ui';
import { EXPENSE_CATEGORIES, EXPENSE_LABEL, ExpenseCategory, Trip } from '../../shared/types';
import { validateTrip } from '../../shared/validate';
import { categoryAmount } from '../../shared/calc';
import { localDate, localInputToIso } from '../../shared/time';
import { href, navigate } from '../router';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

export function blankTrip(id: string, d: { clients: { id: string }[]; trucks: { id: string }[]; drivers: { id: string }[]; settings: { defaultIvaRate: number; timezone: string } }, tz: string): Trip {
  const now = new Date().toISOString(); const day = localDate(now, tz);
  return {
    id, clientId: d.clients[0]?.id ?? '', origin: 'Rosario', destination: '', truckId: d.trucks[0]?.id ?? '', driverId: d.drivers[0]?.id ?? '', status: 'planificado',
    plannedDeparture: localInputToIso(`${day}T06:00`, tz), plannedArrival: null, actualDeparture: null, actualArrival: null, kmLoaded: null, kmEmpty: null, odometerStart: null, odometerEnd: null,
    serviceValue: null, ivaRate: d.settings.defaultIvaRate, expenses: [], expenseConfirmed: {}, notes: '', createdAt: now, updatedAt: now,
  };
}

export function TripForm({ trip, isNew, onClose }: { trip: Trip; isNew: boolean; onClose: () => void }) {
  const { data, tz, run, toast, reload, money } = useApp();
  const [t, setT] = useState<Trip>(trip);
  const set = <K extends keyof Trip>(k: K, v: Trip[K]) => setT(x => ({ ...x, [k]: v }));
  // Gastos: por categoría con a lo sumo un registro se edita acá; con varios, se edita en el detalle.
  const multi = Object.fromEntries(EXPENSE_CATEGORIES.map(c => [c, trip.expenses.filter(e => e.category === c).length > 1])) as Record<ExpenseCategory, boolean>;
  const [exp, setExp] = useState<Record<ExpenseCategory, number | null>>(() => Object.fromEntries(EXPENSE_CATEGORIES.map(c => [c, categoryAmount(trip, c)])) as Record<ExpenseCategory, number | null>);
  const [budget, setBudget] = useState<Partial<Record<ExpenseCategory, number | null>>>(trip.budget ?? {});
  const [newClient, setNewClient] = useState<string | null>(null); const [newDriver, setNewDriver] = useState<string | null>(null);
  const [dup, setDup] = useState<string | null>(null); const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false); const [reason, setReason] = useState('');
  const critical = (isNew || trip.status !== 'finalizado') ? [] : (['serviceValue', 'status', 'truckId', 'driverId', 'kmLoaded', 'kmEmpty', 'actualDeparture', 'actualArrival'] as const).filter(k => JSON.stringify(t[k]) !== JSON.stringify(trip[k]));
  void critical;
  useEffect(() => { if (isNew) api<{ id: string }>('GET', '/api/next-trip-id').then(r => setT(x => ({ ...x, id: r.id }))).catch(() => undefined); }, [isNew]);

  const build = (): Trip => {
    const expenses = [...t.expenses.filter(e => multi[e.category])]; const confirmed: Trip['expenseConfirmed'] = {};
    for (const c of EXPENSE_CATEGORIES) {
      if (multi[c]) continue; const v = exp[c];
      if (v == null) continue;
      if (v === 0) { confirmed[c] = true; continue; }
      const prev = trip.expenses.find(e => e.category === c);
      expenses.push({ id: prev?.id ?? uid(), category: c, amount: v, date: prev?.date ?? localDate(new Date().toISOString(), tz), note: prev?.note });
    }
    const b = Object.fromEntries(Object.entries(budget).filter(([, v]) => v != null)) as Trip['budget'];
    return { ...t, expenses, expenseConfirmed: confirmed, budget: b && Object.keys(b).length ? b : undefined };
  };
  const draft = useMemo(build, [t, exp, budget]); // eslint-disable-line
  const ctxData = { ...data, clients: newClient ? [...data.clients, { id: 'new-c', name: newClient, cuit: '', paymentTermDays: 30 }] : data.clients, drivers: newDriver ? [...data.drivers, { id: 'new-d', name: newDriver }] : data.drivers };
  const v = useMemo(() => validateTrip(newClient != null ? { ...draft, clientId: newClient ? 'new-c' : '' } : draft, ctxData, isNew), [draft, data, newClient, newDriver, isNew]); // eslint-disable-line
  const err = (f: string) => (touched ? v.errors.find(e => e.field === f)?.message : undefined);
  const warn = (f: string) => v.warnings.filter(w => w.field === f).map(w => w.message).join(' ');

  const save = async (confirmDup = false) => {
    setTouched(true);
    const vv = validateTrip(newClient != null ? { ...draft, clientId: newClient ? 'new-c' : '' } : draft, ctxData, isNew);
    if (newClient === '' || newDriver === '') { toast('Escribí el nombre del nuevo cliente o chofer', 'err'); return; }
    if (vv.errors.length) { toast('Revisá los campos marcados', 'err'); return; }
    if (critical.length && !reason.trim()) { toast('Indicá el motivo de la corrección', 'err'); return; }
    setSaving(true);
    try {
      let out = { ...draft };
      if (newClient) { const id = `C${Date.now().toString(36)}`; await api('PUT', `/api/clients/${id}`, { id, name: newClient, cuit: '', paymentTermDays: 30 }); out.clientId = id; }
      if (newDriver) { const id = `D${Date.now().toString(36)}`; await api('PUT', `/api/drivers/${id}`, { id, name: newDriver }); out.driverId = id; }
      const r = await api<{ warnings: string[]; report: { reason: string; created: boolean } }>('PUT', `/api/trips/${out.id}${confirmDup ? '?confirmDuplicate=1' : ''}`, { ...out, _reason: reason.trim() || undefined });
      await reload();
      toast(`Viaje ${out.id} guardado. ${r.report.created ? 'La ficha PDF se genera en segundo plano.' : r.report.reason + '.'}`);
      onClose(); navigate(`viajes/${out.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.body?.duplicates) setDup(e.body.message);
      else toast(e instanceof ApiError ? e.errors.join('\n') : 'No se pudo guardar', 'err');
    } finally { setSaving(false); }
  };

  const clientSelect = newClient != null
    ? <Field label="Cliente nuevo" error={err('clientId')}><div className="row" style={{ flexWrap: 'nowrap' }}><input type="text" autoFocus value={newClient} onChange={e => setNewClient(e.target.value)} placeholder="Razón social" /><button className="btn sm" onClick={() => setNewClient(null)}>Cancelar</button></div></Field>
    : <Field label="Cliente" error={err('clientId')}><select value={t.clientId} onChange={e => e.target.value === '__new' ? setNewClient('') : set('clientId', e.target.value)}>{data.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}<option value="__new">+ Agregar cliente…</option></select></Field>;
  const driverSelect = newDriver != null
    ? <Field label="Chofer nuevo" error={err('driverId')}><div className="row" style={{ flexWrap: 'nowrap' }}><input type="text" autoFocus value={newDriver} onChange={e => setNewDriver(e.target.value)} placeholder="Nombre y apellido" /><button className="btn sm" onClick={() => setNewDriver(null)}>Cancelar</button></div></Field>
    : <Field label="Chofer" error={err('driverId')}><select value={t.driverId} onChange={e => e.target.value === '__new' ? setNewDriver('') : set('driverId', e.target.value)}>{data.drivers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}<option value="__new">+ Agregar chofer…</option></select></Field>;

  return (
    <Drawer title={isNew ? 'Nuevo viaje' : `Editar viaje ${trip.id}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={saving} onClick={() => save()}>{saving ? 'Guardando…' : 'Guardar viaje'}</button></>}>
      {touched && v.errors.length > 0 && <div className="banner red" style={{ marginBottom: 14 }}><AlertTriangle size={18} /><div>Hay {v.errors.length} dato(s) para corregir antes de guardar.</div></div>}
      {isNew && <div className="banner blue" style={{ marginBottom: 14 }}><div>¿Todavía no hay precio acordado? <a href={href('cotizaciones/nueva')} onClick={onClose}>Cotizá el viaje primero</a>: al aceptarse se convierte en viaje sin volver a cargar datos y conserva su presupuesto.</div></div>}
      <div className="form-section">Datos generales</div>
      <div className="grid g2">
        <Field label="Identificador" error={err('id')}><input type="text" value={t.id} disabled={!isNew} onChange={e => set('id', e.target.value)} /></Field>
        <Field label="Estado"><select value={t.status} onChange={e => set('status', e.target.value as Trip['status'])}><option value="planificado">Planificado</option><option value="en_curso">En curso</option><option value="finalizado">Finalizado</option><option value="cancelado">Cancelado</option></select></Field>
        {clientSelect}
        <Field label="Origen" error={err('origin')}><input type="text" list="places" value={t.origin} onChange={e => set('origin', e.target.value)} /></Field>
        <Field label="Destino" error={err('destination')} hint={warn('destination')}><input type="text" list="places" value={t.destination} onChange={e => set('destination', e.target.value)} /></Field>
        <Field label="Camión" error={err('truckId')} hint={warn('truckId')}><select value={t.truckId} onChange={e => set('truckId', e.target.value)}>{data.trucks.map(c => <option key={c.id} value={c.id}>{c.name} · {c.plate}</option>)}</select></Field>
        {driverSelect}
      </div>
      <div className="form-section">Horarios <span className="muted" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>(hora de {tz.split('/').pop()?.replace(/_/g, ' ')})</span></div>
      <div className="grid g2">
        <DateTimeField label="Salida prevista" value={t.plannedDeparture} onChange={x => set('plannedDeparture', x)} tz={tz} error={err('plannedDeparture')} />
        <DateTimeField label="Llegada prevista" value={t.plannedArrival} onChange={x => set('plannedArrival', x)} tz={tz} error={err('plannedArrival')} />
        <DateTimeField label="Salida real" value={t.actualDeparture} onChange={x => set('actualDeparture', x)} tz={tz} error={err('actualDeparture')} />
        <DateTimeField label="Llegada real" value={t.actualArrival} onChange={x => set('actualArrival', x)} tz={tz} error={err('actualArrival')} hint={warn('actualArrival')} />
      </div>
      <div className="form-section">Kilómetros y odómetro</div>
      <div className="grid g2">
        <NumField label="Km con carga" value={t.kmLoaded} onChange={x => set('kmLoaded', x)} error={err('kmLoaded')} hint="Vacío = pendiente de carga" />
        <NumField label="Km vacíos" value={t.kmEmpty} onChange={x => set('kmEmpty', x)} error={err('kmEmpty')} hint="Escribí 0 si no hubo km vacíos" />
        <NumField label="Odómetro inicial" value={t.odometerStart} onChange={x => set('odometerStart', x)} error={err('odometerStart')} />
        <NumField label="Odómetro final" value={t.odometerEnd} onChange={x => set('odometerEnd', x)} error={err('odometerEnd')} hint={warn('odometerEnd')} />
      </div>
      <div className="form-section">Valor del servicio</div>
      <div className="grid g2">
        <NumField label="Valor del servicio (neto, sin IVA)" prefix="$" value={t.serviceValue} onChange={x => set('serviceValue', x)} error={err('serviceValue')} hint={warn('serviceValue') || (t.serviceValue != null ? `Con IVA: ${money(t.serviceValue * (1 + t.ivaRate), 2)}` : undefined)} />
        <Field label="IVA (%)" error={err('ivaRate')}><input type="number" value={t.ivaRate * 100} min={0} max={50} step={0.5} onChange={e => set('ivaRate', Number(e.target.value) / 100)} /></Field>
      </div>
      <div className="form-section">Gastos atribuibles al viaje</div>
      <p className="muted small" style={{ margin: '0 0 10px' }}>Dejá un campo vacío si el dato todavía no está cargado. Escribí <b>0</b> para confirmar que el gasto fue de $0.</p>
      <div className="grid g2">
        {EXPENSE_CATEGORIES.map(c => multi[c]
          ? <Field key={c} label={EXPENSE_LABEL[c]} hint="Tiene varios registros: se editan en el detalle del viaje"><input type="text" disabled value={money(categoryAmount(trip, c))} /></Field>
          : <NumField key={c} label={EXPENSE_LABEL[c] + (c === 'driverPay' ? ' (pago al chofer)' : '')} prefix="$" value={exp[c]} onChange={x => setExp(s => ({ ...s, [c]: x }))} error={err('expenses')} />)}
      </div>
      <details style={{ marginTop: 14 }}><summary style={{ cursor: 'pointer', fontWeight: 500 }}>Presupuesto de gastos (opcional)</summary>
        <div className="grid g2" style={{ marginTop: 10 }}>{EXPENSE_CATEGORIES.map(c => <NumField key={c} label={`Presupuesto · ${EXPENSE_LABEL[c]}`} prefix="$" value={budget[c] ?? null} onChange={x => setBudget(s => ({ ...s, [c]: x }))} />)}</div></details>
      <div className="form-section">Observaciones e instrucciones</div>
      <Field label="Notas del viaje"><textarea value={t.notes} onChange={e => set('notes', e.target.value)} /></Field>
      <Field label="Instrucciones para el chofer (las ve en su portal)" className=""><textarea value={t.instructions ?? ''} onChange={e => set('instructions', e.target.value)} /></Field>
      {critical.length > 0 && <div className="banner amber" style={{ marginTop: 14 }}><AlertTriangle size={18} /><div style={{ flex: 1 }}><b>Corrección de un viaje finalizado</b> ({critical.join(', ')}). Queda registrada con valores anteriores y nuevos.<Field label="Motivo de la corrección (obligatorio)" className=""><input type="text" value={reason} onChange={e => setReason(e.target.value)} /></Field></div></div>}
      {v.warnings.length > 0 && <div className="banner amber" style={{ marginTop: 14 }}><AlertTriangle size={18} /><div>{v.warnings.map(w => <div key={w.message}>{w.message}</div>)}</div></div>}
      {dup && <Modal title="Posible duplicado" onClose={() => setDup(null)} footer={<><button className="btn" onClick={() => setDup(null)}>Revisar</button><button className="btn primary" onClick={() => { setDup(null); save(true); }}>Guardar de todas formas</button></>}>
        <p>{dup}.</p><p className="muted">Coinciden cliente, ruta, camión, día de salida e importe con un viaje ya cargado. Si es un viaje distinto, podés guardarlo igual.</p></Modal>}
    </Drawer>
  );
}
