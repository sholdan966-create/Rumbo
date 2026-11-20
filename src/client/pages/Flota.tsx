import { useMemo, useState } from 'react';
import { Plus, Trash2, Wrench, Pencil } from 'lucide-react';
import { useApp } from '../store';
import { api } from '../api';
import { Route, href, navigate } from '../router';
import { Field, Kpi, Modal, NumField, Tabs, TripChip } from '../components/ui';
import { aggregate, currentOdometer, estimateUsage, paramsError, routeKey, serviceStatus, monthlyPool, tripMonth } from '../../shared/calc';
import { EXPENSE_CATEGORIES, EXPENSE_LABEL, ServicePlan, Truck } from '../../shared/types';
import { fmtDate, fmtKm, fmtNum, fmtPct, NA } from '../../shared/format';
import { monthName, monthsOf } from '../lib';
import { FIXED_COST_TEMPLATE } from '../../shared/templates';
import { DocumentsPanel, FilesPanel, HistoryPanel } from '../components/Attach';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
type Tab = 'resumen' | 'viajes' | 'gastos' | 'parametros' | 'mantenimiento' | 'documentos' | 'historial';
const SVC = { vencido: { l: 'Vencido', c: 'red' }, proximo: { l: 'Próximo', c: 'amber' }, al_dia: { l: 'Al día', c: 'accent' }, sin_datos: { l: 'Sin datos suficientes', c: 'gray' } } as const;

export function Flota({ route }: { route: Route }) {
  const { data, today, canEdit, run } = useApp();
  const id = route.path[1] ?? data.trucks[0]?.id; const truck = data.trucks.find(t => t.id === id);
  const [adding, setAdding] = useState(false);
  const tab = (route.query.get('tab') as Tab) ?? 'resumen';
  const alerts = (t: Truck) => t.servicePlans.map(p => serviceStatus(p, currentOdometer(t, data.trips), today).status).filter(s => s === 'vencido' || s === 'proximo');
  return (
    <>
      <div className="page-head"><div><h1>Flota</h1><p>Ficha por vehículo: kilometraje, historial, parámetros de costos y próximos servicios.</p></div>
        <div className="page-actions"><button className="btn primary" disabled={!canEdit} onClick={() => setAdding(true)}><Plus size={16} /> Agregar camión</button></div></div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(220px, 280px) minmax(0, 1fr)', alignItems: 'start' }} data-fleet>
        <style>{`@media (max-width: 900px) { [data-fleet] { grid-template-columns: 1fr !important; } }`}</style>
        <section className="panel"><div className="truck-list">{data.trucks.map(t => { const a = alerts(t); return (
          <button key={t.id} className={`truck-item ${t.id === id ? 'on' : ''}`} onClick={() => navigate(`flota/${t.id}`, { tab })}>
            <span className="row between" style={{ flexWrap: 'nowrap' }}><b>{t.name}</b>{a.length > 0 && <span className={`chip ${a.includes('vencido') ? 'red' : 'amber'}`}><Wrench size={13} /> {a.includes('vencido') ? 'Servicio vencido' : 'Servicio próximo'}</span>}</span>
            <span className="muted small">{t.plate} · {t.model}</span><span className="muted small">{fmtKm(currentOdometer(t, data.trips))}</span></button>); })}</div></section>
        {truck ? <TruckPanel key={truck.id} truck={truck} tab={tab} /> : <div className="empty">No hay camiones cargados.</div>}
      </div>
      {adding && <NewTruck onClose={() => setAdding(false)} onSaved={tid => { setAdding(false); navigate(`flota/${tid}`); }} run={run} />}
    </>
  );
}

