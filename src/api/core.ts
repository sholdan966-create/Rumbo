// API de RUMBO independiente del entorno (Node o navegador). Toda la autorización y la validación viven acá.
// El adaptador de Express (src/server/index.ts) y el servidor simulado de la demo estática (src/client/static) la comparten.
import {
  AttachKind, BUDGET_CATS, BudgetCat, Client, CollectionAction, CompanyData, Doc, EXPENSE_CATEGORIES, EXPENSE_LABEL, Expense, ExpenseCategory, FileMeta, Invoice, Payment,
  Quote, Role, Settings, Trip, Truck, User,
} from '../shared/types';
import { categoryAmount, computeTrips, kmTotal, paramsError, routeKey } from '../shared/calc';
import { findDuplicates, validateInvoice, validatePayment, validateTrip } from '../shared/validate';
import { IMPORT_FIELDS, mapRows, nextTripId } from '../shared/import';
import { nextQuoteNumber, quoteCalc, quoteStatus, snapshotFromQuote, suggestCosts, validateQuote } from '../shared/quote';
import { clientAccount } from '../shared/account';
import { invoiceTotals } from '../shared/calc';
import { addDays, localDate, minutesBetween } from '../shared/time';
import { fmtDate, fmtMoney } from '../shared/format';

export interface Req { method: string; path: string; query: URLSearchParams; body: any; token?: string }
export interface Res { status: number; body?: unknown; file?: { name: string; mime: string; bytes: Uint8Array; inline: boolean } }
export interface Hooks {
  scheduleTrip(tripId: string, o?: { force?: boolean; immediate?: boolean }): { report: unknown; created: boolean; reason: string };
  scheduleMonthly(month: string, trigger: 'automatico' | 'manual'): { report: unknown; created: boolean; reason: string };
  retryTrip(id: string): unknown; retryMonthly(id: string): unknown; retryEmail(id: string): unknown;
  putFile(id: string, bytes: Uint8Array): void; getFile(id: string): Uint8Array | null; delFile(id: string): void;
  getReport(fileName: string): Uint8Array | null;
  /** Genera un PDF a pedido. Devuelve null si el entorno no puede generar PDF (la interfaz muestra la vista en pantalla). */
  render(kind: 'trip_preview' | 'quote' | 'statement' | 'monthly_preview', p: Record<string, string>): Promise<{ name: string; bytes: Uint8Array } | null>;
  mail(to: string[], subject: string, text: string): Promise<{ status: 'enviado' | 'sin_configurar' | 'error'; detail: string }>;
  failNext(n: number): void; reset(): Promise<void>; flags: { demo: boolean; mailConfigured: boolean; aiConfigured: boolean; debounceMs: number; auth: string; setupToken?: string };
}
export interface Env { data(): CompanyData; save(): void; now(): Date; hooks: Hooks }

class HttpError extends Error { constructor(public status: number, public errors: string[], public extra: Record<string, unknown> = {}) { super(errors.join(' · ')); } }
const fail = (status: number, ...errors: string[]): never => { throw new HttpError(status, errors); };
const uid = (): string => crypto.randomUUID();
const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

// ------------------------------------------------------------------ contraseñas (PBKDF2 con Web Crypto: igual en Node y navegador)
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const DEMO_KDF = 60_000, REAL_KDF = 210_000;
async function hashPin(pin: string, salt: string, iterations = DEMO_KDF): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations }, key, 256));
}
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
const USERNAME_RE = /^[a-z0-9._@-]{3,60}$/;
/** Política de contraseñas de una instalación real: largo mínimo y no solo números. La demo usa un PIN fijo. */
function passwordError(p: unknown): string | null {
  const v = String(p ?? ''); if (v.length < 10) return 'La contraseña debe tener al menos 10 caracteres';
  if (/^\d+$/.test(v)) return 'La contraseña no puede ser solo números'; if (v.length > 200) return 'Contraseña demasiado larga'; return null;
}
async function credential(pw: string) { const salt = uid(); return { salt, pinHash: await hashPin(pw, salt, REAL_KDF), kdf: REAL_KDF }; }
/** Asigna PIN con hash a los usuarios que no lo tienen. DEMO: PIN común; producción: usar un proveedor de identidad. */
export async function initUsers(d: CompanyData, pin = '1234') {
  for (const u of d.users) if (!u.pinHash) { u.salt = uid(); u.pinHash = await hashPin(pin, u.salt); }
}
const sessions = new Map<string, { userId: string; exp: number }>();
const attempts = new Map<string, { n: number; until: number }>();
const safeUser = (u: User) => ({ id: u.id, name: u.name, username: u.username, role: u.role, driverId: u.driverId, active: u.active !== false });
const STAFF: Role[] = ['administrador', 'operador', 'consulta']; const WRITERS: Role[] = ['administrador', 'operador'];

// ------------------------------------------------------------------ historial (solo se escribe desde operaciones reales del sistema)
export interface Actor { id: string; name: string; type: 'usuario' | 'proceso' }
export function audit(d: CompanyData, a: Actor, entity: string, entityId: string, action: string, summary: string, o: { before?: unknown; after?: unknown; reason?: string; refs?: string[] } = {}) {
  d.audit.unshift({ id: uid(), at: new Date().toISOString(), user: a.name, userId: a.id, actorType: a.type, entity, entityId, action, summary, before: o.before, after: o.after, reason: o.reason, refs: [entityId, ...(o.refs ?? [])] });
  if (d.audit.length > 3000) d.audit.length = 3000;
}

// ------------------------------------------------------------------ archivos
const isImg = (b: Uint8Array) => (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) ? 'image/png' : (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ? 'image/jpeg' : (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) ? 'application/pdf' : null;
function decodeB64(s: string): Uint8Array { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
function storeFile(env: Env, user: User, body: any, entityType: AttachKind, entityId: string, links: { type: AttachKind; id: string }[]): FileMeta {
  const d = env.data(); if (typeof body?.dataBase64 !== 'string') fail(422, 'Falta el archivo');
  let bytes: Uint8Array; try { bytes = decodeB64(body.dataBase64); } catch { return fail(422, 'El archivo no se pudo leer'); }
  if (!bytes.length) fail(422, 'El archivo está vacío');
  if (bytes.length > d.settings.maxFileKb * 1024) fail(422, `El archivo supera el límite de ${d.settings.maxFileKb} KB`);
  const mime = isImg(bytes); if (!mime) return fail(422, 'Solo se aceptan imágenes (PNG, JPG) y PDF; el contenido del archivo no coincide con ninguno de esos formatos');
  const name = String(body.name ?? 'archivo').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'archivo';
  const f: FileMeta = { id: uid(), name, mime, size: bytes.length, uploadedAt: env.now().toISOString(), uploadedBy: user.name, uploadedById: user.id, entityType, entityId, description: String(body.description ?? '').slice(0, 300), links };
  env.hooks.putFile(f.id, bytes); d.files.push(f); return f;
}
const driverOwnsTrip = (d: CompanyData, u: User, tripId: string) => d.trips.some(t => t.id === tripId && t.driverId === u.driverId);
function canReadFile(d: CompanyData, u: User, f: FileMeta): boolean {
  if (STAFF.includes(u.role)) return true;
  if (f.uploadedById === u.id) return true;
  const refs = [{ type: f.entityType, id: f.entityId }, ...f.links];
  return refs.some(r => (r.type === 'viaje' && driverOwnsTrip(d, u, r.id)) || (r.type === 'chofer' && r.id === u.driverId)
    || (r.type === 'gasto' && d.trips.some(t => t.driverId === u.driverId && t.expenses.some(e => e.id === r.id))) || (r.type === 'documento' && d.documents.some(x => x.id === r.id && x.ownerType === 'chofer' && x.ownerId === u.driverId)));
}

// ------------------------------------------------------------------ vista del chofer: nunca incluye costos internos, márgenes ni presupuesto
function driverTrip(d: CompanyData, t: Trip) {
  const s = d.settings.driverPortal; const truck = d.trucks.find(x => x.id === t.truckId);
  const own = (e: Expense) => ({ id: e.id, category: e.category, amount: e.amount, date: e.date, note: e.note, status: e.status ?? 'aprobado', rejectionReason: e.rejectionReason, createdBy: e.createdBy });
  const files = d.files.filter(f => f.entityId === t.id || f.links.some(l => l.id === t.id)).map(f => ({ id: f.id, name: f.name, mime: f.mime, size: f.size, uploadedAt: f.uploadedAt, uploadedBy: f.uploadedBy, description: f.description, expenseId: f.entityType === 'gasto' ? f.entityId : null }));
  return {
    id: t.id, status: t.status, origin: t.origin, destination: t.destination, client: d.clients.find(c => c.id === t.clientId)?.name ?? '', truck: truck?.name ?? '', plate: truck?.plate ?? '',
    plannedDeparture: t.plannedDeparture, plannedArrival: t.plannedArrival, actualDeparture: t.actualDeparture, actualArrival: t.actualArrival, kmLoaded: t.kmLoaded, odometerStart: t.odometerStart, odometerEnd: t.odometerEnd,
    instructions: t.instructions ?? '', notes: t.notes, expenses: t.expenses.filter(e => e.createdById || e.status).map(own).concat(s.showExpenseTotals ? t.expenses.filter(e => !e.createdById && !e.status).map(own) : []),
    stops: t.stops ?? [], incidents: t.incidents ?? [], timeCorrections: t.timeCorrections ?? [], driverDone: t.driverDone ?? null, reviewedAt: t.reviewedAt ?? null, files,
    serviceValue: s.showTripValue ? t.serviceValue : undefined, expenseTotal: s.showExpenseTotals ? t.expenses.filter(e => e.status !== 'rechazado').reduce((a, e) => a + e.amount, 0) : undefined,
  };
}

// ------------------------------------------------------------------ cambios de un viaje (para historial y motivos)
const TRACK: [keyof Trip, string][] = [['serviceValue', 'valor del servicio'], ['status', 'estado'], ['truckId', 'camión'], ['driverId', 'chofer'], ['kmLoaded', 'km con carga'], ['kmEmpty', 'km vacíos'], ['actualDeparture', 'salida real'], ['actualArrival', 'llegada real'], ['plannedDeparture', 'salida prevista'], ['plannedArrival', 'llegada prevista'], ['odometerStart', 'odómetro inicial'], ['odometerEnd', 'odómetro final'], ['ivaRate', 'IVA']];
const NEEDS_REASON: (keyof Trip)[] = ['serviceValue', 'status', 'truckId', 'driverId', 'kmLoaded', 'kmEmpty', 'actualDeparture', 'actualArrival'];
function tripChanges(a: Trip, b: Trip) {
  const before: Record<string, unknown> = {}, after: Record<string, unknown> = {}; const names: string[] = []; const critical: string[] = [];
  for (const [k, label] of TRACK) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) { before[label] = a[k] ?? null; after[label] = b[k] ?? null; names.push(label); if (NEEDS_REASON.includes(k)) critical.push(label); }
  for (const c of EXPENSE_CATEGORIES) { const x = categoryAmount(a, c), y = categoryAmount(b, c); if (x !== y) { before[`gasto ${EXPENSE_LABEL[c]}`] = x; after[`gasto ${EXPENSE_LABEL[c]}`] = y; names.push(`gasto ${EXPENSE_LABEL[c].toLowerCase()}`); } }
  return { before, after, names, critical };
}

// ------------------------------------------------------------------ manejador principal
type Handler = (ctx: Ctx) => Promise<Res> | Res;
interface Ctx { env: Env; d: CompanyData; user: User; actor: Actor; req: Req; m: RegExpExecArray }
const routes: { method: string; re: RegExp; roles: Role[] | 'any' | 'public'; h: Handler }[] = [];
const route = (method: string, re: RegExp, roles: Role[] | 'any' | 'public', h: Handler) => routes.push({ method, re, roles, h });
const json = (body: unknown, status = 200): Res => ({ status, body });
const ADMIN: Role[] = ['administrador']; const WRITE = WRITERS; const READ = STAFF;
const rid = (m: RegExpExecArray, i = 1) => decodeURIComponent(m[i]);

export async function handle(env: Env, req: Req): Promise<Res> {
  try {
    const r = routes.find(x => x.method === req.method && x.re.test(req.path)); if (!r) return { status: 404, body: { errors: [`Ruta inexistente: ${req.method} ${req.path}`] } };
    const m = r.re.exec(req.path)!; const d = env.data();
    if (r.roles === 'public') return await r.h({ env, d, user: undefined as unknown as User, actor: undefined as unknown as Actor, req, m });
    const s = req.token ? sessions.get(req.token) : undefined;
    if (!s || s.exp < Date.now()) return { status: 401, body: { errors: ['Iniciá sesión para continuar'] } };
    const user = d.users.find(u => u.id === s.userId); if (!user) return { status: 401, body: { errors: ['La sesión ya no es válida'] } };
    if (r.roles !== 'any' && !r.roles.includes(user.role)) return { status: 403, body: { errors: ['Tu usuario no tiene permiso para esta operación'] } };
    return await r.h({ env, d, user, actor: { id: user.id, name: user.name, type: 'usuario' }, req, m });
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, body: { errors: e.errors, ...e.extra } };
    console.error('[api]', e); return { status: 500, body: { errors: ['Error interno del servidor'] } };
  }
}

