// Utilidades de tiempo con zona horaria explícita (no dependen de la zona del navegador o servidor).

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export interface Parts { y: number; m: number; d: number; h: number; mi: number; s: number }
export function localParts(isoOrDate: string | Date, tz: string): Parts {
  const date = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  const o: Record<string, number> = {};
  for (const p of dtf(tz).formatToParts(date)) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return { y: o.year, m: o.month, d: o.day, h: o.hour, mi: o.minute, s: o.second };
}
const p2 = (n: number) => String(n).padStart(2, '0');
export const localDate = (iso: string | Date, tz: string): string => {
  const p = localParts(iso, tz); return `${p.y}-${p2(p.m)}-${p2(p.d)}`;
};
export const localMonth = (iso: string | Date, tz: string): string => localDate(iso, tz).slice(0, 7);
export const localTime = (iso: string, tz: string): string => {
  const p = localParts(iso, tz); return `${p2(p.h)}:${p2(p.mi)}`;
};

/** Desfase (minutos) de la zona respecto de UTC en el instante dado. */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const p = localParts(date, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}
/** 'YYYY-MM-DDTHH:mm' (hora local de la empresa) -> ISO UTC. Devuelve null si es inválido. */
export function localInputToIso(naive: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(naive.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  if (new Date(guess).getUTCMonth() !== mo - 1) return null; // día inexistente
  let off = tzOffsetMinutes(new Date(guess), tz);
  let ts = guess - off * 60000;
  const off2 = tzOffsetMinutes(new Date(ts), tz);
  if (off2 !== off) ts = guess - off2 * 60000;
  return new Date(ts).toISOString();
}
export function isoToLocalInput(iso: string | null, tz: string): string {
  if (!iso) return '';
  const p = localParts(iso, tz);
  return `${p.y}-${p2(p.m)}-${p2(p.d)}T${p2(p.h)}:${p2(p.mi)}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`;
}
export function daysBetween(a: string, b: string): number {
  const f = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((f(b) - f(a)) / 86400000);
}
export const daysInMonth = (month: string): number => {
  const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
export const monthStart = (month: string): string => `${month}-01`;
export const monthEnd = (month: string): string => `${month}-${p2(daysInMonth(month))}`;
export function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${p2(m - 1)}`;
}
export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${p2(m + 1)}`;
}
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number); return `${MONTHS[m - 1]} de ${y}`;
}
export function monthShort(month: string): string {
  const [y, m] = month.split('-').map(Number); return `${MONTHS[m - 1].slice(0, 3)} ${String(y).slice(2)}`;
}
export const minutesBetween = (a: string, b: string): number => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