function NewTruck({ onClose, onSaved, run }: { onClose: () => void; onSaved: (id: string) => void; run: ReturnType<typeof useApp>['run'] }) {
  const [v, setV] = useState({ name: '', plate: '', model: '', year: '' });
  const save = async () => {
    const t: Truck = { id: `T${Date.now().toString(36)}`, name: v.name, plate: v.plate, model: v.model, year: v.year ? Number(v.year) : null, odometerKm: null, odometerDate: null,
      params: { maintenancePerKm: null, tireSetCost: null, tireLifeKm: null, baseValue: null, residualValue: null, lifeKm: null, updatedAt: null }, monthlyFixedCosts: FIXED_COST_TEMPLATE.map(label => ({ id: crypto.randomUUID(), label, amount: 0 })), servicePlans: [], serviceHistory: [] };
    if (await run(() => api('PUT', `/api/trucks/${t.id}`, t), 'Camión agregado')) onSaved(t.id);
  };
  return <Modal title="Agregar camión" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!v.name || !v.plate} onClick={save}>Guardar</button></>}>
    <div className="grid g2"><Field label="Nombre interno"><input type="text" value={v.name} onChange={e => setV({ ...v, name: e.target.value })} placeholder="Camión 7" /></Field><Field label="Patente"><input type="text" value={v.plate} onChange={e => setV({ ...v, plate: e.target.value })} /></Field>
      <Field label="Modelo"><input type="text" value={v.model} onChange={e => setV({ ...v, model: e.target.value })} /></Field><Field label="Año"><input type="number" value={v.year} onChange={e => setV({ ...v, year: e.target.value })} /></Field></div>
    <p className="muted small">Se cargan rubros de costo mensual en $0 (seguro, patente, rastreo, cochera, administración): completá los importes en la ficha, pestaña Parámetros de costos.</p></Modal>;
}

function TruckPanel({ truck, tab }: { truck: Truck; tab: Tab }) {
  const { data, calcs, money, tz, today } = useApp();
  const [month, setMonth] = useState('todos');
  const trips = useMemo(() => data.trips.filter(t => t.truckId === truck.id && (month === 'todos' || tripMonth(t, tz) === month)), [data, truck.id, month, tz]);
  const fin = trips.filter(t => t.status === 'finalizado'); const agg = aggregate(fin.map(t => calcs.get(t.id)!));
  const odo = currentOdometer(truck, data.trips);
  return (
    <div>
      <div className="row between" style={{ marginBottom: 12 }}><div><h2 style={{ fontSize: 20 }}>{truck.name}</h2><span className="muted">{truck.plate} · {truck.model}{truck.year ? ` · ${truck.year}` : ''} · {fmtKm(odo)}</span></div>
        <Field label="Período"><select value={month} onChange={e => setMonth(e.target.value)}><option value="todos">Todos los meses</option>{monthsOf(data).map(m => <option key={m} value={m}>{monthName(m)}</option>)}</select></Field></div>
      <Tabs<Tab> value={tab} onChange={t => navigate(`flota/${truck.id}`, { tab: t })} tabs={[{ id: 'resumen', label: 'Resumen' }, { id: 'viajes', label: `Viajes (${trips.length})` }, { id: 'gastos', label: 'Gastos' }, { id: 'parametros', label: 'Parámetros de costos' }, { id: 'mantenimiento', label: 'Mantenimiento' }, { id: 'documentos', label: 'Documentos' }, { id: 'historial', label: 'Historial' }]} />
      {tab === 'resumen' && <div className="stack">
        <div className="kpis k3"><Kpi label="Viajes finalizados" value={agg.trips} sub={`${trips.length} en el período`} /><Kpi label="Kilómetros" value={fmtNum(agg.km)} sub="Con km disponibles" /><Kpi label="Ingresos" value={money(agg.revenue)} /><Kpi label="Resultado" value={money(agg.result)} tone={agg.result < 0 ? 'bad' : undefined} /><Kpi label="Margen" value={fmtPct(agg.marginPct)} tone={agg.marginPct != null && agg.marginPct < data.settings.marginTarget ? 'warn' : undefined} sub={`Objetivo ${fmtPct(data.settings.marginTarget)}`} /><Kpi label="Costo por km" value={money(agg.costPerKm)} /></div>
        <OdometerCard truck={truck} odo={odo} />
        <div className="banner blue"><div>Costos operativos mensuales configurados: <b>{money(monthlyPool(truck))}</b> por mes. Se reparten entre los viajes finalizados del mes en proporción a sus km (ver pestaña Parámetros).</div></div></div>}
      {tab === 'viajes' && <section className="panel"><div className="table-wrap"><table className="tbl"><thead><tr><th>Viaje</th><th>Ruta</th><th>Estado</th><th className="num">Km</th><th className="num">Resultado</th><th className="num">Margen</th></tr></thead><tbody>
        {[...trips].sort((a, b) => b.id.localeCompare(a.id)).map(t => { const c = calcs.get(t.id)!; return <tr key={t.id} className="click" onClick={() => navigate(`viajes/${t.id}`)}><td><a href={href(`viajes/${t.id}`)}>{t.id}</a></td><td>{routeKey(t)}</td><td><TripChip s={t.status} /></td><td className="num">{c.kmTotal != null ? fmtNum(c.kmTotal) : '—'}</td><td className="num">{t.status === 'finalizado' ? money(c.result) : '—'}</td><td className="num">{t.status === 'finalizado' ? fmtPct(c.marginPct) : '—'}</td></tr>; })}
        {!trips.length && <tr><td colSpan={6} className="empty">Sin viajes en el período.</td></tr>}</tbody></table></div></section>}
      {tab === 'gastos' && <Expenses truck={truck} agg={agg} />}
      {tab === 'parametros' && <Params truck={truck} />}
      {tab === 'mantenimiento' && <Maintenance truck={truck} odo={odo} today={today} />}
      {tab === 'documentos' && <div className="stack"><DocumentsPanel ownerType="vehiculo" ownerId={truck.id} title={`Documentación de ${truck.name}`} /><FilesPanel entityType="camion" entityId={truck.id} title="Otros archivos del vehículo" /></div>}
      {tab === 'historial' && <HistoryPanel refId={truck.id} />}
    </div>
  );
}