// ---- sesión
route('GET', /^\/api\/auth\/users$/, 'public', ({ env, d }) => env.hooks.flags.demo ? json({ users: d.users.map(safeUser), demoPin: '1234' }) : json({ users: [] })); // la lista pública de usuarios existe solo en modo demostración
route('POST', /^\/api\/auth\/login$/, 'public', async ({ d, req }) => {
  const { userId, username, pin, password, remember } = req.body ?? {};
  const u = userId ? d.users.find(x => x.id === userId) : d.users.find(x => x.username && x.username === norm(username));
  const key = String(u?.id ?? `x:${norm(username ?? userId)}`); const a = attempts.get(key) ?? { n: 0, until: 0 };
  if (a.until > Date.now()) return fail(429, 'Demasiados intentos fallidos. Esperá unos minutos.');
  const secret = String(password ?? pin ?? '');
  const good = !!u && u.active !== false && (await hashPin(secret, u.salt, u.kdf ?? DEMO_KDF)) === u.pinHash;
  if (!good) { a.n++; if (a.n >= 5) { a.until = Date.now() + 5 * 60_000; a.n = 0; } attempts.set(key, a); return fail(401, 'Usuario o contraseña incorrectos'); }
  attempts.delete(key); const token = uid() + uid(); sessions.set(token, { userId: u!.id, exp: Date.now() + (remember ? 30 * 24 : 12) * 3600_000 }); // "recordarme": 30 días en ese dispositivo
  return json({ token, user: safeUser(u!), remember: !!remember });
});
// ---- instalación inicial (solo mientras no exista ningún usuario)
route('GET', /^\/api\/setup\/status$/, 'public', ({ env, d }) => json({ needsSetup: d.users.length === 0, demo: env.hooks.flags.demo, needsToken: !!env.hooks.flags.setupToken }));
route('POST', /^\/api\/setup$/, 'public', async ({ env, d, req }) => {
  if (d.users.length > 0) return fail(409, 'La instalación ya fue realizada');
  const b = req.body ?? {}; const c = b.company ?? {}, ad = b.admin ?? {};
  if (env.hooks.flags.setupToken && String(b.setupToken ?? '') !== env.hooks.flags.setupToken) return fail(403, 'Código de instalación incorrecto');
  const errs: string[] = [];
  if (!String(c.name ?? '').trim()) errs.push('Indicá el nombre de la empresa');
  if (!String(ad.name ?? '').trim()) errs.push('Indicá el nombre del administrador'); if (!USERNAME_RE.test(norm(ad.username))) errs.push('El usuario debe tener entre 3 y 60 caracteres (letras, números, punto, guion, arroba)');
  const pe = passwordError(ad.password); if (pe) errs.push(pe); if (errs.length) return fail(422, ...errs);
  d.settings = { ...d.settings, companyName: String(c.name).trim(), legalName: String(c.legalName ?? c.name).trim(), cuit: String(c.cuit ?? '').trim(), address: String(c.address ?? '').trim(), phone: String(c.phone ?? '').trim(), email: String(c.email ?? '').trim() };
  const u: User = { id: `u-${uid().slice(0, 8)}`, name: String(ad.name).trim(), username: norm(ad.username), role: 'administrador', active: true, ...(await credential(String(ad.password))) };
  d.users.push(u); d.isDemo = false; const actor: Actor = { id: u.id, name: u.name, type: 'usuario' };
  audit(d, actor, 'configuración', 'instalación', 'instalación inicial', `Instalación inicial de ${d.settings.companyName}`); env.save();
  const token = uid() + uid(); sessions.set(token, { userId: u.id, exp: Date.now() + 12 * 3600_000 }); return json({ token, user: safeUser(u) });
});
route('POST', /^\/api\/auth\/logout$/, 'any', ({ req }) => { if (req.token) sessions.delete(req.token); return json({ ok: true }); });
route('GET', /^\/api\/auth\/me$/, 'any', ({ user }) => json({ user: safeUser(user) }));

route('GET', /^\/api\/state$/, READ, ({ env, d, user }) => {
  const data = { ...d, users: d.users.map(u => ({ ...safeUser(u), salt: '', pinHash: '' })) };
  const f = env.hooks.flags; return json({ data, meta: { serverNow: env.now().toISOString(), mailConfigured: f.mailConfigured, aiConfigured: f.aiConfigured, debounceMs: f.debounceMs, demoMode: f.demo, auth: f.auth, user: safeUser(user) } });
});

// ---- usuarios (solo administrador). Nunca se devuelven credenciales.
route('GET', /^\/api\/users$/, ADMIN, ({ d }) => json({ users: d.users.map(safeUser) }));
route('POST', /^\/api\/users$/, ADMIN, async ({ env, d, actor, req }) => {
  const b = req.body ?? {}; const errs: string[] = []; const username = norm(b.username);
  if (!String(b.name ?? '').trim()) errs.push('Indicá el nombre'); if (!USERNAME_RE.test(username)) errs.push('Usuario inválido (3 a 60 caracteres: letras, números, punto, guion, arroba)');
  if (d.users.some(x => x.username === username)) errs.push('Ya existe un usuario con ese nombre de acceso');
  if (!['administrador', 'operador', 'consulta', 'chofer'].includes(b.role)) errs.push('Rol inválido');
  if (b.role === 'chofer' && !d.drivers.some(x => x.id === b.driverId)) errs.push('Un usuario chofer debe estar asociado a un chofer cargado');
  if (b.role === 'chofer' && d.users.some(x => x.role === 'chofer' && x.driverId === b.driverId && x.active !== false)) errs.push('Ese chofer ya tiene un usuario activo');
  const pe = passwordError(b.password); if (pe) errs.push(pe); if (errs.length) return fail(422, ...errs);
  const u: User = { id: `u-${uid().slice(0, 8)}`, name: String(b.name).trim(), username, role: b.role, driverId: b.role === 'chofer' ? b.driverId : undefined, active: true, ...(await credential(String(b.password))) };
  d.users.push(u); audit(d, actor, 'usuario', u.id, 'creado', `Usuario ${u.name} (${u.role}) creado`, { after: { usuario: u.username, rol: u.role } }); env.save(); return json({ ok: true, user: safeUser(u) });
});
route('PUT', /^\/api\/users\/([^/]+)$/, ADMIN, ({ env, d, actor, req, m }) => {
  const u = d.users.find(x => x.id === rid(m)); if (!u) return fail(404, 'Usuario inexistente'); const b = req.body ?? {};
  const before = { nombre: u.name, rol: u.role, activo: u.active !== false };
  const role = b.role ?? u.role; const active = b.active ?? (u.active !== false);
  if (!['administrador', 'operador', 'consulta', 'chofer'].includes(role)) return fail(422, 'Rol inválido');
  if ((u.role === 'administrador' && (role !== 'administrador' || !active)) && d.users.filter(x => x.role === 'administrador' && x.active !== false && x.id !== u.id).length === 0) return fail(422, 'Tiene que quedar al menos un administrador activo');
  if (role === 'chofer' && !d.drivers.some(x => x.id === (b.driverId ?? u.driverId))) return fail(422, 'Un usuario chofer debe estar asociado a un chofer cargado');
  u.name = String(b.name ?? u.name).trim() || u.name; u.role = role; u.active = !!active; u.driverId = role === 'chofer' ? (b.driverId ?? u.driverId) : undefined;
  if (!active) for (const [t, s] of sessions) if (s.userId === u.id) sessions.delete(t); // cerrar sesiones de un usuario desactivado
  audit(d, actor, 'usuario', u.id, 'modificado', `Usuario ${u.name} modificado`, { before, after: { nombre: u.name, rol: u.role, activo: u.active !== false } }); env.save(); return json({ ok: true, user: safeUser(u) });
});
route('POST', /^\/api\/users\/([^/]+)\/password$/, ADMIN, async ({ env, d, actor, req, m }) => {
  const u = d.users.find(x => x.id === rid(m)); if (!u) return fail(404, 'Usuario inexistente'); const pe = passwordError(req.body?.password); if (pe) return fail(422, pe);
  Object.assign(u, await credential(String(req.body.password))); for (const [t, s] of sessions) if (s.userId === u.id) sessions.delete(t);
  audit(d, actor, 'usuario', u.id, 'contraseña restablecida', `Se restableció la contraseña de ${u.name}`); env.save(); return json({ ok: true });
});
route('POST', /^\/api\/auth\/password$/, 'any', async ({ env, d, user, actor, req }) => {
  const { current, next } = req.body ?? {}; if ((await hashPin(String(current ?? ''), user.salt, user.kdf ?? DEMO_KDF)) !== user.pinHash) return fail(422, 'La contraseña actual no es correcta');
  const pe = passwordError(next); if (pe) return fail(422, pe);
  Object.assign(user, await credential(String(next))); audit(d, actor, 'usuario', user.id, 'contraseña cambiada', `${user.name} cambió su contraseña`); env.save(); return json({ ok: true });
});

