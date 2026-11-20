// Ficha de viaje en pantalla (equivalente HTML del PDF). Se usa en la versión estática, donde no se pueden descargar archivos.
import { CompanyData, EXPENSE_CATEGORIES, EXPENSE_LABEL, Trip, TripCalc } from '../../shared/types';
import { invoiceTotals, routeKey } from '../../shared/calc';
import { fmtDate, fmtDateTime, fmtDuration, fmtKm, fmtMoney, fmtNum, fmtPct, NA } from '../../shared/format';

export function TripSheet({ data, trip: t, calc: c, version, provisional, generatedAt, preview }: { data: CompanyData; trip: Trip; calc: TripCalc; version: number; provisional: boolean; generatedAt: string; preview?: boolean }) {
  const s = data.settings; const tz = s.timezone; const $ = (v: number | null, d = 0) => fmtMoney(v, s.currency, d);
  const client = data.clients.find(x => x.id === t.clientId); const driver = data.drivers.find(x => x.id === t.driverId); const truck = data.trucks.find(x => x.id === t.truckId);
  const invs = data.invoices.filter(i => i.lines.some(l => l.tripId === t.id)); const today = generatedAt.slice(0, 10);
  const initials = s.companyName.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return (
    <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 6, padding: 20, maxWidth: 820, margin: '0 auto' }} className="stack">
      {preview && <div className="chip blue" style={{ alignSelf: 'flex-start' }}>VISTA PREVIA · no es una versión guardada</div>}
      <div className="row between" style={{ borderBottom: '2px solid var(--ink)', paddingBottom: 12 }}>
        <div className="row" style={{ flexWrap: 'nowrap' }}><div className="brand-mark" style={{ background: 'var(--nav)', color: '#fff', fontWeight: 700 }}>{initials}</div><div><b>{s.legalName.replace(/\s*\(datos de demostración\)/, '')}</b><div className="muted small">CUIT {s.cuit} · {s.address}</div></div></div>
        <div style={{ textAlign: 'right' }}><h2 style={{ fontSize: 20 }}>Ficha de viaje</h2><div className="muted small">{t.id} · Informe v{version} · {fmtDateTime(generatedAt, tz)}</div>
          <span className={`chip ${provisional ? 'amber' : 'accent'}`}>{provisional ? 'PROVISORIO' : 'COMPLETO'}</span> {data.isDemo && <span className="chip gray">DATOS DE DEMOSTRACIÓN</span>}</div></div>
      <dl className="kv"><dt>Cliente</dt><dd>{client?.name}</dd><dt>Ruta</dt><dd>{routeKey(t)}</dd><dt>Vehículo</dt><dd>{truck?.name} ({truck?.plate})</dd><dt>Chofer</dt><dd>{driver?.name}</dd><dt>Estado</dt><dd>{t.status.replace('_', ' ')}</dd></dl>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
        <div className="kpi"><div className="k-l">Ingreso ({s.profitabilityBasis === 'net' ? 'neto' : 'con IVA'})</div><div className="k-v" style={{ fontSize: 18 }}>{$(c.revenue)}</div></div>
        <div className="kpi"><div className="k-l">Costo total</div><div className="k-v" style={{ fontSize: 18 }}>{$(c.totalCost)}</div></div>
        <div className="kpi"><div className="k-l">Resultado</div><div className="k-v" style={{ fontSize: 18 }}>{$(c.result)}</div></div>
        <div className="kpi"><div className="k-l">Margen</div><div className="k-v" style={{ fontSize: 18 }}>{fmtPct(c.marginPct)}</div><div className="k-s">{provisional ? 'Provisorio' : `Objetivo ${fmtPct(s.marginTarget)}`}</div></div></div>
      <div className="form-section">Recorrido, horarios y kilómetros</div>
      <div className="table-wrap"><table className="tbl"><thead><tr><th></th><th>Previsto</th><th>Real</th></tr></thead><tbody>
        <tr><td>Salida</td><td>{fmtDateTime(t.plannedDeparture, tz)}</td><td>{fmtDateTime(t.actualDeparture, tz)}</td></tr><tr><td>Llegada</td><td>{fmtDateTime(t.plannedArrival, tz)}</td><td>{fmtDateTime(t.actualArrival, tz)}</td></tr>
        <tr><td>Duración</td><td>{fmtDuration(c.plannedDurationMin)}</td><td>{c.durationMin == null ? 'No disponible (faltan horarios reales)' : fmtDuration(c.durationMin)}</td></tr>
        {c.stopsMin != null && <><tr><td>Paradas registradas</td><td></td><td>{fmtDuration(c.stopsMin)}</td></tr><tr><td>Tiempo de conducción</td><td></td><td>{fmtDuration(c.drivingMin)}</td></tr></>}</tbody></table></div>
      <div className="table-wrap"><table className="tbl"><thead><tr><th>Kilómetros</th><th className="num">Con carga</th><th className="num">Vacíos</th><th className="num">Totales</th><th className="num">Odómetro</th></tr></thead><tbody><tr><td>Recorrido</td><td className="num">{fmtKm(t.kmLoaded)}</td><td className="num">{fmtKm(t.kmEmpty)}</td><td className="num">{fmtKm(c.kmTotal)}</td><td className="num">{t.odometerStart != null && t.odometerEnd != null ? `${fmtNum(t.odometerStart)} / ${fmtNum(t.odometerEnd)}` : 'No registrado'}</td></tr></tbody></table></div>
      <div className="form-section">Gastos registrados y costos asignados</div>
      <div className="table-wrap"><table className="tbl"><thead><tr><th>Concepto</th><th className="num">Registrado</th><th className="num">Presupuesto</th></tr></thead><tbody>
        {EXPENSE_CATEGORIES.map(k => <tr key={k}><td>{EXPENSE_LABEL[k]}</td><td className="num">{c.direct[k] == null ? <span className="warn">Pendiente de carga</span> : $(c.direct[k])}</td><td className="num">{t.budget?.[k] != null ? $(t.budget[k]!) : '—'}</td></tr>)}
        <tr><td><b>Costos directos registrados</b></td><td className="num"><b>{$(c.directTotal)}</b></td><td></td></tr><tr><td>Costos operativos asignados ({truck?.name}, por km)</td><td className="num">{c.allocated == null ? NA : $(c.allocated)}</td><td></td></tr><tr><td><b>Costo total</b></td><td className="num"><b>{$(c.totalCost)}</b></td><td></td></tr></tbody></table></div>
      <div className="form-section">Indicadores</div>
      <div className="table-wrap"><table className="tbl"><tbody><tr><td>Costo por km</td><td className="num">{$(c.costPerKm)}</td></tr><tr><td>Ingreso por km</td><td className="num">{$(c.revenuePerKm)}</td></tr></tbody></table></div>
      <div className="form-section">Facturación y cobros</div>
      {invs.length ? <div className="table-wrap"><table className="tbl"><thead><tr><th>Factura</th><th>Vencimiento</th><th className="num">Total</th><th className="num">Cobrado</th><th className="num">Saldo</th></tr></thead><tbody>
        {invs.map(i => { const it = invoiceTotals(i, data.payments, today, s.dueSoonDays); return <tr key={i.id}><td>{i.number}</td><td>{fmtDate(i.dueDate)}</td><td className="num">{$(it.adjusted)}</td><td className="num">{$(it.paid)}</td><td className="num">{$(it.balance)}</td></tr>; })}</tbody></table></div> : <p className="muted" style={{ margin: 0 }}>Este viaje todavía no está facturado.</p>}
      <div className="form-section">Estimaciones de uso del vehículo</div>
      {c.estimates ? <><div className="table-wrap"><table className="tbl"><tbody><tr><td>Mantenimiento</td><td className="num">{$(c.estimates.maintenance)}</td></tr><tr><td>Neumáticos</td><td className="num">{$(c.estimates.tires)}</td></tr><tr><td>Depreciación económica</td><td className="num">{$(c.estimates.depreciation)}</td></tr><tr><td><b>Total estimado</b></td><td className="num"><b>{$(c.estimates.total)}</b></td></tr></tbody></table></div>
        <p className="muted small" style={{ margin: 0 }}>Estimaciones económicas con parámetros configurados; no miden el desgaste físico ni son un diagnóstico mecánico. No están incluidas en el costo total.</p></> : <p className="muted" style={{ margin: 0 }}>No disponible: faltan kilómetros o parámetros válidos.</p>}
      <div className="form-section">Observaciones y datos faltantes</div>
      {t.notes && <p style={{ margin: 0 }}>{t.notes}</p>}
      {c.missing.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{c.missing.map(m => <li key={m} className="warn">{m}</li>)}</ul> : <p className="muted" style={{ margin: 0 }}>{t.status === 'finalizado' ? 'Sin datos pendientes.' : 'El viaje no está finalizado: los resultados se calculan al finalizarlo.'}</p>}
    </div>
  );
}