function OdometerCard({ truck, odo }: { truck: Truck; odo: number | null }) {
  const { run, canEdit, today } = useApp(); const [v, setV] = useState<number | null>(null);
  return <section className="panel"><div className="panel-h"><h2>Kilometraje</h2></div><div className="panel-b stack">
    <div><div style={{ fontSize: 24, fontWeight: 600 }} className="num">{fmtKm(odo)}</div><div className="muted small">Mayor valor entre el kilometraje cargado ({fmtKm(truck.odometerKm)}{truck.odometerDate ? ` al ${fmtDate(truck.odometerDate)}` : ''}) y los odómetros finales de los viajes</div></div>
    {canEdit && <div className="row" style={{ alignItems: 'flex-end' }}><NumField label="Actualizar kilometraje" value={v} onChange={setV} /><button className="btn" disabled={v == null || (odo != null && v < odo)} onClick={() => run(() => api('PUT', `/api/trucks/${truck.id}`, { ...truck, odometerKm: v, odometerDate: today }), 'Kilometraje actualizado')}>Guardar</button></div>}</div></section>;
}

function Expenses({ truck, agg }: { truck: Truck; agg: ReturnType<typeof aggregate> }) {
  const { money } = useApp(); const svc = truck.serviceHistory.reduce((s, h) => s + (h.cost ?? 0), 0);
  return <div className="stack"><section className="panel"><div className="panel-h"><h2>Gastos de los viajes finalizados</h2></div><div className="table-wrap"><table className="tbl"><tbody>
    {EXPENSE_CATEGORIES.map(k => <tr key={k}><td>{EXPENSE_LABEL[k]}</td><td className="num">{money(agg.direct[k])}</td><td className="num muted">{fmtPct(agg.totalCost ? (agg.direct[k] / agg.totalCost) * 100 : null)}</td></tr>)}
    <tr><td><b>Gastos registrados</b></td><td className="num"><b>{money(agg.directTotal)}</b></td><td></td></tr><tr><td>Costos operativos asignados</td><td className="num">{money(agg.allocated)}</td><td></td></tr><tr><td><b>Costo total</b></td><td className="num"><b>{money(agg.totalCost)}</b></td><td></td></tr>
    <tr><td className="muted">Estimaciones de uso (no se suman)</td><td className="num muted">{money(agg.estimates)}</td><td></td></tr></tbody></table></div></section>
    <section className="panel"><div className="panel-h"><h2>Servicios de taller registrados</h2></div><div className="panel-b">Total registrado en el historial: <b>{money(svc)}</b>. Es un gasto de taller independiente de los gastos del viaje y de las estimaciones; no se suma a los resultados por viaje.</div></section></div>;
}