// ---- configuración
route('PUT', /^\/api\/settings$/, ADMIN, ({ env, d, actor, req }) => {
  const s = req.body as Settings; const errs: string[] = [];
  if (!s.companyName?.trim()) errs.push('El nombre de la empresa es obligatorio');
  try { new Intl.DateTimeFormat('es-AR', { timeZone: s.timezone }); } catch { errs.push('Zona horaria inválida'); }
  if (!(s.marginTarget >= -100 && s.marginTarget < 100)) errs.push('El objetivo de margen debe estar entre -100 y 100');
  if (!(s.monthlyReportDay >= 1 && s.monthlyReportDay <= 28)) errs.push('El día de generación debe estar entre 1 y 28');
  if (!(s.monthlyReportHour >= 0 && s.monthlyReportHour <= 23)) errs.push('La hora de generación debe estar entre 0 y 23');
  if (!(s.dueSoonDays >= 0 && s.dueSoonDays <= 60)) errs.push('Días de "por vencer" inválidos');
  if (!(s.defaultIvaRate >= 0 && s.defaultIvaRate <= 0.5)) errs.push('IVA inválido');
  if (!['net', 'gross'].includes(s.profitabilityBasis)) errs.push('Base de rentabilidad inválida');
  if (!(s.maxFileKb >= 100 && s.maxFileKb <= 10000)) errs.push('El límite de archivos debe estar entre 100 y 10.000 KB');
  if (!(s.deviationAlertPct >= 0)) errs.push('El umbral de desvío no puede ser negativo');
  const nums = (a: number[]) => Array.isArray(a) && a.length > 0 && a.every(x => Number.isFinite(x) && x > 0);
  if (!nums(s.docAlertDays)) errs.push('Las anticipaciones de vencimiento deben ser números positivos'); if (!nums(s.agingBuckets)) errs.push('Los tramos de antigüedad deben ser números positivos');
  if (s.paymentMethods && (!Array.isArray(s.paymentMethods) || s.paymentMethods.length === 0 || s.paymentMethods.some(x => !String(x).trim()))) errs.push('Las formas de pago no pueden estar vacías');
  if (s.fuelPricePerLiter != null && !(s.fuelPricePerLiter >= 0)) errs.push('Precio de combustible inválido');
  if (s.logoDataUrl && (!/^data:image\/(png|jpe?g);base64,/.test(s.logoDataUrl) || s.logoDataUrl.length > 700_000)) errs.push('El logo debe ser PNG o JPG de hasta 500 KB');
  const mails = (s.reportRecipients ?? []).filter(Boolean); const bad = mails.find(x => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)); if (bad) errs.push(`Destinatario inválido: ${bad}`);
  if ((s.documentTypes ?? []).some(t => !t.id || !t.label?.trim())) errs.push('Cada tipo de documento necesita nombre');
  if (errs.length) return fail(422, ...errs);
  const keys: (keyof Settings)[] = ['marginTarget', 'profitabilityBasis', 'defaultIvaRate', 'timezone', 'fuelPricePerLiter', 'deviationAlertPct', 'docAlertDays', 'agingBuckets', 'maxFileKb', 'driverPortal', 'monthlyReportDay', 'monthlyReportHour'];
  const before: Record<string, unknown> = {}, after: Record<string, unknown> = {}; for (const k of keys) if (JSON.stringify(d.settings[k]) !== JSON.stringify(s[k])) { before[k] = d.settings[k]; after[k] = s[k]; }
  if (JSON.stringify(d.settings.documentTypes) !== JSON.stringify(s.documentTypes)) { before.documentTypes = d.settings.documentTypes.map(t => t.label); after.documentTypes = s.documentTypes.map(t => t.label); }
  d.settings = { ...s, reportRecipients: mails }; audit(d, actor, 'configuración', 'empresa', 'modificada', Object.keys(after).length ? `Cambió: ${Object.keys(after).join(', ')}` : 'Se guardó la configuración', { before, after });
  env.save(); return json({ ok: true });
});

// ---- viajes
const protectTrip = (prev: Trip | undefined, t: Trip): Trip => {
  if (!prev) { delete t.budgetSnapshot; delete t.quoteId; t.incidents = []; t.timeCorrections = []; t.driverDone = null; t.reviewedAt = null; t.expenses = t.expenses.map(e => ({ ...e, status: undefined, reviewedBy: undefined, reviewedAt: undefined, rejectionReason: undefined })); return t; }
  // el presupuesto histórico, los registros del chofer y las revisiones de gastos no se modifican desde la edición general
  t.budgetSnapshot = prev.budgetSnapshot; t.quoteId = prev.quoteId; t.incidents = prev.incidents; t.timeCorrections = prev.timeCorrections; t.driverDone = prev.driverDone; t.reviewedAt = prev.reviewedAt; t.deviationNotes = prev.deviationNotes;
  const byId = new Map(prev.expenses.map(e => [e.id, e]));
  t.expenses = t.expenses.map(e => { const p = byId.get(e.id); return p ? { ...e, status: p.status, rejectionReason: p.rejectionReason, reviewedBy: p.reviewedBy, reviewedAt: p.reviewedAt, createdBy: p.createdBy, createdById: p.createdById } : { ...e, status: undefined, reviewedBy: undefined, reviewedAt: undefined, rejectionReason: undefined }; });
  // los gastos del chofer que no vengan en el cuerpo no se pueden borrar desde acá
  for (const p of prev.expenses) if (p.createdById && !t.expenses.some(e => e.id === p.id)) t.expenses.push(p);
  return t;
};
route('PUT', /^\/api\/trips\/([^/]+)$/, WRITE, ({ env, d, actor, req, m }) => {
  const id = rid(m); const prev = d.trips.find(t => t.id === id); const isNew = !prev; const now = env.now().toISOString();
  const { _reason, ...body } = req.body ?? {}; const reason = typeof _reason === 'string' ? _reason.trim() : '';
  // control de concurrencia: si el viaje cambió desde que lo cargó el usuario (otro usuario, el chofer o un proceso), no se pisa el cambio
  if (prev && typeof body.updatedAt === 'string' && body.updatedAt !== prev.updatedAt) return fail(412, 'El viaje fue modificado por otra persona o proceso mientras lo editabas. Se actualizaron los datos en pantalla: revisá y volvé a aplicar tu cambio.');
  const trip = protectTrip(prev, { ...(body as Trip), id, updatedAt: now, createdAt: prev?.createdAt ?? now });
  const v = validateTrip(trip, d, isNew); if (v.errors.length) return fail(422, ...v.errors.map(e => e.message));
  const dups = findDuplicates(trip, d.trips, d.settings.timezone);
  if (dups.length && isNew && req.query.get('confirmDuplicate') !== '1') throw new HttpError(409, [], { message: `Posible duplicado de ${dups.map(x => x.id).join(', ')}`, duplicates: dups.map(x => x.id) });
  const ch = prev ? tripChanges(prev, trip) : null;
  if (prev && prev.status === 'finalizado' && ch!.critical.length && !reason) return fail(422, `Indicá el motivo de la corrección (cambia: ${ch!.critical.join(', ')})`);
  if (prev) d.trips[d.trips.indexOf(prev)] = trip; else d.trips.push(trip);
  const refs = [trip.clientId, trip.truckId, trip.driverId];
  if (isNew) audit(d, actor, 'viaje', id, 'creado', `Viaje ${id} creado`, { refs, after: { cliente: trip.clientId, ruta: routeKey(trip), camión: trip.truckId, chofer: trip.driverId, estado: trip.status, valor: trip.serviceValue } });
  else if (ch!.names.length) audit(d, actor, 'viaje', id, 'modificado', `Viaje ${id}: cambió ${ch!.names.join(', ')}`, { refs, before: ch!.before, after: ch!.after, reason: reason || undefined });
  const sched = env.hooks.scheduleTrip(id); env.save();
  return json({ ok: true, trip, warnings: v.warnings.map(w => w.message), report: sched });
});
route('DELETE', /^\/api\/trips\/([^/]+)$/, WRITE, ({ env, d, actor, m }) => {
  const t = d.trips.find(x => x.id === rid(m)); if (!t) return fail(404, 'Viaje inexistente');
  if (d.invoices.some(i => i.lines.some(l => l.tripId === t.id))) return fail(422, 'El viaje tiene facturas asociadas: no se puede eliminar. Cancelalo en su lugar.');
  if (t.status === 'finalizado' || t.status === 'en_curso') return fail(422, 'Solo se pueden eliminar viajes planificados o cancelados. Cancelá el viaje para conservar su historial.');
  d.trips = d.trips.filter(x => x.id !== t.id); audit(d, actor, 'viaje', t.id, 'eliminado', `Viaje ${t.id} eliminado`, { before: { estado: t.status } }); env.save(); return json({ ok: true });
});
route('GET', /^\/api\/next-trip-id$/, READ, ({ env, d }) => json({ id: nextTripId(d.trips, Number(localDate(env.now(), d.settings.timezone).slice(0, 4))) }));

