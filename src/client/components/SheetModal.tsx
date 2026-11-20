import { useApp } from '../store';
import { snapshots } from '../static/backend';
import { TripSheet } from './TripSheet';
import { MonthlyBody } from '../pages/Informes';
import { buildMonthlyFigures, computeTrips, monthlyMissing, tripMonth, hashString } from '../../shared/calc';
import { buildAnalysis } from '../../shared/analysis';
import { MonthlyReport } from '../../shared/types';
import { quoteCalc } from '../../shared/quote';
import { clientAccount } from '../../shared/account';
import { invoiceTotals, EPS } from '../../shared/calc';
import { daysBetween } from '../../shared/time';
import { fmtDate, fmtKm } from '../../shared/format';

/** Contenido de la "vista previa PDF" en la versión estática: la misma información, en pantalla. */
export function SheetBody({ src }: { src: string }) {
  const { data, tz, money } = useApp(); const now = new Date();
  let m: RegExpExecArray | null;
  if ((m = /^\/api\/reports\/trip\/([^/?]+)\/file/.exec(src))) {
    const snap = snapshots.get(m[1]); const rep = data.tripReports.find(r => r.id === m![1]);
    if (!snap || !rep) return <div className="empty">La ficha no está disponible.</div>;
    return <TripSheet data={snap.data} trip={snap.trip} calc={snap.calc} version={snap.version} provisional={snap.provisional} generatedAt={rep.generatedAt ?? now.toISOString()} />;
  }
  if ((m = /^\/api\/trips\/([^/?]+)\/preview\.pdf/.exec(src))) {
    const trip = data.trips.find(t => t.id === decodeURIComponent(m![1])); if (!trip) return <div className="empty">Viaje inexistente.</div>;
    const calc = computeTrips({ settings: data.settings, trucks: data.trucks, trips: data.trips, invoices: data.invoices, payments: data.payments, now }).get(trip.id)!;
    const version = Math.max(0, ...data.tripReports.filter(r => r.tripId === trip.id).map(r => r.version)) + 1;
    return <TripSheet data={data} trip={trip} calc={calc} version={version} provisional={trip.status !== 'finalizado' || !calc.complete} generatedAt={now.toISOString()} preview />;
  }
  if ((m = /^\/api\/quotes\/([^/?]+)\/pdf/.exec(src))) {
    const q = data.quotes.find(x => x.id === m![1]); if (!q) return <div className="empty">Cotización inexistente.</div>; const c = quoteCalc(q); const cl = data.clients.find(x => x.id === q.clientId); const truck = data.trucks.find(t => t.id === q.truckId);
    return <div style={{ background: '#fff', border: '1px solid var(--line)', padding: 24, maxWidth: 760, margin: '0 auto' }} className="stack">
      <div className="row between" style={{ borderBottom: '2px solid var(--ink)', paddingBottom: 10 }}><div><b>{data.settings.legalName.replace(/\s*\(datos de demostración\)/, '')}</b><div className="muted small">CUIT {data.settings.cuit} · {data.settings.address}</div></div><div style={{ textAlign: 'right' }}><h2>Propuesta comercial</h2><div className="muted small">{q.number}</div></div></div>
      <dl className="kv"><dt>Cliente</dt><dd>{cl?.name}</dd><dt>Vigencia</dt><dd>hasta el {fmtDate(q.validUntil)}</dd></dl>
      <div className="form-section">Servicio propuesto</div><dl className="kv"><dt>Ruta</dt><dd>{q.origin} a {q.destination}</dd><dt>Vehículo</dt><dd>{truck?.model ?? (q.vehicleType || 'A confirmar')}</dd><dt>Distancia con carga</dt><dd>{q.kmLoaded != null ? fmtKm(q.kmLoaded) : 'A confirmar'}</dd><dt>Duración estimada</dt><dd>{q.plannedHours != null ? `${q.plannedHours} horas` : 'A confirmar'}</dd></dl>
      <div className="form-section">Precio</div><div className="table-wrap"><table className="tbl"><tbody><tr><td>Servicio de transporte (precio neto)</td><td className="num">{money(c.priceNet, 2)}</td></tr><tr><td>IVA {(q.ivaRate * 100).toFixed(1).replace('.0', '')} %</td><td className="num">{money(c.iva, 2)}</td></tr><tr><td><b>Total con impuestos</b></td><td className="num"><b>{money(c.total, 2)}</b></td></tr></tbody></table></div>
      <div className="form-section">Condiciones comerciales</div><p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{q.terms}</p>{q.notes && <><div className="form-section">Observaciones</div><p style={{ margin: 0 }}>{q.notes}</p></>}
      <p className="muted small" style={{ margin: 0 }}>Documento para el cliente: no incluye costos internos ni márgenes.</p></div>;
  }
  if ((m = /^\/api\/clients\/([^/?]+)\/statement\.pdf\?asof=(\d{4}-\d{2}-\d{2})/.exec(src))) {
    const cl = data.clients.find(x => x.id === m![1]); if (!cl) return <div className="empty">Cliente inexistente.</div>; const asof = m[2]; const acc = clientAccount(data, cl.id, asof, `${asof.slice(0, 7)}-01`, asof);
    const rows = data.invoices.filter(i => i.clientId === cl.id && i.issueDate <= asof).map(i => ({ i, t: invoiceTotals(i, data.payments, asof, data.settings.dueSoonDays) })).filter(x => x.t.balance > EPS);
    return <div style={{ background: '#fff', border: '1px solid var(--line)', padding: 24, maxWidth: 760, margin: '0 auto' }} className="stack"><h2>Estado de cuenta · {cl.name}</h2><div className="muted">Saldos al {fmtDate(asof)}</div>
      <div className="table-wrap"><table className="tbl"><tbody><tr><td>Saldo pendiente</td><td className="num">{money(acc.pending, 2)}</td></tr><tr><td>Vencido</td><td className="num">{money(acc.overdue, 2)}</td></tr></tbody></table></div>
      <div className="table-wrap"><table className="tbl"><thead><tr><th>Tramo</th><th className="num">Saldo</th></tr></thead><tbody>{acc.aging.map(a => <tr key={a.label}><td>{a.label}</td><td className="num">{money(a.amount, 2)}</td></tr>)}</tbody></table></div>
      <div className="table-wrap"><table className="tbl"><thead><tr><th>Factura</th><th>Vence</th><th className="num">Saldo</th><th className="num">Atraso</th></tr></thead><tbody>{rows.map(({ i, t }) => <tr key={i.id}><td>{i.number}</td><td>{fmtDate(i.dueDate)}</td><td className="num">{money(t.balance, 2)}</td><td className="num">{daysBetween(i.dueDate, asof) > 0 ? `${daysBetween(i.dueDate, asof)} d` : '—'}</td></tr>)}</tbody></table></div></div>;
  }
  let rep: MonthlyReport | undefined;
  if ((m = /^\/api\/reports\/monthly\/([^/?]+)\/file/.exec(src)) && m[1] !== 'preview.pdf') rep = data.monthlyReports.find(r => r.id === m![1]);
  else if ((m = /month=(\d{4}-\d{2})/.exec(src))) {
    const month = m[1]; const figures = buildMonthlyFigures(data, month, now); const missing = monthlyMissing(data, figures);
    const open = data.trips.filter(t => (t.status === 'en_curso' || t.status === 'planificado') && tripMonth(t, tz) === month).length;
    rep = { id: 'preview', month, version: 0, status: 'disponible', provisional: figures.current.trips === 0 || figures.incompleteTripIds.length > 0 || open > 0, dataVersion: hashString(month), trigger: 'manual', createdAt: now.toISOString(), generatedAt: now.toISOString(), attempts: 0, error: null, missing, figures, analysis: buildAnalysis(figures, data.settings), fileName: null, fileSize: null };
  }
  if (!rep?.figures || !rep.analysis) return <div className="empty">El informe no está disponible.</div>;
  return <MonthlyBody embedded r={rep} money={money} tz={tz} pdf={false} setPdf={() => undefined} target={data.settings.marginTarget} />;
}