function Params({ truck }: { truck: Truck }) {
  const { run, canEdit, money } = useApp();
  const [p, setP] = useState(truck.params); const [fixed, setFixed] = useState(truck.monthlyFixedCosts);
  const errs = paramsError(p); const est = estimateUsage(p, 1000);
  const dirty = JSON.stringify(p) !== JSON.stringify(truck.params) || JSON.stringify(fixed) !== JSON.stringify(truck.monthlyFixedCosts);
  const set = (k: keyof typeof p) => (v: number | null) => setP(x => ({ ...x, [k]: v }));
  return <div className="stack">
    <section className="panel"><div className="panel-h"><h2>Estimaciones de uso del vehículo</h2><span className="chip gray">{truck.params.updatedAt ? `Actualizado el ${fmtDate(truck.params.updatedAt)}` : 'Sin configurar'}</span></div><div className="panel-b stack">
      <div className="grid g3">
        <NumField label="Mantenimiento por km" prefix="$" value={p.maintenancePerKm} onChange={set('maintenancePerKm')} hint="Presupuesto de mantenimiento por km" />
        <NumField label="Consumo de combustible (L/100 km)" value={p.fuelLPer100km ?? null} onChange={v => setP(x => ({ ...x, fuelLPer100km: v }))} hint="Se usa para cotizar; el precio del litro se configura en Configuración" />
        <NumField label="Costo del juego de neumáticos" prefix="$" value={p.tireSetCost} onChange={set('tireSetCost')} /><NumField label="Vida útil estimada de neumáticos (km)" value={p.tireLifeKm} onChange={set('tireLifeKm')} />
        <NumField label="Valor base del vehículo" prefix="$" value={p.baseValue} onChange={set('baseValue')} /><NumField label="Valor residual esperado" prefix="$" value={p.residualValue} onChange={set('residualValue')} /><NumField label="Vida útil estimada del vehículo (km)" value={p.lifeKm} onChange={set('lifeKm')} /></div>
      {errs.length > 0 && <div className="banner red"><div>{errs.map(e => <div key={e}>{e}</div>)}</div></div>}
      <div className="banner blue"><div><b>Cómo se calcula (por km del viaje):</b> mantenimiento = $/km × km · neumáticos = costo del juego ÷ vida útil × km · depreciación económica = (valor base − residual) ÷ vida útil × km.{est ? <> Con estos parámetros, 1.000 km estiman <b>{money(est.total)}</b> (mantenimiento {money(est.maintenance)}, neumáticos {money(est.tires)}, depreciación {money(est.depreciation)}).</> : <> Completá todos los parámetros para estimar.</>} Son estimaciones económicas, no una medición del desgaste ni un diagnóstico mecánico.</div></div></div></section>
    <section className="panel"><div className="panel-h"><h2>Costos operativos mensuales asignados por km</h2><span className="muted small">Total {money(fixed.reduce((a, f) => a + (f.amount || 0), 0))} por mes</span></div>
      <div className="table-wrap"><table className="tbl"><tbody>{fixed.map((f, i) => <tr key={f.id}><td><input type="text" aria-label="Concepto" value={f.label} disabled={!canEdit} onChange={e => setFixed(fixed.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} /></td><td style={{ width: 190 }}><input type="number" aria-label="Importe mensual" style={{ textAlign: 'right' }} value={f.amount} disabled={!canEdit} onChange={e => setFixed(fixed.map((x, j) => j === i ? { ...x, amount: Number(e.target.value) } : x))} /></td><td style={{ width: 50 }}><button className="btn icon ghost danger" aria-label="Quitar" disabled={!canEdit} onClick={() => setFixed(fixed.filter((_, j) => j !== i))}><Trash2 size={16} /></button></td></tr>)}</tbody></table></div>
      <div className="panel-b row between"><button className="btn sm" disabled={!canEdit} onClick={() => setFixed([...fixed, { id: uid(), label: 'Nuevo costo', amount: 0 }])}><Plus size={14} /> Agregar costo</button><span className="muted small">Regla: cada mes se reparte entre los viajes finalizados del camión según sus km. Cada importe se cuenta una sola vez.</span></div></section>
    <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary" disabled={!canEdit || !dirty || errs.length > 0 || fixed.some(f => !(f.amount >= 0))} onClick={() => run(() => api('PUT', `/api/trucks/${truck.id}`, { ...truck, params: p, monthlyFixedCosts: fixed }), 'Parámetros guardados')}>Guardar parámetros</button></div></div>;
}

function Maintenance({ truck, odo, today }: { truck: Truck; odo: number | null; today: string }) {
  const { run, canEdit, money } = useApp(); const [plan, setPlan] = useState<ServicePlan | null>(null); const [done, setDone] = useState(false);
  const save = (t: Truck, msg: string) => run(() => api('PUT', `/api/trucks/${truck.id}`, t), msg);
  return <div className="stack">
    <div className="banner blue"><div>Los intervalos los define la empresa o surgen de indicaciones registradas del fabricante o del taller. RUMBO no propone intervalos universales: cada servicio indica su origen.</div></div>
    <section className="panel"><div className="panel-h"><h2>Próximos servicios</h2><div className="row"><button className="btn sm" disabled={!canEdit} onClick={() => setDone(true)}><Wrench size={14} /> Registrar servicio realizado</button><button className="btn sm primary" disabled={!canEdit} onClick={() => setPlan({ id: uid(), name: '', intervalKm: null, intervalDays: null, lastKm: odo, lastDate: today, alertBeforeKm: null, alertBeforeDays: null, source: '' })}><Plus size={14} /> Agregar servicio</button></div></div>
      <div className="table-wrap"><table className="tbl"><thead><tr><th>Servicio</th><th>Intervalo</th><th className="num">Próximo</th><th className="num">Faltan</th><th>Estado</th><th className="hide-sm">Origen del intervalo</th><th></th></tr></thead><tbody>
        {truck.servicePlans.map(p => { const s = serviceStatus(p, odo, today); return <tr key={p.id}><td>{p.name}</td><td className="small">{[p.intervalKm ? `${fmtNum(p.intervalKm)} km` : '', p.intervalDays ? `${p.intervalDays} días` : ''].filter(Boolean).join(' o ') || '—'}</td>
          <td className="num small">{[s.nextKm != null ? fmtKm(s.nextKm) : '', s.nextDate ? fmtDate(s.nextDate) : ''].filter(Boolean).join(' / ') || NA}</td>
          <td className="num small">{[s.remainingKm != null ? `${fmtNum(s.remainingKm)} km` : '', s.remainingDays != null ? `${s.remainingDays} d` : ''].filter(Boolean).join(' / ') || NA}</td>
          <td><span className={`chip ${SVC[s.status].c}`}>{SVC[s.status].l}</span></td><td className="hide-sm small muted wrap">{p.source || '—'}</td>
          <td className="num"><button className="btn sm ghost" aria-label="Editar servicio" disabled={!canEdit} onClick={() => setPlan(p)}><Pencil size={15} /></button></td></tr>; })}
        {!truck.servicePlans.length && <tr><td colSpan={7} className="empty">Sin servicios configurados. Agregá uno con el intervalo que defina la empresa o el fabricante.</td></tr>}</tbody></table></div></section>
    <section className="panel"><div className="panel-h"><h2>Historial de servicios</h2></div><div className="table-wrap"><table className="tbl"><thead><tr><th>Fecha</th><th>Servicio</th><th className="num">Km</th><th className="num">Costo</th><th>Nota</th></tr></thead><tbody>
      {[...truck.serviceHistory].sort((a, b) => b.date.localeCompare(a.date)).map(h => <tr key={h.id}><td>{fmtDate(h.date)}</td><td>{h.name}</td><td className="num">{h.km != null ? fmtNum(h.km) : '—'}</td><td className="num">{h.cost != null ? money(h.cost) : '—'}</td><td>{h.note || '—'}</td></tr>)}
      {!truck.serviceHistory.length && <tr><td colSpan={5} className="empty">Sin servicios registrados.</td></tr>}</tbody></table></div></section>
    {plan && <PlanModal plan={plan} onClose={() => setPlan(null)} onSave={p => { const exists = truck.servicePlans.some(x => x.id === p.id); save({ ...truck, servicePlans: exists ? truck.servicePlans.map(x => x.id === p.id ? p : x) : [...truck.servicePlans, p] }, 'Servicio guardado'); setPlan(null); }} onDelete={truck.servicePlans.some(x => x.id === plan.id) ? () => { save({ ...truck, servicePlans: truck.servicePlans.filter(x => x.id !== plan.id) }, 'Servicio eliminado'); setPlan(null); } : undefined} />}
    {done && <DoneModal truck={truck} odo={odo} today={today} onClose={() => setDone(false)} onSave={t => { save(t, 'Servicio registrado'); setDone(false); }} />}
  </div>;
}

function PlanModal({ plan, onClose, onSave, onDelete }: { plan: ServicePlan; onClose: () => void; onSave: (p: ServicePlan) => void; onDelete?: () => void }) {
  const [p, setP] = useState(plan); const bad = !p.name.trim() || (p.intervalKm == null && p.intervalDays == null) || !p.source.trim();
  return <Modal title={plan.name ? 'Editar servicio' : 'Agregar servicio'} onClose={onClose} footer={<>{onDelete && <button className="btn danger" onClick={onDelete} style={{ marginRight: 'auto' }}>Eliminar</button>}<button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={bad} onClick={() => onSave(p)}>Guardar</button></>}>
    <div className="grid g2"><Field label="Servicio" className=""><input type="text" value={p.name} onChange={e => setP({ ...p, name: e.target.value })} /></Field>
      <Field label="Origen del intervalo" hint="Ej.: Configurado por la empresa, Indicación del manual"><input type="text" value={p.source} onChange={e => setP({ ...p, source: e.target.value })} /></Field>
      <NumField label="Intervalo (km)" value={p.intervalKm} onChange={v => setP({ ...p, intervalKm: v })} /><NumField label="Intervalo (días)" value={p.intervalDays} onChange={v => setP({ ...p, intervalDays: v })} />
      <NumField label="Último servicio (km)" value={p.lastKm} onChange={v => setP({ ...p, lastKm: v })} /><Field label="Último servicio (fecha)"><input type="date" value={p.lastDate ?? ''} onChange={e => setP({ ...p, lastDate: e.target.value || null })} /></Field>
      <NumField label="Avisar con (km de anticipación)" value={p.alertBeforeKm} onChange={v => setP({ ...p, alertBeforeKm: v })} /><NumField label="Avisar con (días de anticipación)" value={p.alertBeforeDays} onChange={v => setP({ ...p, alertBeforeDays: v })} /></div>
    <p className="muted small">Indicá al menos un intervalo (km o días) y su origen.</p></Modal>;
}

function DoneModal({ truck, odo, today, onClose, onSave }: { truck: Truck; odo: number | null; today: string; onClose: () => void; onSave: (t: Truck) => void }) {
  const [planId, setPlanId] = useState(truck.servicePlans[0]?.id ?? ''); const [name, setName] = useState(truck.servicePlans[0]?.name ?? ''); const [date, setDate] = useState(today); const [km, setKm] = useState<number | null>(odo); const [cost, setCost] = useState<number | null>(null); const [note, setNote] = useState('');
  const save = () => onSave({ ...truck, serviceHistory: [...truck.serviceHistory, { id: uid(), name, date, km, cost, note: note || undefined }],
    servicePlans: truck.servicePlans.map(p => p.id === planId ? { ...p, lastKm: km, lastDate: date } : p), odometerKm: km != null && (truck.odometerKm == null || km > truck.odometerKm) ? km : truck.odometerKm, odometerDate: km != null ? date : truck.odometerDate });
  return <Modal title="Registrar servicio realizado" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!name.trim()} onClick={save}>Guardar</button></>}>
    <div className="grid g2"><Field label="Servicio programado (opcional)"><select value={planId} onChange={e => { setPlanId(e.target.value); const p = truck.servicePlans.find(x => x.id === e.target.value); if (p) setName(p.name); }}><option value="">— Otro servicio —</option>{truck.servicePlans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="Descripción"><input type="text" value={name} onChange={e => setName(e.target.value)} /></Field><Field label="Fecha"><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field><NumField label="Kilometraje" value={km} onChange={setKm} /><NumField label="Costo" prefix="$" value={cost} onChange={setCost} /><Field label="Nota"><input type="text" value={note} onChange={e => setNote(e.target.value)} /></Field></div>
    <p className="muted small">Si elegís un servicio programado, su último servicio se actualiza con esta fecha y kilometraje.</p></Modal>;
}