// revisión de gastos cargados por choferes: cambia el estado del MISMO gasto; nunca crea uno nuevo
route('POST', /^\/api\/trips\/([^/]+)\/expenses\/([^/]+)\/review$/, WRITE, ({ env, d, actor, req, m }) => {
  const t = d.trips.find(x => x.id === rid(m)); const e = t?.expenses.find(x => x.id === rid(m, 2)); if (!t || !e) return fail(404, 'Gasto inexistente');
  const { decision, reason } = req.body ?? {}; if (!['aprobado', 'rechazado'].includes(decision)) return fail(422, 'Decisión inválida');
  if (decision === 'rechazado' && !String(reason ?? '').trim()) return fail(422, 'Indicá el motivo del rechazo');
  if (e.status === decision) return json({ ok: true, unchanged: true }); // idempotente: aprobar dos veces no duplica nada
  const before = { estado: e.status ?? 'aprobado', importe: e.amount };
  e.status = decision; e.reviewedBy = actor.name; e.reviewedAt = env.now().toISOString(); e.rejectionReason = decision === 'rechazado' ? String(reason).trim() : undefined;
  t.updatedAt = env.now().toISOString();
  audit(d, actor, 'gasto', e.id, decision === 'aprobado' ? 'aprobado' : 'rechazado', `Gasto ${EXPENSE_LABEL[e.category]} de ${t.id} ${decision}`, { refs: [t.id, t.clientId, t.truckId, t.driverId], before, after: { estado: decision, importe: e.amount }, reason: e.rejectionReason });
  env.hooks.scheduleTrip(t.id); env.save(); return json({ ok: true });
});
route('POST', /^\/api\/trips\/([^/]+)\/reviewed$/, WRITE, ({ env, d, actor, req, m }) => {
  const t = d.trips.find(x => x.id === rid(m)); if (!t) return fail(404, 'Viaje inexistente');
  t.reviewedAt = req.body?.done === false ? null : env.now().toISOString(); audit(d, actor, 'viaje', t.id, 'revisión', `Revisión administrativa ${t.reviewedAt ? 'completada' : 'reabierta'}`, { refs: [t.truckId, t.driverId] }); env.save(); return json({ ok: true });
});
route('PUT', /^\/api\/trips\/([^/]+)\/deviation-notes$/, WRITE, ({ env, d, actor, req, m }) => {
  const t = d.trips.find(x => x.id === rid(m)); if (!t || !t.budgetSnapshot) return fail(404, 'El viaje no tiene presupuesto');
  const { key, text } = req.body ?? {}; if (typeof key !== 'string') return fail(422, 'Falta el indicador');
  t.deviationNotes = { ...(t.deviationNotes ?? {}) }; const old = t.deviationNotes[key]?.text ?? null;
  if (!String(text ?? '').trim()) delete t.deviationNotes[key]; else t.deviationNotes[key] = { text: String(text).trim().slice(0, 500), by: actor.name, at: env.now().toISOString() };
  audit(d, actor, 'viaje', t.id, 'explicación de desvío', `Explicación del desvío «${key}»`, { before: { texto: old }, after: { texto: text || null } }); env.save(); return json({ ok: true });
});

// ---- facturas y cobros
const touch = (env: Env, ids: string[]) => { for (const id of new Set(ids)) env.hooks.scheduleTrip(id); };
route('PUT', /^\/api\/invoices\/([^/]+)$/, WRITE, ({ env, d, actor, req, m }) => {
  const id = rid(m); const inv = { ...(req.body as Invoice), id }; const isNew = !d.invoices.some(i => i.id === id);
  const v = validateInvoice(inv, d, isNew); if (v.errors.length) return fail(422, ...v.errors.map(e => e.message));
  const prev = d.invoices.find(i => i.id === id); if (prev) d.invoices[d.invoices.indexOf(prev)] = inv; else d.invoices.push(inv);
  audit(d, actor, 'factura', inv.number, isNew ? 'creada' : 'modificada', `Factura ${inv.number} ${isNew ? 'creada' : 'modificada'}`, { refs: [inv.clientId, ...inv.lines.map(l => l.tripId)], before: prev ? { vencimiento: prev.dueDate, neto: prev.lines.reduce((s, l) => s + l.net, 0), ajustes: prev.adjustments.length } : undefined, after: { vencimiento: inv.dueDate, neto: inv.lines.reduce((s, l) => s + l.net, 0), ajustes: inv.adjustments.length } });
  touch(env, [...inv.lines.map(l => l.tripId), ...(prev?.lines.map(l => l.tripId) ?? [])]); env.save(); return json({ ok: true });
});
route('DELETE', /^\/api\/invoices\/([^/]+)$/, WRITE, ({ env, d, actor, m }) => {
  const inv = d.invoices.find(i => i.id === rid(m)); if (!inv) return fail(404, 'Factura inexistente');
  if (d.payments.some(p => p.invoiceId === inv.id)) return fail(422, 'La factura tiene cobros registrados: eliminá primero los cobros.');
  d.invoices = d.invoices.filter(i => i.id !== inv.id); audit(d, actor, 'factura', inv.number, 'eliminada', `Factura ${inv.number} eliminada`, { refs: [inv.clientId] }); touch(env, inv.lines.map(l => l.tripId)); env.save(); return json({ ok: true });
});
route('PUT', /^\/api\/payments\/([^/]+)$/, WRITE, ({ env, d, actor, req, m }) => {
  const p = { ...(req.body as Payment), id: rid(m) }; const v = validatePayment(p, d); if (v.errors.length) return fail(422, ...v.errors.map(e => e.message));
  const prev = d.payments.find(x => x.id === p.id); if (prev) d.payments[d.payments.indexOf(prev)] = p; else d.payments.push(p);
  const inv = d.invoices.find(i => i.id === p.invoiceId)!; const t = invoiceTotals(inv, d.payments, '9999-12-31', 0);
  audit(d, actor, 'cobro', inv.number, prev ? 'modificado' : 'registrado', `Cobro de ${fmtMoney(p.amount, d.settings.currency, 2)} sobre factura ${inv.number} (saldo ${fmtMoney(t.balance, d.settings.currency, 2)})`, { refs: [inv.clientId, ...inv.lines.map(l => l.tripId)], before: prev ? { importe: prev.amount } : undefined, after: { importe: p.amount, fecha: p.date, medio: p.method } });
  touch(env, inv.lines.map(l => l.tripId)); env.save(); return json({ ok: true, warnings: v.warnings.map(w => w.message) });
});
route('DELETE', /^\/api\/payments\/([^/]+)$/, WRITE, ({ env, d, actor, m }) => {
  const p = d.payments.find(x => x.id === rid(m)); if (!p) return fail(404, 'Cobro inexistente');
  d.payments = d.payments.filter(x => x.id !== p.id); const inv = d.invoices.find(i => i.id === p.invoiceId);
  audit(d, actor, 'cobro', inv?.number ?? p.invoiceId, 'eliminado', `Cobro eliminado (${fmtMoney(p.amount, d.settings.currency, 2)})`, { refs: inv ? [inv.clientId] : [], before: { importe: p.amount, fecha: p.date } }); if (inv) touch(env, inv.lines.map(l => l.tripId)); env.save(); return json({ ok: true });
});

// ---- flota, clientes y choferes
route('PUT', /^\/api\/trucks\/([^/]+)$/, WRITE, ({ env, d, actor, req, m }) => {
  const t = { ...(req.body as Truck), id: rid(m) }; const errs: string[] = [];
  if (!t.name?.trim()) errs.push('Falta el nombre del camión'); if (!t.plate?.trim()) errs.push('Falta la patente');
  if (d.trucks.some(x => x.id !== t.id && x.plate.replace(/\s/g, '').toLowerCase() === t.plate.replace(/\s/g, '').toLowerCase())) errs.push('Ya existe un camión con esa patente');
  errs.push(...paramsError(t.params)); if (t.params.fuelLPer100km != null && !(t.params.fuelLPer100km >= 0)) errs.push('Consumo de combustible inválido');
  if (t.odometerKm != null && !(t.odometerKm >= 0)) errs.push('Kilometraje inválido');
  for (const f of t.monthlyFixedCosts) if (!(f.amount >= 0)) errs.push(`Costo mensual inválido: ${f.label}`);
  for (const p of t.servicePlans) { if (!p.name.trim()) errs.push('Un servicio no tiene nombre'); if (p.intervalKm != null && !(p.intervalKm > 0)) errs.push(`Intervalo en km inválido: ${p.name}`); if (p.intervalDays != null && !(p.intervalDays > 0)) errs.push(`Intervalo en días inválido: ${p.name}`); }
  if (errs.length) return fail(422, ...errs);
  const prev = d.trucks.find(x => x.id === t.id); const today = localDate(env.now(), d.settings.timezone);
  const paramsChanged = !!prev && JSON.stringify({ ...prev.params, updatedAt: 0 }) !== JSON.stringify({ ...t.params, updatedAt: 0 });
  const fixedChanged = !!prev && JSON.stringify(prev.monthlyFixedCosts) !== JSON.stringify(t.monthlyFixedCosts);
  if (paramsChanged) t.params.updatedAt = today; if (!t.params.updatedAt) t.params.updatedAt = today;
  if (prev) d.trucks[d.trucks.indexOf(prev)] = t; else d.trucks.push(t);
  if (!prev) audit(d, actor, 'camión', t.id, 'creado', `${t.name} creado`, { refs: [t.id] });
  else if (paramsChanged || fixedChanged) audit(d, actor, 'camión', t.id, 'parámetros de costos', `Parámetros de costos de ${t.name} modificados (no alteran presupuestos históricos)`, { refs: [t.id], before: { params: prev.params, costosMensuales: prev.monthlyFixedCosts }, after: { params: t.params, costosMensuales: t.monthlyFixedCosts } });
  env.save(); return json({ ok: true, truck: t });
});
route('PUT', /^\/api\/clients\/([^/]+)$/, WRITE, ({ env, d, actor, req, m }) => {
  const c = { ...(req.body as Client), id: rid(m) }; if (!c.name?.trim()) return fail(422, 'Falta el nombre del cliente');
  if (!(c.paymentTermDays >= 0 && c.paymentTermDays <= 365)) return fail(422, 'Plazo de pago inválido');
  for (const k of c.contacts ?? []) if (k.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(k.email)) return fail(422, `Correo inválido: ${k.email}`);
  const prev = d.clients.find(x => x.id === c.id); if (prev) d.clients[d.clients.indexOf(prev)] = c; else d.clients.push(c);
  audit(d, actor, 'cliente', c.id, prev ? 'modificado' : 'creado', `Cliente ${c.name} ${prev ? 'modificado' : 'creado'}`, { refs: [c.id], before: prev ? { plazo: prev.paymentTermDays, cuit: prev.cuit } : undefined, after: { plazo: c.paymentTermDays, cuit: c.cuit } }); env.save(); return json({ ok: true, client: c });
});
route('PUT', /^\/api\/drivers\/([^/]+)$/, WRITE, ({ env, d, actor, req, m }) => {
  const c = { id: rid(m), name: String(req.body?.name ?? '') }; if (!c.name.trim()) return fail(422, 'Falta el nombre del chofer');
  const prev = d.drivers.find(x => x.id === c.id); if (prev) d.drivers[d.drivers.indexOf(prev)] = c; else d.drivers.push(c);
  audit(d, actor, 'chofer', c.id, prev ? 'modificado' : 'creado', `Chofer ${c.name}`, { refs: [c.id] }); env.save(); return json({ ok: true, driver: c });
});

