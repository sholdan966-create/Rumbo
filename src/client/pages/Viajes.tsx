import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Download, FileSpreadsheet, Plus, Search, X, AlertTriangle, FileCheck2 } from 'lucide-react';
import { useApp } from '../store';
import { Route, href, navigate } from '../router';
import { Field, ReportChip, TripChip, downloadCsv } from '../components/ui';
import { TripDetail } from '../components/TripDetail';
import { TripForm, blankTrip } from '../components/TripForm';
import { ImportModal } from '../components/ImportModal';
import { filterTrips, monthName, monthsOf, nameOf, routesOf } from '../lib';
import { operationInstant, routeKey } from '../../shared/calc';
import { fmtDate, fmtKm, fmtNum, fmtPct } from '../../shared/format';
import { localDate } from '../../shared/time';
import { Trip } from '../../shared/types';
import { budgetVsActual } from '../../shared/budget';

type SortKey = 'id' | 'date' | 'client' | 'route' | 'truck' | 'status' | 'km' | 'revenue' | 'cost' | 'result' | 'margin';
const PAGE = 25;

export function Viajes({ route }: { route: Route }) {
  const { data, calcs, money, tz, canEdit } = useApp();
  const id = route.path[1];
  const q = route.query;
  const [search, setSearch] = useState(q.get('q') ?? '');
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'date', dir: -1 });
  const [page, setPage] = useState(0);
  const [form, setForm] = useState<Trip | null>(null); const [importing, setImporting] = useState(false);
  const f = { review: q.get('revision') === '1', deviation: q.get('desvios') === '1', month: q.get('month') ?? '', truck: q.get('truck') ?? '', route: q.get('route') ?? '', client: q.get('client') ?? '', status: q.get('estado') ?? '', pending: q.get('pendientes') === '1' };
  const set = (k: string, v: string) => { const cur: Record<string, string> = { revision: f.review ? '1' : '', desvios: f.deviation ? '1' : '', month: f.month, truck: f.truck, route: f.route, client: f.client, estado: f.status, pendientes: f.pending ? '1' : '', [k]: v }; navigate('viajes', Object.fromEntries(Object.entries(cur).filter(([, x]) => x))); setPage(0); };
  useEffect(() => { if (q.get('nuevo') === '1' && !id) { openNew(); navigate('viajes'); } /* eslint-disable-next-line */ }, [q.get('nuevo')]);
  const openNew = () => setForm(blankTrip('V-…', data, tz));

  const list = useMemo(() => filterTrips(data, calcs, { month: f.month || undefined, truck: f.truck || undefined, route: f.route || undefined, client: f.client || undefined, status: f.status || undefined, q: search, pending: f.pending }), [data, calcs, f.month, f.truck, f.route, f.client, f.status, f.pending, search]);
  const list2 = useMemo(() => list.filter(t => (!f.review || t.expenses.some(e => e.status === 'pendiente_revision')) && (!f.deviation || (() => { const b = budgetVsActual(t, calcs.get(t.id)!); return !!b && b.reliable && b.totalCost.pct != null && Math.abs(b.totalCost.pct) >= data.settings.deviationAlertPct; })())), [list, f.review, f.deviation, calcs, data.settings.deviationAlertPct]);
  const sorted = useMemo(() => {
    const val = (t: Trip): string | number => { const c = calcs.get(t.id)!; switch (sort.k) {
      case 'id': return t.id; case 'date': return operationInstant(t) ?? ''; case 'client': return nameOf.client(data, t.clientId); case 'route': return routeKey(t); case 'truck': return nameOf.truck(data, t.truckId);
      case 'status': return t.status; case 'km': return c.kmTotal ?? -1; case 'revenue': return c.revenue ?? -1; case 'cost': return c.totalCost ?? -1; case 'result': return c.result ?? -Infinity; case 'margin': return c.marginPct ?? -Infinity; } };
    return [...list2].sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'number' ? x - (y as number) : String(x).localeCompare(String(y), 'es', { numeric: true })) * sort.dir; });
  }, [list2, sort, calcs, data]);
  if (id) return <TripDetail id={id} tab={(q.get('tab') as any) ?? 'resumen'} />;
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE)); const cur = Math.min(page, pages - 1); const rows = sorted.slice(cur * PAGE, cur * PAGE + PAGE);
  const th = (k: SortKey, label: string, cls = '') => <th className={`sortable ${cls}`} onClick={() => setSort(s => ({ k, dir: s.k === k ? (-s.dir as 1 | -1) : 1 }))} aria-sort={sort.k === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>{label}{sort.k === k && (sort.dir === 1 ? <ArrowUp size={13} style={{ verticalAlign: -1, marginLeft: 3 }} /> : <ArrowDown size={13} style={{ verticalAlign: -1, marginLeft: 3 }} />)}</th>;
  const active = !!(f.review || f.deviation || f.month || f.truck || f.route || f.client || f.status || f.pending || search);
  const exportCsv = () => downloadCsv(`viajes_${localDate(new Date(), tz)}.csv`, [['id', 'fecha_salida', 'cliente', 'ruta', 'camion', 'chofer', 'estado', 'km_totales', 'ingreso', 'costo_total', 'resultado', 'margen_pct', 'datos_completos'],
    ...sorted.map(t => { const c = calcs.get(t.id)!; return [t.id, operationInstant(t) ? localDate(operationInstant(t)!, tz) : '', nameOf.client(data, t.clientId), routeKey(t), nameOf.truck(data, t.truckId), nameOf.driver(data, t.driverId), t.status, c.kmTotal, c.revenue, c.totalCost, c.result, c.marginPct?.toFixed(2), t.status === 'finalizado' ? (c.complete ? 'si' : 'no') : '']; })]);

  return (
    <>
      <div className="page-head"><div><h1>Viajes</h1><p>Registro de viajes, costos y resultados. Clic en una fila para ver el detalle.</p></div>
        <div className="page-actions"><button className="btn" onClick={exportCsv}><Download size={16} /> Exportar CSV</button><button className="btn" disabled={!canEdit} onClick={() => setImporting(true)}><FileSpreadsheet size={16} /> Importar</button><button className="btn" disabled={!canEdit} onClick={() => navigate('cotizaciones/nueva')}>Cotizar viaje</button><button className="btn primary" disabled={!canEdit} onClick={openNew}><Plus size={16} /> Nuevo viaje</button></div></div>
      <div className="filters" role="search">
        <Field label="Buscar" className="grow"><div className="input-affix"><span><Search size={16} /></span><input type="search" value={search} placeholder="Viaje, cliente, chofer, patente…" onChange={e => { setSearch(e.target.value); setPage(0); }} /></div></Field>
        <Field label="Estado"><select value={f.status} onChange={e => set('estado', e.target.value)}><option value="">Todos</option><option value="planificado">Planificado</option><option value="en_curso">En curso</option><option value="finalizado">Finalizado</option><option value="cancelado">Cancelado</option></select></Field>
        <Field label="Mes de salida"><select value={f.month} onChange={e => set('month', e.target.value)}><option value="">Todos</option>{monthsOf(data).map(m => <option key={m} value={m}>{monthName(m)}</option>)}</select></Field>
        <Field label="Camión"><select value={f.truck} onChange={e => set('truck', e.target.value)}><option value="">Todos</option>{data.trucks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
        <Field label="Ruta"><select value={f.route} onChange={e => set('route', e.target.value)}><option value="">Todas</option>{routesOf(data).map(r => <option key={r}>{r}</option>)}</select></Field>
        <Field label="Cliente"><select value={f.client} onChange={e => set('client', e.target.value)}><option value="">Todos</option>{data.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <label className="check" style={{ minHeight: 40 }}><input type="checkbox" checked={f.pending} onChange={e => set('pendientes', e.target.checked ? '1' : '')} /> Solo con datos pendientes</label>
        <label className="check" style={{ minHeight: 40 }}><input type="checkbox" checked={f.review} onChange={e => set('revision', e.target.checked ? '1' : '')} /> Gastos por revisar</label>
        <label className="check" style={{ minHeight: 40 }}><input type="checkbox" checked={f.deviation} onChange={e => set('desvios', e.target.checked ? '1' : '')} /> Con desvío importante</label>
        {active && <button className="btn sm ghost" onClick={() => { setSearch(''); navigate('viajes'); }}><X size={14} /> Limpiar</button>}
      </div>
      <section className="panel">
        <div className="table-wrap"><table className="tbl"><thead><tr>
          {th('id', 'Viaje')}{th('date', 'Salida')}{th('client', 'Cliente', 'hide-sm')}{th('route', 'Ruta y camión')}{th('status', 'Estado')}{th('km', 'Km', 'num hide-md')}{th('revenue', 'Ingreso', 'num hide-sm')}{th('result', 'Resultado', 'num')}{th('margin', 'Margen', 'num')}<th className="hide-md">Datos</th><th className="hide-md">Ficha PDF</th></tr></thead><tbody>
          {rows.map(t => { const c = calcs.get(t.id)!; const latest = data.tripReports.filter(r => r.tripId === t.id).sort((a, b) => b.version - a.version)[0]; const fin = t.status === 'finalizado'; return (
            <tr key={t.id} className="click" onClick={() => navigate(`viajes/${t.id}`)}>
              <td className="id"><a href={href(`viajes/${t.id}`)} onClick={e => e.stopPropagation()}>{t.id}</a></td>
              <td className="nowrap">{operationInstant(t) ? fmtDate(localDate(operationInstant(t)!, tz)) : '—'}</td>
              <td className="hide-sm trunc" title={nameOf.client(data, t.clientId)}>{nameOf.client(data, t.clientId)}</td><td className="nowrap">{routeKey(t)}<div className="small muted">{nameOf.truck(data, t.truckId)}</div></td><td><TripChip s={t.status} /></td>
              <td className="num hide-md">{c.kmTotal != null ? fmtNum(c.kmTotal) : '—'}</td><td className="num hide-sm">{money(c.revenue)}</td>              <td className={`num ${c.result != null && c.result < 0 ? 'neg' : ''}`}>{fin ? money(c.result) : '—'}</td>
              <td className={`num ${c.marginPct != null && c.marginPct < data.settings.marginTarget ? 'warn' : ''}`}>{fin ? fmtPct(c.marginPct) : '—'}</td>
              <td className="hide-md">{fin ? (c.complete ? <span className="chip accent"><FileCheck2 size={14} /> Completo</span> : <span className="chip amber" title={c.missing.join(' · ')}><AlertTriangle size={14} /> Pendiente</span>) : '—'}</td>
              <td className="hide-md">{latest ? <ReportChip s={latest.status} /> : <span className="muted">—</span>}</td></tr>); })}
          {!rows.length && <tr><td colSpan={11} className="empty">No hay viajes con esos filtros.</td></tr>}</tbody></table></div>
        <div className="pager"><span className="muted small">{sorted.length} viajes · {fmtKm(sorted.reduce((a, t) => a + (calcs.get(t.id)!.kmTotal ?? 0), 0))}</span>
          <div className="row"><button className="btn sm" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Anterior</button><span className="small">Página {cur + 1} de {pages}</span><button className="btn sm" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Siguiente</button></div></div>
      </section>
      {form && <TripForm trip={form} isNew onClose={() => setForm(null)} />}
      {importing && <ImportModal onClose={() => setImporting(false)} />}
    </>
  );
}
