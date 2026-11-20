import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2, X } from 'lucide-react';
import { useApp } from '../store';
import { api } from '../api';
import { Route, href, navigate } from '../router';
import { Field, InvChip, Kpi, Tabs } from '../components/ui';
import { AdjustmentModal, InvoiceModal, PaymentModal } from '../components/BillingModals';
import { invoiceTotals, routeKey } from '../../shared/calc';
import { daysBetween } from '../../shared/time';
import { fmtDate } from '../../shared/format';
import { Invoice } from '../../shared/types';
import { nameOf } from '../lib';

export function Cobros({ route }: { route: Route }) {
  const { data, calcs, money, today, canEdit, run, ask } = useApp(); const s = data.settings;
  const tab = route.query.get('tab') === 'sin-facturar' ? 'sin-facturar' : 'facturas';
  const f = { client: route.query.get('client') ?? '', estado: route.query.get('estado') ?? '', from: route.query.get('desde') ?? '', to: route.query.get('hasta') ?? '', q: route.query.get('q') ?? '' };
  const set = (k: string, v: string) => navigate('cobros', Object.fromEntries(Object.entries({ client: f.client, estado: f.estado, desde: f.from, hasta: f.to, q: f.q, [k]: v }).filter(([, x]) => x)));
  const [open, setOpen] = useState<string | null>(null);
  const [pay, setPay] = useState<Invoice | null>(null); const [adj, setAdj] = useState<Invoice | null>(null); const [newInv, setNewInv] = useState(false);

  const all = useMemo(() => data.invoices.map(i => ({ i, t: invoiceTotals(i, data.payments, today, s.dueSoonDays) })), [data, today, s.dueSoonDays]);
  const sum = (st: string) => all.filter(x => x.t.status === st).reduce((a, x) => a + x.t.balance, 0);
  const month = today.slice(0, 7); const collected = data.payments.filter(p => p.date.startsWith(month)).reduce((a, p) => a + p.amount, 0);
  const rows = all.filter(({ i, t }) => {
    if (f.client && i.clientId !== f.client) return false;
    if (f.estado === 'parcial' ? !t.partial : f.estado && t.status !== f.estado) return false;
    if (f.from && i.dueDate < f.from) return false; if (f.to && i.dueDate > f.to) return false;
    if (f.q && !i.number.toLowerCase().includes(f.q.toLowerCase())) return false; return true;
  }).sort((a, b) => { const pa = a.t.balance > 0.005, pb = b.t.balance > 0.005; if (pa !== pb) return pa ? -1 : 1; return pa ? a.i.dueDate.localeCompare(b.i.dueDate) : b.i.dueDate.localeCompare(a.i.dueDate); }); // abiertas primero (las vencidas arriba), luego pagadas
  const unbilled = data.trips.filter(t => t.status === 'finalizado' && t.serviceValue != null && t.serviceValue > 0 && t.serviceValue - calcs.get(t.id)!.invoicedNet > 0.5);
  const active = Object.values(f).some(Boolean);

  return (
    <>
      <div className="page-head"><div><h1>Cobros</h1><p>Facturas, pagos y saldos. Los saldos incluyen IVA; el cobro se mide por <b>fecha de factura, vencimiento y pago</b>.</p></div>
        <div className="page-actions"><button className="btn primary" disabled={!canEdit} onClick={() => setNewInv(true)}><Plus size={16} /> Nueva factura</button></div></div>
      <div className="kpis" style={{ marginBottom: 16, gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
        <Kpi label="Pendiente total" value={money(all.reduce((a, x) => a + x.t.balance, 0))} sub={`${all.filter(x => x.t.balance > 0.005).length} facturas abiertas`} />
        <Kpi label="Vencido" value={money(sum('vencida'))} tone={sum('vencida') > 0 ? 'bad' : undefined} sub="Vencimiento anterior a hoy" />
        <Kpi label="Por vencer" value={money(sum('por_vencer'))} sub={`Próximos ${s.dueSoonDays} días`} />
        <Kpi label="Vigente" value={money(sum('vigente'))} sub="Más adelante" />
        <Kpi label="Cobrado este mes" value={money(collected)} sub="Por fecha de cobro" />
      </div>
      <Tabs value={tab} onChange={t => navigate('cobros', t === 'facturas' ? {} : { tab: t })} tabs={[{ id: 'facturas', label: `Facturas (${data.invoices.length})` }, { id: 'sin-facturar', label: `Viajes sin facturar (${unbilled.length})` }]} />
      {tab === 'facturas' && <>
        <div className="filters">
          <Field label="Cliente"><select value={f.client} onChange={e => set('client', e.target.value)}><option value="">Todos</option>{data.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Estado"><select value={f.estado} onChange={e => set('estado', e.target.value)}><option value="">Todos</option><option value="vencida">Vencidas</option><option value="por_vencer">Por vencer</option><option value="vigente">Vigentes</option><option value="parcial">Con cobro parcial</option><option value="pagada">Pagadas</option></select></Field>
          <Field label="Vence desde"><input type="date" value={f.from} onChange={e => set('desde', e.target.value)} /></Field><Field label="Vence hasta"><input type="date" value={f.to} onChange={e => set('hasta', e.target.value)} /></Field>
          <Field label="N.º de factura"><input type="search" value={f.q} onChange={e => set('q', e.target.value)} /></Field>
          {active && <button className="btn sm ghost" onClick={() => navigate('cobros')}><X size={14} /> Limpiar</button>}</div>
        <section className="panel"><div className="table-wrap"><table className="tbl"><thead><tr><th></th><th>Factura</th><th>Cliente</th><th className="hide-sm">Emisión</th><th>Vencimiento</th><th className="num">Total ajustado</th><th className="num hide-sm">Cobrado</th><th className="num">Saldo</th><th>Estado</th></tr></thead><tbody>
          {rows.map(({ i, t }) => { const isOpen = open === i.id; const dd = daysBetween(today, i.dueDate); return (
            <Fragment key={i.id}>
              <tr className="click" onClick={() => setOpen(isOpen ? null : i.id)}>
                <td style={{ width: 28 }}>{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td><td className="id">{i.number}</td><td>{nameOf.client(data, i.clientId)}</td><td className="hide-sm">{fmtDate(i.issueDate)}</td>
                <td className="nowrap">{fmtDate(i.dueDate)}{t.balance > 0.005 && <div className={`small ${dd < 0 ? 'neg' : 'muted'}`}>{dd < 0 ? `Vencida hace ${-dd} d` : dd === 0 ? 'Vence hoy' : `En ${dd} d`}</div>}</td>
                <td className="num">{money(t.adjusted)}</td><td className="num hide-sm">{money(t.paid)}</td><td className={`num ${t.status === 'vencida' ? 'neg' : ''}`}>{money(t.balance)}</td><td><InvChip t={t} /></td></tr>
              {isOpen && <tr><td></td><td colSpan={8} style={{ background: '#FAFBFC' }}>
                <div className="grid g2" style={{ padding: '6px 0' }}>
                  <div><b>Viajes facturados</b><ul style={{ margin: '6px 0', paddingLeft: 18 }}>{i.lines.map(l => { const tr = data.trips.find(x => x.id === l.tripId); return <li key={l.tripId}><a href={href(`viajes/${l.tripId}`)}>{l.tripId}</a> {tr ? routeKey(tr) : ''} · neto {money(l.net)}</li>; })}</ul>
                    <div className="muted small">Neto {money(t.net)} · IVA {money(t.iva)} · Total {money(t.total)}{t.adjustments !== 0 && <> · Ajustes {money(t.adjustments)}</>}</div>
                    {i.adjustments.map(a => <div key={a.id} className="small muted">{fmtDate(a.date)} · {a.reason}: {money(a.amount)}</div>)}</div>
                  <div><b>Cobros</b>{data.payments.filter(p => p.invoiceId === i.id).map(p => <div key={p.id} className="row between small" style={{ padding: '4px 0', flexWrap: 'nowrap' }}><span>{fmtDate(p.date)} · {p.method}{p.reference ? ` · ${p.reference}` : ''}</span><span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}><b className="num">{money(p.amount, 2)}</b>{canEdit && <button className="btn icon ghost danger" style={{ width: 30, minHeight: 30 }} aria-label="Eliminar cobro" onClick={async e => { e.stopPropagation(); if (await ask('¿Eliminar este cobro?', 'Eliminar')) run(() => api('DELETE', `/api/payments/${p.id}`), 'Cobro eliminado'); }}><Trash2 size={14} /></button>}</span></div>)}
                    {!data.payments.some(p => p.invoiceId === i.id) && <div className="muted small">Sin cobros registrados.</div>}
                    <div className="row" style={{ marginTop: 10 }}>{canEdit && t.balance > 0.005 && <button className="btn sm primary" onClick={() => setPay(i)}>Registrar cobro</button>}{canEdit && t.balance > 0.005 && <button className="btn sm" onClick={() => setAdj(i)}>Nota de crédito</button>}</div></div></div></td></tr>}
            </Fragment>); })}
          {!rows.length && <tr><td colSpan={9} className="empty">No hay facturas con esos filtros.</td></tr>}</tbody>
          <tfoot><tr><td></td><td colSpan={4}>{rows.length} facturas</td><td className="num">{money(rows.reduce((a, x) => a + x.t.adjusted, 0))}</td><td className="num hide-sm">{money(rows.reduce((a, x) => a + x.t.paid, 0))}</td><td className="num">{money(rows.reduce((a, x) => a + x.t.balance, 0))}</td><td></td></tr></tfoot></table></div></section></>}
      {tab === 'sin-facturar' && <section className="panel"><div className="panel-h"><h2>Viajes finalizados con importe sin facturar</h2></div><div className="table-wrap"><table className="tbl"><thead><tr><th>Viaje</th><th>Cliente</th><th>Ruta</th><th className="num">Neto a facturar</th></tr></thead><tbody>
        {unbilled.map(t => <tr key={t.id} className="click" onClick={() => navigate(`viajes/${t.id}`)}><td><a href={href(`viajes/${t.id}`)}>{t.id}</a></td><td>{nameOf.client(data, t.clientId)}</td><td>{routeKey(t)}</td><td className="num">{money(t.serviceValue! - calcs.get(t.id)!.invoicedNet)}</td></tr>)}
        {!unbilled.length && <tr><td colSpan={4} className="empty">Todos los viajes finalizados están facturados.</td></tr>}</tbody></table></div>
        <div className="pager"><span className="muted small">{unbilled.length} viajes · {money(unbilled.reduce((a, t) => a + t.serviceValue! - calcs.get(t.id)!.invoicedNet, 0))} netos</span>{canEdit && <button className="btn sm primary" onClick={() => setNewInv(true)}>Crear factura</button>}</div></section>}
      {pay && <PaymentModal invoice={pay} onClose={() => setPay(null)} />}{adj && <AdjustmentModal invoice={adj} onClose={() => setAdj(null)} />}{newInv && <InvoiceModal onClose={() => setNewInv(false)} />}
    </>
  );
}