// ---- importación (el servidor es la fuente de verdad)
route('POST', /^\/api\/import\/trips$/, WRITE, ({ env, d, actor, req }) => {
  const { rows, map, commit } = req.body as { rows: string[][]; map: Record<string, number>; commit: boolean };
  if (!Array.isArray(rows) || rows.length < 2) return fail(422, 'El archivo no tiene filas de datos');
  const missing = IMPORT_FIELDS.filter(f => f.required && !(map[f.key] >= 0)).map(f => f.label); if (missing.length) return fail(422, `Falta asignar columnas obligatorias: ${missing.join(', ')}`);
  const year = Number(localDate(env.now(), d.settings.timezone).slice(0, 4));
  const result = mapRows(rows, map, d, env.now().toISOString(), ex => nextTripId(ex, year)); if (!commit) return json({ result });
  let created = 0; const nc = new Map<string, string>(), nd = new Map<string, string>();
  for (const r of result.rows) { if (!r.trip) continue; const t = r.trip;
    if (t.clientId.startsWith('new:')) { const n = t.clientId.slice(4); if (!nc.has(n)) { const id = `C${d.clients.length + 1 + nc.size}`; nc.set(n, id); d.clients.push({ id, name: n, cuit: '', paymentTermDays: 30 }); } t.clientId = nc.get(n)!; }
    if (t.driverId.startsWith('new:')) { const n = t.driverId.slice(4); if (!nd.has(n)) { const id = `D${d.drivers.length + 1 + nd.size}`; nd.set(n, id); d.drivers.push({ id, name: n }); } t.driverId = nd.get(n)!; }
    t.expenses = t.expenses.map(e => ({ ...e, id: uid() })); d.trips.push(t); created++; env.hooks.scheduleTrip(t.id); }
  audit(d, actor, 'importación', 'viajes', 'importados', `${created} viajes importados, ${result.rejected} filas rechazadas`, { after: { creados: created, rechazados: result.rejected } }); env.save(); return json({ result, created });
});

// ---- informes
route('POST', /^\/api\/trips\/([^/]+)\/reports$/, WRITE, ({ env, req, m }) => json(env.hooks.scheduleTrip(rid(m), { force: !!req.body?.force })));
route('POST', /^\/api\/reports\/trip\/([^/]+)\/retry$/, WRITE, ({ env, m }) => { const r = env.hooks.retryTrip(rid(m)); return r ? json({ report: r }) : fail(404, 'Informe inexistente'); });
route('POST', /^\/api\/reports\/monthly$/, WRITE, ({ env, req }) => { const month = String(req.body?.month ?? ''); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail(422, 'Mes inválido'); return json(env.hooks.scheduleMonthly(month, 'manual')); });
route('POST', /^\/api\/reports\/monthly\/([^/]+)\/retry$/, WRITE, ({ env, m }) => { const r = env.hooks.retryMonthly(rid(m)); return r ? json({ report: r }) : fail(404, 'Informe inexistente'); });
route('POST', /^\/api\/emails\/([^/]+)\/retry$/, WRITE, ({ env, m }) => { const r = env.hooks.retryEmail(rid(m)); return r ? json({ email: r }) : fail(404, 'Correo inexistente'); });
const pdfRes = (f: { name: string; bytes: Uint8Array } | null, inline: boolean): Res => f ? { status: 200, file: { name: f.name, mime: 'application/pdf', bytes: f.bytes, inline } } : { status: 501, body: { errors: ['Este entorno no genera PDF: usá la vista en pantalla'] } };
route('GET', /^\/api\/reports\/trip\/([^/]+)\/file$/, READ, ({ env, d, req, m }) => {
  const r = d.tripReports.find(x => x.id === rid(m)); if (!r || r.status !== 'disponible' || !r.fileName) return fail(404, 'Informe no disponible');
  const b = env.hooks.getReport(r.fileName); return b ? { status: 200, file: { name: r.fileName, mime: 'application/pdf', bytes: b, inline: req.query.get('download') !== '1' } } : pdfRes(null, true);
});
route('GET', /^\/api\/reports\/monthly\/([^/]+)\/file$/, READ, ({ env, d, req, m }) => {
  const r = d.monthlyReports.find(x => x.id === rid(m)); if (!r || r.status !== 'disponible' || !r.fileName) return fail(404, 'Informe no disponible');
  const b = env.hooks.getReport(r.fileName); return b ? { status: 200, file: { name: r.fileName, mime: 'application/pdf', bytes: b, inline: req.query.get('download') !== '1' } } : pdfRes(null, true);
});
route('GET', /^\/api\/trips\/([^/]+)\/preview\.pdf$/, READ, async ({ env, req, m }) => pdfRes(await env.hooks.render('trip_preview', { tripId: rid(m) }), req.query.get('download') !== '1'));
route('GET', /^\/api\/reports\/monthly\/preview\.pdf$/, READ, async ({ env, req }) => { const month = req.query.get('month') ?? ''; if (!/^\d{4}-\d{2}$/.test(month)) return fail(422, 'Mes inválido'); return pdfRes(await env.hooks.render('monthly_preview', { month }), req.query.get('download') !== '1'); });

// ---- archivos y comprobantes (privados: toda lectura pasa por acá)
const KINDS: AttachKind[] = ['viaje', 'gasto', 'factura', 'cliente', 'camion', 'chofer', 'documento', 'cotizacion', 'empresa'];
const entityExists = (d: CompanyData, type: AttachKind, id: string): boolean => type === 'viaje' ? d.trips.some(t => t.id === id) : type === 'gasto' ? d.trips.some(t => t.expenses.some(e => e.id === id)) : type === 'factura' ? d.invoices.some(i => i.id === id)
  : type === 'cliente' ? d.clients.some(c => c.id === id) : type === 'camion' ? d.trucks.some(t => t.id === id) : type === 'chofer' ? d.drivers.some(x => x.id === id) : type === 'documento' ? d.documents.some(x => x.id === id) : type === 'cotizacion' ? d.quotes.some(q => q.id === id) : id === 'empresa';
route('POST', /^\/api\/files$/, WRITE, ({ env, d, user, actor, req }) => {
  const { entityType, entityId } = req.body ?? {}; if (!KINDS.includes(entityType) || !entityExists(d, entityType, String(entityId))) return fail(422, 'La entidad relacionada no existe');
  const links = (Array.isArray(req.body.links) ? req.body.links : []).filter((l: any) => KINDS.includes(l?.type) && entityExists(d, l.type, String(l.id)));
  const f = storeFile(env, user, req.body, entityType, String(entityId), links);
  audit(d, actor, 'comprobante', f.id, 'cargado', `Archivo «${f.name}» vinculado a ${entityType} ${entityId}`, { refs: [String(entityId), ...links.map((l: any) => l.id)], after: { nombre: f.name, tipo: f.mime, tamaño: f.size } }); env.save(); return json({ ok: true, file: f });
});
route('POST', /^\/api\/files\/([^/]+)\/link$/, WRITE, ({ env, d, actor, req, m }) => {
  const f = d.files.find(x => x.id === rid(m)); if (!f) return fail(404, 'Archivo inexistente'); const { type, id } = req.body ?? {};
  if (!KINDS.includes(type) || !entityExists(d, type, String(id))) return fail(422, 'La entidad relacionada no existe');
  if (!f.links.some(l => l.type === type && l.id === id) && !(f.entityType === type && f.entityId === id)) f.links.push({ type, id: String(id) });
  audit(d, actor, 'comprobante', f.id, 'vinculado', `Archivo «${f.name}» vinculado también a ${type} ${id}`, { refs: [String(id), f.entityId] }); env.save(); return json({ ok: true, file: f });
});
route('DELETE', /^\/api\/files\/([^/]+)$/, WRITE, ({ env, d, actor, m }) => {
  const f = d.files.find(x => x.id === rid(m)); if (!f) return fail(404, 'Archivo inexistente');
  if (d.documents.some(x => x.fileId === f.id)) return fail(422, 'El archivo respalda un documento: reemplazá el documento en su ficha.');
  d.files = d.files.filter(x => x.id !== f.id); env.hooks.delFile(f.id); audit(d, actor, 'comprobante', f.id, 'eliminado', `Archivo «${f.name}» eliminado`, { refs: [f.entityId] }); env.save(); return json({ ok: true });
});
route('GET', /^\/api\/files\/([^/]+)$/, 'any', ({ env, d, user, req, m }) => {
  const f = d.files.find(x => x.id === rid(m)); if (!f || !canReadFile(d, user, f)) return fail(404, 'Archivo inexistente'); // 404 y no 403: no revela que existe
  const b = env.hooks.getFile(f.id); if (!b) return fail(404, 'El contenido no está disponible');
  return { status: 200, file: { name: f.name, mime: f.mime, bytes: b, inline: req.query.get('download') !== '1' } };
});

