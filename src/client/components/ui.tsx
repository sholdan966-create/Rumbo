import { ReactNode, useEffect, useRef, useState } from 'react';
import { X, FileClock, FileCheck2, FileX2, Loader2 } from 'lucide-react';
import { parseNumber } from '../../shared/import';
import { isoToLocalInput, localInputToIso } from '../../shared/time';
import { InvoiceTotals } from '../../shared/calc';
import { ReportStatus, TripStatus } from '../../shared/types';
import { STATIC } from '../static/backend';
import { SheetBody } from './SheetModal';
import { useBlobUrl } from '../hooks';
import { saveBlob } from '../api';
import { useAppToast } from '../toastBridge';

export function Modal({ title, onClose, children, footer, size = '' }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: '' | 'wide' | 'pdf' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', f); const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button.primary')?.focus();
    return () => { document.removeEventListener('keydown', f); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="overlay center" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${size}`} role="dialog" aria-modal="true" ref={ref}>
        <div className="dlg-h"><h2>{title}</h2><button className="btn icon ghost" onClick={onClose} aria-label="Cerrar"><X size={20} /></button></div>
        <div className="dlg-b">{children}</div>
        {footer && <div className="dlg-f">{footer}</div>}
      </div>
    </div>
  );
}
export function Drawer({ title, onClose, children, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => { const f = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', f); return () => document.removeEventListener('keydown', f); }, [onClose]);
  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="drawer" role="dialog" aria-modal="true">
        <div className="dlg-h"><h2>{title}</h2><button className="btn icon ghost" onClick={onClose} aria-label="Cerrar"><X size={20} /></button></div>
        <div className="dlg-b">{children}</div>
        {footer && <div className="dlg-f">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, error, children, className = '' }: { label: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return <div className={`field ${error ? 'invalid' : ''} ${className}`}><label>{label}</label>{children}{error ? <span className="err" role="alert">{error}</span> : hint ? <span className="hint">{hint}</span> : null}</div>;
}

/** Campo numérico que distingue vacío (null = pendiente) de 0 (confirmado). Acepta 1.234,56 o 1234.56. */
export function NumField({ label, value, onChange, error, hint, prefix, placeholder, disabled }: { label: ReactNode; value: number | null; onChange: (v: number | null) => void; error?: string; hint?: ReactNode; prefix?: string; placeholder?: string; disabled?: boolean }) {
  const [text, setText] = useState(value == null ? '' : String(value).replace('.', ','));
  const [bad, setBad] = useState(false);
  useEffect(() => { const cur = parseNumber(text); if ((cur ?? null) !== value || (cur === undefined && value !== null)) { if (!bad) setText(value == null ? '' : String(value).replace('.', ',')); } /* eslint-disable-next-line */ }, [value]);
  return (
    <Field label={label} hint={hint} error={error ?? (bad ? 'Número inválido' : undefined)}>
      <div className={prefix ? 'input-affix' : ''}>
        {prefix && <span aria-hidden>{prefix}</span>}
        <input type="text" inputMode="decimal" value={text} placeholder={placeholder} disabled={disabled}
          onChange={e => { setText(e.target.value); const n = parseNumber(e.target.value); if (n === undefined) setBad(true); else { setBad(false); onChange(n); } }} />
      </div>
    </Field>
  );
}
export function DateTimeField({ label, value, onChange, tz, error, hint }: { label: ReactNode; value: string | null; onChange: (iso: string | null) => void; tz: string; error?: string; hint?: ReactNode }) {
  return <Field label={label} error={error} hint={hint}><input type="datetime-local" value={isoToLocalInput(value, tz)} onChange={e => onChange(e.target.value ? localInputToIso(e.target.value, tz) : null)} /></Field>;
}

const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
/** Cifras que "cuentan" hasta su valor al aparecer o cambiar. Solo anima textos numéricos (con puntos de miles y coma decimal). */
function useCountUp(text: string | null): string | null {
  const m = text ? /^(\D*?)(\d[\d.]*(?:,\d+)?)(\D*)$/.exec(text) : null;
  const target = m ? parseFloat(m[2].replace(/\./g, '').replace(',', '.')) : null; const decimals = m ? (m[2].split(',')[1]?.length ?? 0) : 0;
  const [shown, setShown] = useState<number | null>(target === null || reduceMotion() ? target : 0); const from = useRef(0);
  useEffect(() => {
    if (target === null) { setShown(null); return; } if (reduceMotion()) { setShown(target); return; }
    const start = performance.now(), a = from.current, dur = 550; let raf = 0;
    const tick = (t: number) => { const k = Math.min(1, (t - start) / dur), v = a + (target - a) * (1 - Math.pow(1 - k, 3)); setShown(v); from.current = v; if (k < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [target]);
  if (!m || shown === null) return text;
  return `${m[1]}${new Intl.NumberFormat('es-AR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(shown)}${m[3]}`;
}

export function Kpi({ label, value, sub, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: 'warn' | 'bad' }) {
  const [flash, setFlash] = useState(false); const prev = useRef<ReactNode>(value); const animated = useCountUp(typeof value === 'string' ? value : null);
  useEffect(() => { if (prev.current !== value) { prev.current = value; setFlash(true); const t = setTimeout(() => setFlash(false), 1200); return () => clearTimeout(t); } }, [value]);
  return <div className={`kpi ${tone ?? ''} ${flash ? 'flash' : ''}`}><div className="k-l">{label}</div><div className="k-v">{typeof value === 'string' ? animated : value}</div>{sub && <div className="k-s">{sub}</div>}</div>;
}

export const TRIP_STATUS: Record<TripStatus, { label: string; cls: string }> = {
  planificado: { label: 'Planificado', cls: 'gray' }, en_curso: { label: 'En curso', cls: 'blue' }, finalizado: { label: 'Finalizado', cls: 'accent' }, cancelado: { label: 'Cancelado', cls: 'gray' },
};
export const TripChip = ({ s }: { s: TripStatus }) => <span className={`chip ${TRIP_STATUS[s].cls}`}>{s === 'en_curso' && <span className="dot" />}{TRIP_STATUS[s].label}</span>;

export const INV_STATUS: Record<InvoiceTotals['status'], { label: string; cls: string }> = {
  pagada: { label: 'Pagada', cls: 'accent' }, vencida: { label: 'Vencida', cls: 'red' }, por_vencer: { label: 'Por vencer', cls: 'amber' }, vigente: { label: 'Vigente', cls: 'blue' },
};
export const InvChip = ({ t }: { t: InvoiceTotals }) => <><span className={`chip ${INV_STATUS[t.status].cls}`}>{INV_STATUS[t.status].label}</span>{t.partial && <span className="chip gray" style={{ marginLeft: 4 }}>Parcial</span>}</>;

export const REPORT_STATUS: Record<ReportStatus, { label: string; cls: string }> = {
  pendiente: { label: 'Pendiente', cls: 'amber' }, generando: { label: 'Generando', cls: 'blue pulse' }, disponible: { label: 'Disponible', cls: 'accent' }, error: { label: 'Error', cls: 'red' },
};
export const ReportChip = ({ s }: { s: ReportStatus }) => (
  <span className={`chip ${REPORT_STATUS[s].cls}`}>
    {s === 'generando' ? <Loader2 size={14} className="spin" /> : s === 'disponible' ? <FileCheck2 size={14} /> : s === 'error' ? <FileX2 size={14} /> : <FileClock size={14} />}{REPORT_STATUS[s].label}
  </span>
);

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return <div className="tabs" role="tablist">{tabs.map(t => <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? 'on' : ''} onClick={() => onChange(t.id)}>{t.label}</button>)}</div>;
}
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;

