import { STATIC, staticSend } from './static/backend';

export class ApiError extends Error {
  constructor(public status: number, public errors: string[], public body: any) { super(errors.join(' · ') || `Error ${status}`); }
}
// La sesión vive en memoria (y en sessionStorage cuando existe). Nunca se guardan datos del usuario en el navegador más allá del token.
let token: string | null = null;
try { token = localStorage.getItem('rumbo.token') ?? sessionStorage.getItem('rumbo.token'); } catch { /* sin almacenamiento */ }
export const getToken = () => token;
/** `persist`: "recordarme en este dispositivo" (localStorage, hasta 30 días); si no, solo mientras la pestaña esté abierta. */
export function setToken(t: string | null, persist = false) { token = t; try { localStorage.removeItem('rumbo.token'); sessionStorage.removeItem('rumbo.token'); if (t) (persist ? localStorage : sessionStorage).setItem('rumbo.token', t); } catch { /* ignorar */ } }

interface Raw { status: number; json?: any; blob?: Blob; fileName?: string }
async function send(method: string, url: string, body?: unknown): Promise<Raw> {
  if (STATIC) { const r = await staticSend(method, url, body === undefined ? undefined : JSON.parse(JSON.stringify(body)), token ?? undefined); return r.file ? { status: r.status, blob: new Blob([r.file.bytes as BlobPart], { type: r.file.mime }), fileName: r.file.name } : { status: r.status, json: r.body }; }
  let res: Response;
  try { res = await fetch(url, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined }); }
  catch { throw new ApiError(0, ['No hay conexión con el servidor. Los datos no se guardaron: revisá tu conexión y volvé a intentar.'], null); }
  const ct = res.headers.get('content-type') ?? '';
  if (res.ok && !ct.includes('json')) return { status: res.status, blob: await res.blob(), fileName: /filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(res.headers.get('content-disposition') ?? '')?.[1] };
  const text = await res.text(); let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { /* no JSON */ }
  return { status: res.status, json };
}
function check(r: Raw) {
  if (r.status === 401 && token) { window.dispatchEvent(new CustomEvent('rumbo:unauthorized')); }
  if (r.status >= 400) throw new ApiError(r.status, r.json?.errors ?? [r.json?.message ?? `Error ${r.status}`], r.json);
}
export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> { const r = await send(method, url, body); check(r); return r.json as T; }
/** Descarga autenticada (los archivos son privados: no existen URLs públicas). */
export async function apiBlob(url: string): Promise<{ blob: Blob; fileName?: string }> { const r = await send('GET', url); check(r); if (!r.blob) throw new ApiError(500, ['Respuesta inesperada'], null); return { blob: r.blob, fileName: r.fileName }; }
export async function saveBlob(url: string, fallbackName: string) {
  const { blob, fileName } = await apiBlob(url); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName ?? fallbackName;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export const toBase64 = (file: File): Promise<string> => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = () => rej(new Error('No se pudo leer el archivo')); r.readAsDataURL(file); });
