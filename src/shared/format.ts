import { localDate, localTime } from './time';

export const NA = 'No disponible';
const cache = new Map<string, Intl.NumberFormat>();
function nf(key: string, opts: Intl.NumberFormatOptions) {
  let f = cache.get(key); if (!f) { f = new Intl.NumberFormat('es-AR', opts); cache.set(key, f); } return f;
}
export function fmtMoney(v: number | null | undefined, currency = 'ARS', decimals = 0): string {
  if (v == null || !Number.isFinite(v)) return NA;
  return nf(`m${currency}${decimals}`, { style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v);
}
export function fmtNum(v: number | null | undefined, decimals = 0): string {
  if (v == null || !Number.isFinite(v)) return NA;
  return nf(`n${decimals}`, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v);
}
export function fmtKm(v: number | null | undefined): string { return v == null ? NA : `${fmtNum(v)} km`; }
export function fmtPct(v: number | null | undefined, decimals = 1): string {
  if (v == null || !Number.isFinite(v)) return NA;
  return `${nf(`n${decimals}`, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v)} %`;
}
/** Variación relativa entre períodos (en %). */
export function fmtPctChange(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return NA;
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${nf('n1', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.abs(v))} %`;
}
/** Cambio de margen, en puntos porcentuales. */
export function fmtPp(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return NA;
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${nf('n1', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.abs(v))} p. p.`;
}
export function fmtDuration(min: number | null | undefined): string {
  if (min == null) return NA;
  const h = Math.floor(min / 60), m = min % 60;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}
export function fmtDate(date: string | null | undefined): string {
  if (!date) return '—';
  const [y, m, d] = date.slice(0, 10).split('-'); return `${d}/${m}/${y}`;
}
export function fmtDateTime(iso: string | null | undefined, tz: string): string {
  if (!iso) return '—';
  return `${fmtDate(localDate(iso, tz))} ${localTime(iso, tz)}`;
}
