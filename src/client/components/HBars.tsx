export interface Bar { key: string; label: string; value: number | null; text: string; below?: boolean; onClick?: () => void }
/** Barras horizontales de una sola serie (azul). Marca en ámbar lo que está bajo el objetivo y dibuja la línea de referencia. */
export function HBars({ bars, max, refValue: ref, refLabel, ariaLabel }: { bars: Bar[]; max?: number; refValue?: number | null; refLabel?: string; ariaLabel: string }) {
  const m = max ?? Math.max(1, ...bars.map(b => Math.max(0, b.value ?? 0)), ref ?? 0) * 1.08;
  return (
    <>
      <div className="hbars" role="list" aria-label={ariaLabel}>
        {bars.map(b => (
          <button key={b.key} className="hbar" role="listitem" onClick={b.onClick} title={`${b.label}: ${b.text}`}>
            <span className="lbl">{b.label}</span>
            <span className="track" aria-hidden>
              <span className={`fill ${b.below ? 'below' : ''}`} style={{ width: `${Math.max(0, Math.min(100, ((b.value ?? 0) / m) * 100))}%` }} />
              {ref != null && <span className="ref" style={{ left: `${(ref / m) * 100}%` }} />}
            </span>
            <span className="val">{b.text}</span>
          </button>
        ))}
        {!bars.length && <div className="empty">Sin datos para los filtros elegidos</div>}
      </div>
      {ref != null && refLabel && <div className="chart-legend"><span><span className="sw" style={{ background: 'var(--blue)' }} />Dentro del objetivo</span><span><span className="sw" style={{ background: '#C98A1E' }} />Bajo el objetivo</span><span><span className="sw" style={{ background: 'var(--ink)', width: 3 }} />{refLabel}</span></div>}
    </>
  );
}