// ---- cotizaciones
const today = (env: Env) => localDate(env.now(), env.data().settings.timezone);
const qView = (env: Env, q: Quote) => ({ ...q, calc: quoteCalc(q), effectiveStatus: quoteStatus(q, today(env)) });
route('POST', /^\/api\/quotes\/suggest$/, WRITE, ({ env, d, req }) => { const b = req.body ?? {}; return json({ costs: suggestCosts(d, { truckId: b.truckId || null, origin: String(b.origin ?? ''), destination: String(b.destination ?? ''), kmLoaded: b.kmLoaded ?? null, kmEmpty: b.kmEmpty ?? null }, env.now()) }); });
route('GET', /^\/api\/next-quote-number$/, WRITE, ({ env, d }) => json({ number: nextQuoteNumber(d.quotes, Number(today(env).slice(0, 4))) }));
route('PUT', /^\/api\/quotes\/([^/]+)$/, WRITE, ({ env, d, actor, req, m }) => {
  const id = rid(m); const prev = d.quotes.find(q => q.id === id); const now = env.now().toISOString();
  if (prev && (prev.status === 'aceptada' || prev.tripId)) return fail(422, 'Una cotización aceptada no se modifica: duplicala para hacer una nueva propuesta.');
  const b = req.body as Quote; const q: Quote = { ...b, id, number: prev?.number || b.number || nextQuoteNumber(d.quotes, Number(today(env).slice(0, 4))), status: prev?.status ?? 'borrador', shares: prev?.shares ?? [], acceptance: prev?.acceptance ?? null, rejection: prev?.rejection ?? null, tripId: prev?.tripId ?? null, createdAt: prev?.createdAt ?? now, updatedAt: now, createdBy: prev?.createdBy ?? actor.name };
  if (!prev && d.quotes.some(x => x.number === q.number)) q.number = nextQuoteNumber(d.quotes, Number(today(env).slice(0, 4)));
  if (prev && prev.status === 'rechazada') return fail(422, 'La cotización fue rechazada; duplicala para una nueva propuesta.');
  const errs = validateQuote(q, d); if (errs.length) return fail(422, ...errs);
  if (prev) d.quotes[d.quotes.indexOf(prev)] = q; else d.quotes.push(q);
  const c = quoteCalc(q), pc = prev ? quoteCalc(prev) : null;
  audit(d, actor, 'cotización', q.id, prev ? 'modificada' : 'creada', `Cotización ${q.number} ${prev ? 'modificada' : 'creada'}: precio neto ${fmtMoney(c.priceNet, d.settings.currency)}`, { refs: [q.clientId], before: pc ? { costo: pc.cost, precio: pc.priceNet, margen: pc.marginPct, margenObjetivo: prev!.marginTarget } : undefined, after: { costo: c.cost, precio: c.priceNet, margen: c.marginPct, margenObjetivo: q.marginTarget } });
  env.save(); return json({ ok: true, quote: qView(env, q) });
});
route('DELETE', /^\/api\/quotes\/([^/]+)$/, WRITE, ({ env, d, actor, m }) => {
  const q = d.quotes.find(x => x.id === rid(m)); if (!q) return fail(404, 'Cotización inexistente'); if (q.status !== 'borrador') return fail(422, 'Solo se pueden eliminar borradores');
  d.quotes = d.quotes.filter(x => x.id !== q.id); audit(d, actor, 'cotización', q.id, 'eliminada', `Borrador ${q.number} eliminado`, { refs: [q.clientId] }); env.save(); return json({ ok: true });
});
route('POST', /^\/api\/quotes\/([^/]+)\/duplicate$/, WRITE, ({ env, d, actor, m }) => {
  const src = d.quotes.find(x => x.id === rid(m)); if (!src) return fail(404, 'Cotización inexistente'); const now = env.now().toISOString();
  const q: Quote = { ...clone(src), id: uid(), number: nextQuoteNumber(d.quotes, Number(today(env).slice(0, 4))), status: 'borrador', shares: [], acceptance: null, rejection: null, tripId: null, duplicatedFrom: src.id, validUntil: addDays(today(env), d.settings.quoteValidityDays), createdAt: now, updatedAt: now, createdBy: actor.name };
  d.quotes.push(q); audit(d, actor, 'cotización', q.id, 'duplicada', `Cotización ${q.number} creada a partir de ${src.number}`, { refs: [q.clientId, src.id] }); env.save(); return json({ ok: true, quote: qView(env, q) });
});
route('POST', /^\/api\/quotes\/([^/]+)\/share$/, WRITE, ({ env, d, actor, req, m }) => {
  const q = d.quotes.find(x => x.id === rid(m)); if (!q) return fail(404, 'Cotización inexistente'); if (q.status === 'aceptada' || q.status === 'rechazada') return fail(422, 'La cotización ya tiene una respuesta registrada');
  const { channel, note, at } = req.body ?? {}; if (!String(channel ?? '').trim()) return fail(422, 'Indicá el canal por el que se compartió');
  const when = at ? new Date(at) : env.now(); if (Number.isNaN(when.getTime())) return fail(422, 'Fecha inválida');
  q.shares.push({ id: uid(), at: when.toISOString(), channel: String(channel).trim(), by: actor.name, note: String(note ?? '').slice(0, 300) }); const was = q.status; q.status = 'enviada'; q.updatedAt = env.now().toISOString();
  audit(d, actor, 'cotización', q.id, 'compartida', `Cotización ${q.number} registrada como compartida por ${channel}`, { refs: [q.clientId], before: { estado: was }, after: { estado: 'enviada', canal: channel, fecha: when.toISOString() } }); env.save(); return json({ ok: true, quote: qView(env, q) });
});
route('POST', /^\/api\/quotes\/([^/]+)\/accept$/, WRITE, ({ env, d, actor, req, m }) => {
  const q = d.quotes.find(x => x.id === rid(m)); if (!q) return fail(404, 'Cotización inexistente');
  if (q.status === 'aceptada') return json({ ok: true, quote: qView(env, q), unchanged: true }); if (q.status === 'rechazada') return fail(422, 'La cotización fue rechazada');
  q.acceptance = { at: env.now().toISOString(), by: actor.name, note: String(req.body?.note ?? '').slice(0, 300) || 'Aceptación registrada manualmente' }; const was = q.status; q.status = 'aceptada'; q.updatedAt = q.acceptance.at;
  audit(d, actor, 'cotización', q.id, 'aceptada', `Aceptación de ${q.number} registrada manualmente por ${actor.name}`, { refs: [q.clientId], before: { estado: was }, after: { estado: 'aceptada' }, reason: q.acceptance.note }); env.save(); return json({ ok: true, quote: qView(env, q) });
});
route('POST', /^\/api\/quotes\/([^/]+)\/reject$/, WRITE, ({ env, d, actor, req, m }) => {
  const q = d.quotes.find(x => x.id === rid(m)); if (!q) return fail(404, 'Cotización inexistente'); if (q.status === 'aceptada') return fail(422, 'La cotización ya fue aceptada');
  const reason = String(req.body?.reason ?? '').trim(); if (!reason) return fail(422, 'Indicá el motivo del rechazo');
  q.rejection = { at: env.now().toISOString(), by: actor.name, reason }; const was = q.status; q.status = 'rechazada'; q.updatedAt = q.rejection.at;
  audit(d, actor, 'cotización', q.id, 'rechazada', `Cotización ${q.number} rechazada`, { refs: [q.clientId], before: { estado: was }, after: { estado: 'rechazada' }, reason }); env.save(); return json({ ok: true, quote: qView(env, q) });
});
route('POST', /^\/api\/quotes\/([^/]+)\/convert$/, WRITE, ({ env, d, actor, req, m }) => {
  const q = d.quotes.find(x => x.id === rid(m)); if (!q) return fail(404, 'Cotización inexistente');
  if (q.tripId) return json({ ok: true, tripId: q.tripId, unchanged: true }); // idempotente: no crea un segundo viaje
  if (q.status !== 'aceptada') return fail(422, 'Solo una cotización aceptada se convierte en viaje');
  const b = req.body ?? {}; const truckId = b.truckId || q.truckId; const driverId = b.driverId;
  if (!truckId || !d.trucks.some(t => t.id === truckId)) return fail(422, 'Asigná un vehículo para crear el viaje'); if (!driverId || !d.drivers.some(x => x.id === driverId)) return fail(422, 'Asigná un chofer para crear el viaje');
  const c = quoteCalc(q); const now = env.now().toISOString(); const id = nextTripId(d.trips, Number(today(env).slice(0, 4)));
  const trip: Trip = { id, clientId: q.clientId, origin: q.origin, destination: q.destination, truckId, driverId, status: 'planificado', plannedDeparture: b.plannedDeparture ?? null, plannedArrival: b.plannedArrival ?? null,
    actualDeparture: null, actualArrival: null, kmLoaded: q.kmLoaded, kmEmpty: q.kmEmpty, odometerStart: null, odometerEnd: null, serviceValue: c.priceNet, ivaRate: q.ivaRate, expenses: [], expenseConfirmed: {},
    notes: q.notes, instructions: String(b.instructions ?? ''), quoteId: q.id, budgetSnapshot: snapshotFromQuote({ ...q, truckId }, d, q.acceptance?.at ?? now, q.acceptance?.by ?? actor.name), createdAt: now, updatedAt: now };
  const v = validateTrip(trip, d, true); if (v.errors.length) return fail(422, ...v.errors.map(e => e.message));
  d.trips.push(trip); q.tripId = id; q.updatedAt = now;
  audit(d, actor, 'viaje', id, 'creado', `Viaje ${id} creado desde la cotización ${q.number}`, { refs: [q.clientId, truckId, driverId, q.id], after: { cotización: q.number, precio: c.priceNet, camión: truckId, chofer: driverId } });
  audit(d, actor, 'cotización', q.id, 'convertida', `Cotización ${q.number} convertida en el viaje ${id}`, { refs: [q.clientId, id] });
  env.hooks.scheduleTrip(id); env.save(); return json({ ok: true, tripId: id, warnings: v.warnings.map(w => w.message) });
});
route('GET', /^\/api\/quotes\/([^/]+)\/pdf$/, READ, async ({ env, req, m }) => pdfRes(await env.hooks.render('quote', { quoteId: rid(m) }), req.query.get('download') !== '1'));

// ---- documentación y vencimientos
route('PUT', /^\/api\/documents\/([^/]+)$/, WRITE, ({ env, d, actor, req, m }) => {
  const id = rid(m); const b = req.body as Doc; const prev = d.documents.find(x => x.id === id); const type = d.settings.documentTypes.find(t => t.id === b.typeId);
  const errs: string[] = []; if (!type) errs.push('Tipo de documento inexistente');
  if (type && type.ownerType !== b.ownerType) errs.push('El tipo de documento no corresponde a ese titular');
  const owners = b.ownerType === 'empresa' ? ['empresa'] : b.ownerType === 'vehiculo' ? d.trucks.map(t => t.id) : d.drivers.map(x => x.id); if (!owners.includes(b.ownerId)) errs.push('Titular inexistente');
  if (!String(b.identifier ?? '').trim()) errs.push('Indicá el identificador del documento');
  if (type?.hasExpiry && !b.expiryDate) errs.push('Este tipo de documento requiere fecha de vencimiento');
  if (b.issueDate && b.expiryDate && b.expiryDate < b.issueDate) errs.push('El vencimiento es anterior a la emisión');
  if (b.fileId && !d.files.some(f => f.id === b.fileId)) errs.push('El archivo adjunto no existe');
  if (errs.length) return fail(422, ...errs);
  const doc: Doc = { id, typeId: b.typeId, ownerType: b.ownerType, ownerId: b.ownerId, identifier: b.identifier.trim(), issueDate: b.issueDate || null, expiryDate: b.expiryDate || null, fileId: b.fileId || null, notes: String(b.notes ?? '').slice(0, 500), replacedBy: prev?.replacedBy ?? null, supersedes: prev?.supersedes ?? null, createdAt: prev?.createdAt ?? env.now().toISOString(), createdBy: prev?.createdBy ?? actor.name };
  let replaced: Doc | undefined;
  if (!prev && req.body.replaces) { replaced = d.documents.find(x => x.id === req.body.replaces && !x.replacedBy && x.ownerId === doc.ownerId && x.typeId === doc.typeId); if (replaced) { doc.supersedes = replaced.id; replaced.replacedBy = doc.id; } }
  if (prev) d.documents[d.documents.indexOf(prev)] = doc; else d.documents.push(doc);
  if (doc.fileId) { const f = d.files.find(x => x.id === doc.fileId)!; if (!f.links.some(l => l.type === 'documento' && l.id === doc.id) && !(f.entityType === 'documento' && f.entityId === doc.id)) f.links.push({ type: 'documento', id: doc.id }); }
  audit(d, actor, 'documento', doc.id, prev ? 'modificado' : replaced ? 'reemplazado' : 'cargado', `${type!.label} de ${doc.ownerType === 'empresa' ? d.settings.companyName : doc.ownerId}: ${doc.identifier}${replaced ? ` (reemplaza a ${replaced.identifier}, que se conserva en el historial)` : ''}`, { refs: [doc.ownerId], before: prev ? { vencimiento: prev.expiryDate, identificador: prev.identifier } : replaced ? { vencimiento: replaced.expiryDate, identificador: replaced.identifier } : undefined, after: { vencimiento: doc.expiryDate, identificador: doc.identifier } });
  env.save(); return json({ ok: true, doc });
});
route('DELETE', /^\/api\/documents\/([^/]+)$/, ADMIN, ({ env, d, actor, req, m }) => {
  const doc = d.documents.find(x => x.id === rid(m)); if (!doc) return fail(404, 'Documento inexistente'); const reason = String(req.body?.reason ?? '').trim(); if (!reason) return fail(422, 'Indicá el motivo de la eliminación');
  d.documents = d.documents.filter(x => x.id !== doc.id); const old = d.documents.find(x => x.replacedBy === doc.id); if (old) old.replacedBy = null;
  audit(d, actor, 'documento', doc.id, 'eliminado', `Documento ${doc.identifier} eliminado`, { refs: [doc.ownerId], reason }); env.save(); return json({ ok: true });
});

