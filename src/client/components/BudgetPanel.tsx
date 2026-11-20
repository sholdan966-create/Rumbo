import { useState } from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { useApp } from '../store';
import { api } from '../api';
import { href } from '../router';
import { budgetVsActual, Row } from '../../shared/budget';
import { BUDGET_LABEL, BudgetCat, Trip, TripCalc } from '../../shared/types';
import { fmtDateTime, fmtDuration, fmtKm, fmtNum, fmtPct, NA } from '../../shared/format';
import { Field } from './ui';

const TONE = { favorable: ['Favorable', 'accent'], desfavorable: ['Desfavorable', 'red'], sin_confirmar: ['Sin confirmar', 'amber'], neutral: ['—', 'gray'] } as const;

export function BudgetPanel({ trip: t, calc: c }: { trip: Trip; calc: TripCalc }) {
  const { data, money, run, canEdit, tz } = useApp(); const b = budgetVsActual(t, c); const [edit, setEdit] = useState<string | null>(null); const [text, setText] = useState('');
  if (!b || !t.budgetSnapshot) return <section className="panel"><div className="panel-b"><b>Este viaje no nació de una cotización aceptada</b>, por eso no tiene un presupuesto congelado para comparar. {t.budget && Object.keys(t.budget).length ? 'Se muestra el presupuesto manual por categoría en la pestaña Gastos.' : <>Para comparar presupuesto y resultado, cotizá el viaje desde <a href={href('cotizaciones/nueva')}>Cotizaciones</a>.</>}</div></section>;
  const sn = t.budgetSnapshot;
  const fmt = (r: Row, v: number | null) => v == null ? NA : r.unit === 'money' ? money(v) : r.unit === 'km' ? fmtKm(v) : r.unit === 'min' ? fmtDuration(v) : fmtPct(v);
  const diff = (r: Row) => r.diff == null ? NA : `${r.diff > 0 ? '+' : r.diff < 0 ? '−' : ''}${r.unit === 'money' ? money(Math.abs(r.diff)) : r.unit === 'km' ? `${fmtNum(Math.abs(r.diff))} km` : r.unit === 'min' ? fmtDuration(Math.abs(r.diff)) : `${Math.abs(r.diff).toFixed(1).replace('.', ',')} p. p.`}`;
  const pct = (r: Row) => r.unit === 'pct' ? '—' : r.diff == null ? NA : r.pctNA ? 'No aplica' : r.pct == null ? NA : `${r.pct > 0 ? '+' : r.pct < 0 ? '−' : ''}${Math.abs(r.pct).toFixed(1).replace('.', ',')} %`;
  const note = (key: string) => t.deviationNotes?.[key];
  const line = (r: Row, strong = false) => { const n = note(r.key); return (
    <tr key={r.key} style={strong ? { background: '#F8FAFB', fontWeight: 600 } : undefined}><td>{r.label}{n && <div className="small muted" style={{ fontWeight: 400 }}>Explicación: {n.text} <span>({n.by}, {fmtDateTime(n.at, tz)})</span></div>}</td>
      <td className="num">{fmt(r, r.planned)}</td><td className="num">{fmt(r, r.actual)}</td><td className="num">{diff(r)}</td><td className="num">{pct(r)}</td><td><span className={`chip ${TONE[r.tone][1]}`}>{TONE[r.tone][0]}</span></td>
      <td className="num hide-sm">{canEdit && r.diff != null && r.diff !== 0 && <button className="btn sm ghost" onClick={() => { setEdit(r.key); setText(n?.text ?? ''); }}>{n ? 'Editar' : 'Explicar'}</button>}</td></tr>); };
  const saveNote = async () => { if (await run(() => api('PUT', `/api/trips/${t.id}/deviation-notes`, { key: edit, text }), 'Explicación guardada')) setEdit(null); };
  return (
    <div className="stack">
      <div className="banner blue"><div>Presupuesto aceptado en la cotización <a href={href(`cotizaciones/${sn.quoteId}`)}>{sn.quoteNumber}</a> ({sn.vehicleLabel}). Es una <b>copia histórica</b>: los cambios posteriores de tarifas, parámetros del vehículo o de la cotización no la modifican.</div></div>
      {!b.reliable && <div className="banner amber"><AlertTriangle size={18} /><div><b>Comparación provisoria.</b> {b.why.join(' · ') || 'Faltan registros'}. Mientras tanto, un costo real menor no se interpreta como ahorro.</div></div>}
      <section className="panel"><div className="panel-h"><h2>Previsto vs. real</h2><span className="muted small">Desvío = real − previsto</span></div>
        <div className="table-wrap"><table className="tbl"><thead><tr><th>Concepto</th><th className="num">Previsto</th><th className="num">Real</th><th className="num">Desvío</th><th className="num">Desvío %</th><th>Lectura</th><th className="hide-sm"></th></tr></thead><tbody>
          {b.rows.map(r => line(r))}{line(b.totalCost, true)}{line(b.revenue, true)}{line(b.result, true)}{line(b.margin, true)}{line(b.km)}{line(b.duration)}</tbody></table></div>
        <div className="panel-b muted small" style={{ borderTop: '1px solid var(--line)' }}>Costos y desvíos de costo: más alto = desfavorable. Ingreso, resultado y margen: más bajo = desfavorable. Si el presupuesto de un concepto es $0, se muestra la diferencia en dinero y el porcentaje figura “No aplica”. El sistema señala diferencias comprobadas; las causas surgen de los registros o de las explicaciones que cargan los usuarios.</div></section>
      <section className="panel"><div className="panel-h"><h2>Supuestos del presupuesto</h2><span className="muted small">Aceptado el {fmtDateTime(sn.acceptedAt, tz)} · {sn.acceptedBy}</span></div>
        <div className="table-wrap"><table className="tbl"><tbody>{(Object.keys(sn.assumptions) as BudgetCat[]).map(k => <tr key={k}><td style={{ width: 220 }}>{BUDGET_LABEL[k]}</td><td className="num" style={{ width: 150 }}>{sn.included[k] ? money(sn.costs[k]) : <span className="muted">No incluido</span>}</td><td className="small muted wrap">{sn.assumptions[k]}</td></tr>)}
          <tr><td>Precio neto</td><td className="num">{money(sn.revenueNet)}</td><td className="small muted">Margen objetivo {fmtPct(sn.marginTarget)} · precio sugerido {money(sn.suggestedNet)}</td></tr></tbody></table></div></section>
      {edit && <section className="panel"><div className="panel-b stack"><Field label={`Explicación del desvío: ${[...b.rows, b.totalCost, b.revenue, b.result, b.margin, b.km, b.duration].find(r => r.key === edit)?.label}`} hint="Escribí la causa que surge de los registros o de lo que conocés del viaje. Queda guardada con tu nombre y fecha."><textarea value={text} onChange={e => setText(e.target.value)} /></Field>
        <div className="row"><button className="btn primary" onClick={saveNote}>Guardar explicación</button><button className="btn" onClick={() => setEdit(null)}>Cancelar</button></div></div></section>}
      <span className="sr-only"><ArrowRight /></span>
    </div>
  );
}
