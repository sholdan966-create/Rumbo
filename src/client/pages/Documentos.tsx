import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useApp } from '../store';
import { Route, href, navigate } from '../router';
import { Field, Kpi, TripChip } from '../components/ui';
import { DocumentsPanel, FilesPanel, FileViewer, HistoryPanel } from '../components/Attach';
import { DOC_STATUS, DocStatus, documentRows } from '../../shared/documents';
import { fmtDate } from '../../shared/format';
import { routeKey } from '../../shared/calc';
import { FileMeta } from '../../shared/types';

export function Documentos({ route }: { route: Route }) {
  if (route.path[1] === 'chofer' && route.path[2]) return <FichaChofer id={route.path[2]} />;
  if (route.path[1] === 'empresa') return <FichaEmpresa />;
  return <Central route={route} />;
}

const ownerLink = (t: string, id: string) => t === 'vehiculo' ? href(`flota/${id}`, { tab: 'documentos' }) : t === 'chofer' ? href(`documentos/chofer/${id}`) : href('documentos/empresa');

function Central({ route }: { route: Route }) {
  const { data, today } = useApp(); const q = route.query;
  const f = { estado: q.get('estado') ?? '', owner: q.get('owner') ?? '', tipo: q.get('tipo') ?? '', q: q.get('q') ?? '' }; const [view, setView] = useState<FileMeta | null>(null);
  const set = (k: string, v: string) => navigate('documentos', Object.fromEntries(Object.entries({ ...f, [k]: v }).filter(([, x]) => x)));
  const all = documentRows(data, today); const count = (s: DocStatus) => all.filter(r => r.status === s).length;
  const rows = all.filter(r => (!f.estado || r.status === f.estado) && (!f.owner || r.ownerType === f.owner) && (!f.tipo || r.type.id === f.tipo) && (!f.q || `${r.owner} ${r.type.label} ${r.doc?.identifier ?? ''}`.toLowerCase().includes(f.q.toLowerCase())))
    .sort((a, b) => ({ vencido: 0, pendiente: 1, proximo: 2, vigente: 3, sin_vencimiento: 4 } as Record<string, number>)[a.status] - ({ vencido: 0, pendiente: 1, proximo: 2, vigente: 3, sin_vencimiento: 4 } as Record<string, number>)[b.status] || (a.days ?? 9999) - (b.days ?? 9999));
  return (
    <>
      <div className="page-head"><div><h1>Documentos</h1><p>Vista central de la documentación de la empresa, los vehículos y los choferes. Cada documento se carga y se reemplaza desde la ficha de su titular.</p></div></div>
      <div className="kpis" style={{ marginBottom: 16, gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
        <Kpi label="Vencidos" value={count('vencido')} tone={count('vencido') ? 'bad' : undefined} /><Kpi label="Próximos a vencer" value={count('proximo')} tone={count('proximo') ? 'warn' : undefined} sub={`Anticipaciones: ${data.settings.docAlertDays.join(', ')} días`} />
        <Kpi label="Pendientes de cargar" value={count('pendiente')} tone={count('pendiente') ? 'warn' : undefined} sub="Requeridos por la configuración" /><Kpi label="Vigentes" value={count('vigente') + count('sin_vencimiento')} /></div>
      <div className="filters"><Field label="Buscar" className="grow"><input type="search" value={f.q} onChange={e => set('q', e.target.value)} placeholder="Titular, documento o identificador" /></Field>
        <Field label="Estado"><select value={f.estado} onChange={e => set('estado', e.target.value)}><option value="">Todos</option>{(Object.keys(DOC_STATUS) as DocStatus[]).map(s => <option key={s} value={s}>{DOC_STATUS[s].label}</option>)}</select></Field>
        <Field label="Titular"><select value={f.owner} onChange={e => set('owner', e.target.value)}><option value="">Todos</option><option value="empresa">Empresa</option><option value="vehiculo">Vehículos</option><option value="chofer">Choferes</option></select></Field>
        <Field label="Tipo"><select value={f.tipo} onChange={e => set('tipo', e.target.value)}><option value="">Todos</option>{data.settings.documentTypes.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></Field></div>
      <section className="panel"><div className="table-wrap"><table className="tbl"><thead><tr><th>Titular</th><th>Documento</th><th className="hide-sm">Identificador</th><th>Vence</th><th>Estado</th></tr></thead><tbody>
        {rows.map(r => <tr key={r.key} className="click" onClick={() => navigate(ownerLink(r.ownerType, r.ownerId).slice(2).split('?')[0], r.ownerType === 'vehiculo' ? { tab: 'documentos' } : undefined)}>
          <td><a href={ownerLink(r.ownerType, r.ownerId)} onClick={e => e.stopPropagation()}>{r.owner}</a><div className="muted small">{r.ownerType}</div></td><td>{r.type.label}</td><td className="hide-sm">{r.doc?.identifier ?? '—'}</td><td className="nowrap">{r.doc?.expiryDate ? <>{fmtDate(r.doc.expiryDate)}{r.days != null && <div className="muted small">{r.days < 0 ? `hace ${-r.days} d` : `en ${r.days} d`}</div>}</> : '—'}</td>
          <td><span className={`chip ${DOC_STATUS[r.status].cls}`}>{DOC_STATUS[r.status].label}</span></td></tr>)}
        {!rows.length && <tr><td colSpan={5} className="empty">No hay documentos con esos filtros.</td></tr>}</tbody></table></div></section>
      <p className="muted small">Los estados salen de las fechas cargadas y de los requisitos configurados. No indican por sí solos que un vehículo o un chofer estén legalmente habilitados.</p>
      {view && <FileViewer file={view} onClose={() => setView(null)} />}
    </>
  );
}

function FichaChofer({ id }: { id: string }) {
  const { data, calcs, money } = useApp(); const dr = data.drivers.find(x => x.id === id); if (!dr) return <div className="empty">Chofer inexistente.</div>;
  const trips = data.trips.filter(t => t.driverId === id).sort((a, b) => b.id.localeCompare(a.id)).slice(0, 15); const user = data.users.find(u => u.driverId === id);
  return <>
    <a className="back" href={href('documentos')}><ArrowLeft size={16} /> Documentos</a>
    <div className="page-head"><div><h1>{dr.name}</h1><p>Ficha del chofer · acceso al portal móvil: {user ? 'habilitado' : 'sin usuario'}</p></div></div>
    <div className="stack"><DocumentsPanel ownerType="chofer" ownerId={id} title="Documentación del chofer" /><FilesPanel entityType="chofer" entityId={id} title="Otros archivos del chofer" />
      <section className="panel"><div className="panel-h"><h2>Últimos viajes</h2></div><div className="table-wrap"><table className="tbl"><tbody>{trips.map(t => <tr key={t.id} className="click" onClick={() => navigate(`viajes/${t.id}`)}><td><a href={href(`viajes/${t.id}`)}>{t.id}</a></td><td>{routeKey(t)}</td><td><TripChip s={t.status} /></td><td className="num hide-sm">{t.status === 'finalizado' ? money(calcs.get(t.id)!.result) : '—'}</td></tr>)}</tbody></table></div></section>
      <HistoryPanel refId={id} /></div></>;
}
function FichaEmpresa() {
  const { data } = useApp();
  return <><a className="back" href={href('documentos')}><ArrowLeft size={16} /> Documentos</a><div className="page-head"><div><h1>{data.settings.companyName}</h1><p>Documentación de la empresa</p></div></div>
    <div className="stack"><DocumentsPanel ownerType="empresa" ownerId="empresa" title="Documentación de la empresa" /><FilesPanel entityType="empresa" entityId="empresa" title="Otros archivos de la empresa" /></div></>;
}