// ---- cobranzas
route('POST', /^\/api\/clients\/([^/]+)\/collections$/, WRITE, ({ env, d, actor, req, m }) => {
  const c = d.clients.find(x => x.id === rid(m)); if (!c) return fail(404, 'Cliente inexistente'); const b = req.body ?? {};
  if (!String(b.channel ?? '').trim()) return fail(422, 'Indicá el canal de contacto'); if (!String(b.note ?? '').trim()) return fail(422, 'Escribí una observación');
  if (b.promise && (!b.promise.date || (b.promise.amount != null && !(b.promise.amount > 0)))) return fail(422, 'El compromiso de pago necesita fecha e importe válido');
  const a: CollectionAction = { id: uid(), clientId: c.id, at: b.at ? new Date(b.at).toISOString() : env.now().toISOString(), by: actor.name, channel: String(b.channel).trim(), note: String(b.note).trim().slice(0, 600),
    promise: b.promise ? { date: b.promise.date, amount: b.promise.amount ?? null, status: 'pendiente' } : null, nextAction: b.nextAction?.text ? { date: b.nextAction.date, text: String(b.nextAction.text).slice(0, 200) } : null };
  d.collections.push(a); audit(d, actor, 'gestión de cobro', a.id, 'registrada', `Gestión con ${c.name} por ${a.channel}${a.promise ? `; compromiso de pago al ${a.promise.date}` : ''}`, { refs: [c.id], after: { canal: a.channel, compromiso: a.promise } }); env.save(); return json({ ok: true, action: a });
});
route('PUT', /^\/api\/collections\/([^/]+)\/promise$/, WRITE, ({ env, d, actor, req, m }) => {
  const a = d.collections.find(x => x.id === rid(m)); if (!a?.promise) return fail(404, 'Compromiso inexistente'); const st = req.body?.status; if (!['pendiente', 'cumplido', 'incumplido'].includes(st)) return fail(422, 'Estado inválido');
  const was = a.promise.status; a.promise.status = st; audit(d, actor, 'gestión de cobro', a.id, 'compromiso', `Compromiso de pago marcado ${st}`, { refs: [a.clientId], before: { estado: was }, after: { estado: st } }); env.save(); return json({ ok: true });
});
const reminderDraft = (d: CompanyData, c: Client, asof: string) => {
  const acc = clientAccount(d, c.id, asof, `${asof.slice(0, 7)}-01`, asof); const $ = (v: number) => fmtMoney(v, d.settings.currency, 2);
  const open = d.invoices.filter(i => i.clientId === c.id).map(i => ({ i, t: invoiceTotals(i, d.payments, asof, d.settings.dueSoonDays) })).filter(x => x.t.balance > 0.005 && x.t.status === 'vencida');
  const to = (c.contacts ?? []).map(k => k.email).filter(Boolean);
  const body = `Hola${c.contacts?.[0] ? ` ${c.contacts[0].name.split(' ')[0]}` : ''},\n\nTe escribimos de ${d.settings.companyName} para recordarte que al ${fmtDate(asof)} figuran facturas vencidas por ${$(acc.overdue)}:\n\n${open.map(x => `- Factura ${x.i.number}: venció el ${fmtDate(x.i.dueDate)}, saldo ${$(x.t.balance)}`).join('\n') || '- (sin facturas vencidas)'}\n\nSaldo total pendiente: ${$(acc.pending)}.\nSi ya realizaron el pago, por favor envíennos el comprobante para aplicarlo. Adjuntamos el estado de cuenta.\n\nSaludos,\n${d.settings.companyName}`;
  return { to, subject: `Recordatorio de pago · ${d.settings.companyName}`, body, overdue: acc.overdue };
};
route('GET', /^\/api\/clients\/([^/]+)\/reminder-draft$/, READ, ({ env, d, req, m }) => { const c = d.clients.find(x => x.id === rid(m)); if (!c) return fail(404, 'Cliente inexistente'); return json(reminderDraft(d, c, req.query.get('asof') || today(env))); });
route('GET', /^\/api\/clients\/([^/]+)\/statement\.pdf$/, READ, async ({ env, d, req, m }) => { if (!d.clients.some(x => x.id === rid(m))) return fail(404, 'Cliente inexistente'); return pdfRes(await env.hooks.render('statement', { clientId: rid(m), asof: req.query.get('asof') || today(env) }), req.query.get('download') !== '1'); });
/** Registra un mensaje. Solo se envía por correo con una acción explícita (send=true) y SMTP configurado; el resultado queda registrado tal cual. */
route('POST', /^\/api\/clients\/([^/]+)\/messages$/, WRITE, async ({ env, d, actor, req, m }) => {
  const c = d.clients.find(x => x.id === rid(m)); if (!c) return fail(404, 'Cliente inexistente'); const b = req.body ?? {};
  if (!['correo', 'whatsapp', 'otro'].includes(b.channel)) return fail(422, 'Canal inválido'); if (!String(b.body ?? '').trim()) return fail(422, 'El mensaje está vacío');
  const to = String(b.to ?? '').split(/[,;\s]+/).filter(Boolean); if (b.channel === 'correo' && b.send && (!to.length || to.some(x => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))) return fail(422, 'Indicá destinatarios de correo válidos');
  const msg: SentMessageLike = { id: uid(), clientId: c.id, kind: b.kind === 'estado_cuenta' ? 'estado_cuenta' : 'recordatorio', channel: b.channel, at: env.now().toISOString(), by: actor.name, to: to.join(', '), subject: String(b.subject ?? '').slice(0, 200), body: String(b.body).slice(0, 4000), result: 'manual', detail: 'Registrado como enviado manualmente por el usuario (RUMBO no lo envió)' };
  if (b.channel === 'correo' && b.send) { const r = await env.hooks.mail(to, msg.subject, msg.body); msg.result = r.status; msg.detail = r.detail; }
  else if (b.registerOnly !== true && b.channel === 'correo') { msg.result = 'pendiente'; msg.detail = 'Borrador guardado: no se envió'; }
  d.messages.unshift(msg); audit(d, actor, 'mensaje', msg.id, 'registrado', `${msg.kind === 'recordatorio' ? 'Recordatorio' : 'Estado de cuenta'} a ${c.name} por ${msg.channel}: ${msg.result}`, { refs: [c.id], after: { canal: msg.channel, resultado: msg.result } }); env.save(); return json({ ok: true, message: msg });
});
type SentMessageLike = CompanyData['messages'][number];