export function downloadCsv(name: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  if (STATIC) { const text = rows.map(r => r.map(esc).join(';')).join('\n'); navigator.clipboard?.writeText(text).then(() => window.dispatchEvent(new CustomEvent('rumbo:toast', { detail: 'CSV copiado al portapapeles (las descargas no están disponibles en esta demostración)' })), () => window.dispatchEvent(new CustomEvent('rumbo:toast', { detail: 'No se pudo copiar el CSV' }))); return; }
  const blob = new Blob(['﻿' + rows.map(r => r.map(esc).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export function PdfModal({ title, src, onClose }: { title: string; src: string; onClose: () => void }) {
  const { url, error } = useBlobUrl(STATIC ? null : src); const { toast } = useAppToast();
  if (STATIC) return <Modal title={title} onClose={onClose} size="wide" footer={<span className="muted small" style={{ marginRight: 'auto' }}>En esta demostración la ficha se ve en pantalla; la descarga del PDF requiere la versión con servidor.</span>}><SheetBody src={src} /></Modal>;
  return (
    <Modal title={title} onClose={onClose} size="pdf" footer={<button className="btn primary" onClick={() => saveBlob(src + (src.includes('?') ? '&' : '?') + 'download=1', title.replace(/[^\w.-]+/g, '_') + '.pdf').catch(e => toast(e.message, 'err'))}>Descargar PDF</button>}>
      {error ? <div className="banner red">{error}</div> : !url ? <p className="muted">Generando vista previa…</p> : <iframe title={title} src={url} style={{ width: '100%', height: '100%', minHeight: 420, border: '1px solid var(--line)', borderRadius: 6 }} />}
    </Modal>
  );
}