// ---- portal del chofer (la autorización se aplica en cada ruta: solo viajes asignados al chofer autenticado)
const DRV: Role[] = ['chofer'];
const myTrip = (d: CompanyData, u: User, id: string): Trip => { const t = d.trips.find(x => x.id === id && x.driverId === u.driverId); if (!t) return fail(404, 'Viaje inexistente'); return t; };
const dRefs = (t: Trip) => [t.clientId, t.truckId, t.driverId];
route('GET', /^\/api\/driver\/trips$/, DRV, ({ env, d, user }) => {
  const today0 = Date.now() - 7 * 86400_000;
  const list = d.trips.filter(t => t.driverId === user.driverId && t.status !== 'cancelado' && (t.status !== 'finalizado' || new Date(t.actualArrival ?? t.updatedAt).getTime() > today0)).sort((a, b) => (a.plannedDeparture ?? a.actualDeparture ?? '').localeCompare(b.plannedDeparture ?? b.actualDeparture ?? ''));
  return json({ trips: list.map(t => driverTrip(d, t)), driver: d.drivers.find(x => x.id === user.driverId)?.name, now: env.now().toISOString(), tz: d.settings.timezone });
});
route('GET', /^\/api\/driver\/trips\/([^/]+)$/, DRV, ({ d, user, m }) => json({ trip: driverTrip(d, myTrip(d, user, rid(m))) }));
const when = (env: Env, at: unknown, reason: unknown, what: string): { iso: string; custom: boolean; reason: string } => {
  const now = env.now(); const t = at ? new Date(String(at)) : now; if (Number.isNaN(t.getTime())) return fail(422, 'Fecha u hora inválida');
  if (t.getTime() > now.getTime() + 5 * 60_000) return fail(422, 'La hora no puede ser futura');
  const custom = Math.abs(t.getTime() - now.getTime()) > 5 * 60_000; const r = String(reason ?? '').trim();
  if (custom && !r) return fail(422, `Si registrás ${what} con una hora distinta de la actual, indicá el motivo`);
  return { iso: t.toISOString(), custom, reason: r };
};
const logTime = (d: CompanyData, t: Trip, field: 'actualDeparture' | 'actualArrival', iso: string, reason: string, a: Actor, env: Env) => {
  t.timeCorrections = t.timeCorrections ?? []; const old = t[field];
  if (old || reason) t.timeCorrections.push({ id: uid(), field, oldValue: old, newValue: iso, reason: reason || 'Corrección', by: a.name, at: env.now().toISOString() });
  t[field] = iso; t.updatedAt = env.now().toISOString();
  audit(d, a, 'viaje', t.id, old ? 'horario corregido' : 'horario registrado', `${field === 'actualDeparture' ? 'Salida' : 'Llegada'} real de ${t.id}: ${iso}`, { refs: dRefs(t), before: old ? { [field]: old } : undefined, after: { [field]: iso }, reason: reason || undefined });
};
route('POST', /^\/api\/driver\/trips\/([^/]+)\/depart$/, DRV, ({ env, d, user, actor, req, m }) => {
  const t = myTrip(d, user, rid(m)); if (t.status === 'finalizado' || t.status === 'cancelado') return fail(422, 'El viaje ya no admite salida');
  const w = when(env, req.body?.at, req.body?.reason, 'la salida'); if (t.actualDeparture && !w.reason) return fail(422, 'La salida ya está registrada: para cambiarla indicá el motivo');
  const was = t.status; logTime(d, t, 'actualDeparture', w.iso, w.reason, actor, env); t.status = 'en_curso';
  if (req.body?.odometer != null) { const o = Number(req.body.odometer); if (!(o >= 0)) return fail(422, 'Odómetro inválido'); t.odometerStart = o; }
  if (was !== t.status) audit(d, actor, 'viaje', t.id, 'estado', `Viaje ${t.id} en curso`, { refs: dRefs(t), before: { estado: was }, after: { estado: 'en_curso' } });
  env.hooks.scheduleTrip(t.id); env.save(); return json({ ok: true, trip: driverTrip(d, t) });
});
route('POST', /^\/api\/driver\/trips\/([^/]+)\/arrive$/, DRV, ({ env, d, user, actor, req, m }) => {
  const t = myTrip(d, user, rid(m)); if (!t.actualDeparture) return fail(422, 'Registrá primero la salida'); if (t.status === 'cancelado') return fail(422, 'El viaje está cancelado');
  const w = when(env, req.body?.at, req.body?.reason, 'la llegada'); if (t.actualArrival && !w.reason) return fail(422, 'La llegada ya está registrada: para cambiarla indicá el motivo');
  if (new Date(w.iso) < new Date(t.actualDeparture)) return fail(422, 'La llegada no puede ser anterior a la salida');
  logTime(d, t, 'actualArrival', w.iso, w.reason, actor, env);
  if (req.body?.odometer != null) { const o = Number(req.body.odometer); if (!(o >= 0) || (t.odometerStart != null && o < t.odometerStart)) return fail(422, 'El odómetro final no puede ser menor que el inicial'); t.odometerEnd = o; }
  env.hooks.scheduleTrip(t.id); env.save(); return json({ ok: true, trip: driverTrip(d, t) });
});
route('POST', /^\/api\/driver\/trips\/([^/]+)\/odometer$/, DRV, ({ env, d, user, actor, req, m }) => {
  const t = myTrip(d, user, rid(m)); const { start, end, reason } = req.body ?? {}; const before = { inicial: t.odometerStart, final: t.odometerEnd };
  const s = start != null ? Number(start) : t.odometerStart, e = end != null ? Number(end) : t.odometerEnd;
  if ((s != null && !(s >= 0)) || (e != null && !(e >= 0))) return fail(422, 'Odómetro inválido'); if (s != null && e != null && e < s) return fail(422, 'El odómetro final no puede ser menor que el inicial');
  if ((before.inicial != null && start != null && before.inicial !== s) || (before.final != null && end != null && before.final !== e)) { if (!String(reason ?? '').trim()) return fail(422, 'Para corregir un odómetro ya cargado indicá el motivo'); }
  t.odometerStart = s ?? null; t.odometerEnd = e ?? null; t.updatedAt = env.now().toISOString();
  audit(d, actor, 'viaje', t.id, 'odómetro', `Odómetro de ${t.id}`, { refs: dRefs(t), before, after: { inicial: t.odometerStart, final: t.odometerEnd }, reason: String(reason ?? '') || undefined }); env.hooks.scheduleTrip(t.id); env.save(); return json({ ok: true, trip: driverTrip(d, t) });
});
route('POST', /^\/api\/driver\/trips\/([^/]+)\/stops$/, DRV, ({ env, d, user, actor, req, m }) => {
  const t = myTrip(d, user, rid(m)); const { start, end, reason } = req.body ?? {}; const a = new Date(start), b = new Date(end);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b <= a) return fail(422, 'La parada necesita inicio y fin válidos (el fin posterior al inicio)');
  if (t.actualDeparture && a < new Date(t.actualDeparture)) return fail(422, 'La parada no puede empezar antes de la salida');
  t.stops = [...(t.stops ?? []), { id: uid(), start: a.toISOString(), end: b.toISOString(), reason: String(reason ?? '').slice(0, 120) || undefined }]; t.updatedAt = env.now().toISOString();
  audit(d, actor, 'viaje', t.id, 'parada', `Parada registrada (${minutesBetween(a.toISOString(), b.toISOString())} min)`, { refs: dRefs(t) }); env.hooks.scheduleTrip(t.id); env.save(); return json({ ok: true, trip: driverTrip(d, t) });
});
route('POST', /^\/api\/driver\/trips\/([^/]+)\/expenses$/, DRV, ({ env, d, user, actor, req, m }) => {
  const t = myTrip(d, user, rid(m)); const b = req.body ?? {}; if (!EXPENSE_CATEGORIES.includes(b.category)) return fail(422, 'Elegí una categoría');
  const amount = Number(b.amount); if (!(amount > 0)) return fail(422, 'El importe debe ser mayor que 0'); if (b.category === 'driverPay') return fail(422, 'El pago al chofer lo registra la oficina');
  if (b.clientRequestId && t.expenses.some(e => (e as Expense & { requestId?: string }).requestId === b.clientRequestId)) return json({ ok: true, trip: driverTrip(d, t), duplicate: true }); // reintento: no duplica
  const e: Expense & { requestId?: string } = { id: uid(), category: b.category, amount, date: String(b.date ?? localDate(env.now(), d.settings.timezone)), note: String(b.note ?? '').slice(0, 200) || undefined, status: 'pendiente_revision', createdBy: actor.name, createdById: user.id, requestId: b.clientRequestId };
  t.expenses.push(e); t.updatedAt = env.now().toISOString();
  audit(d, actor, 'gasto', e.id, 'cargado por chofer', `${actor.name} cargó ${EXPENSE_LABEL[e.category]} de ${fmtMoney(amount, d.settings.currency, 2)} en ${t.id} (pendiente de revisión)`, { refs: [...dRefs(t), t.id], after: { importe: amount, estado: 'pendiente_revision' } }); env.hooks.scheduleTrip(t.id); env.save(); return json({ ok: true, expenseId: e.id, trip: driverTrip(d, t) });
});
route('DELETE', /^\/api\/driver\/trips\/([^/]+)\/expenses\/([^/]+)$/, DRV, ({ env, d, user, actor, m }) => {
  const t = myTrip(d, user, rid(m)); const e = t.expenses.find(x => x.id === rid(m, 2) && x.createdById === user.id); if (!e) return fail(404, 'Gasto inexistente');
  if (e.status !== 'pendiente_revision') return fail(422, 'Solo se pueden retirar gastos que todavía no fueron revisados');
  t.expenses = t.expenses.filter(x => x.id !== e.id); audit(d, actor, 'gasto', e.id, 'retirado por chofer', `Gasto de ${t.id} retirado por ${actor.name}`, { refs: dRefs(t), before: { importe: e.amount } }); env.hooks.scheduleTrip(t.id); env.save(); return json({ ok: true, trip: driverTrip(d, t) });
});
route('POST', /^\/api\/driver\/trips\/([^/]+)\/files$/, DRV, ({ env, d, user, actor, req, m }) => {
  const t = myTrip(d, user, rid(m)); const expenseId = req.body?.expenseId ? String(req.body.expenseId) : null;
  if (expenseId && !t.expenses.some(e => e.id === expenseId && e.createdById === user.id)) return fail(422, 'El gasto no existe');
  // una foto NO confirma un gasto: queda adjunta al gasto (si se indica) y también vinculada al viaje, sin crear otro gasto
  const f = storeFile(env, user, req.body, expenseId ? 'gasto' : 'viaje', expenseId ?? t.id, expenseId ? [{ type: 'viaje', id: t.id }] : []);
  audit(d, actor, 'comprobante', f.id, 'cargado por chofer', `Foto/comprobante «${f.name}» en ${t.id}`, { refs: [...dRefs(t), t.id], after: { tipo: f.mime, tamaño: f.size } }); env.hooks.scheduleTrip(t.id); env.save(); return json({ ok: true, trip: driverTrip(d, t) });
});
route('POST', /^\/api\/driver\/trips\/([^/]+)\/incidents$/, DRV, ({ env, d, user, actor, req, m }) => {
  const t = myTrip(d, user, rid(m)); const text = String(req.body?.text ?? '').trim(); if (!text) return fail(422, 'Describí el incidente u observación');
  t.incidents = [...(t.incidents ?? []), { id: uid(), at: env.now().toISOString(), by: actor.name, text: text.slice(0, 600) }]; t.updatedAt = env.now().toISOString();
  audit(d, actor, 'viaje', t.id, 'incidente', `Incidente/observación registrado en ${t.id}`, { refs: dRefs(t) }); env.hooks.scheduleTrip(t.id); env.save(); return json({ ok: true, trip: driverTrip(d, t) });
});
route('POST', /^\/api\/driver\/trips\/([^/]+)\/finish$/, DRV, ({ env, d, user, actor, m }) => {
  const t = myTrip(d, user, rid(m)); if (t.driverDone) return json({ ok: true, trip: driverTrip(d, t), unchanged: true });
  if (!t.actualDeparture || !t.actualArrival) return fail(422, 'Registrá la salida y la llegada antes de terminar el trabajo');
  const was = t.status; t.status = 'finalizado'; t.driverDone = { at: env.now().toISOString(), by: actor.name }; t.updatedAt = t.driverDone.at;
  audit(d, actor, 'viaje', t.id, 'terminado por chofer', `${actor.name} marcó ${t.id} como terminado para revisión`, { refs: dRefs(t), before: { estado: was }, after: { estado: 'finalizado' } }); env.hooks.scheduleTrip(t.id); env.save(); return json({ ok: true, trip: driverTrip(d, t) });
});

// ---- controles de demostración (administrador y solo con DEMO_MODE)
route('POST', /^\/api\/dev\/fail-next$/, ADMIN, ({ env, req }) => { if (!env.hooks.flags.demo) return fail(404, 'No disponible'); env.hooks.failNext(Number(req.body?.n ?? 3)); return json({ ok: true }); });
route('POST', /^\/api\/dev\/reset$/, ADMIN, async ({ env }) => { if (!env.hooks.flags.demo) return fail(404, 'No disponible'); sessions.clear(); await env.hooks.reset(); return json({ ok: true, relogin: true }); });

export { computeTrips, kmTotal, BUDGET_CATS, type BudgetCat as _B, quoteCalc as _q };
