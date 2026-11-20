// SERVIDOR SIMULADO EN EL NAVEGADOR (solo para la versión estática publicada como demo).
// Ejecuta la MISMA API (src/api/core.ts: sesiones, permisos y validaciones) dentro de la página. Los datos viven en memoria (se pierden al
// recargar) y los "procesos en segundo plano" son temporizadores del navegador: NO funcionan con la aplicación cerrada.
// Importante: como el código corre en el navegador del usuario, estos permisos NO son una barrera de seguridad real.
import { buildSeed } from '../../server/seed';
import { Env, Hooks, Res, audit, handle, initUsers, Actor } from '../../api/core';
import { CompanyData, MonthlyReport, TripReport } from '../../shared/types';
import { buildMonthlyFigures, computeTrips, hashString, monthlyMissing, tripDataVersion, tripMonth } from '../../shared/calc';
import { buildAnalysis } from '../../shared/analysis';
import { localDate, prevMonth } from '../../shared/time';

export const STATIC = import.meta.env.VITE_STATIC === '1';
const DEBOUNCE = 5000; const MAX = 3; const SYS: Actor = { id: 'sistema', name: 'Proceso automático (simulado)', type: 'proceso' };
const uid = () => crypto.randomUUID(); const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
let db: CompanyData | null = null; let failNext = 0; const store = new Map<string, Uint8Array>();
export const snapshots = new Map<string, { trip: CompanyData['trips'][number]; calc: ReturnType<typeof computeTrips> extends Map<string, infer C> ? C : never; data: CompanyData; version: number; provisional: boolean }>();
const D = (): CompanyData => db!;
const calcFor = (d: CompanyData, tripId: string) => computeTrips({ settings: d.settings, trucks: d.trucks, trips: d.trips, invoices: d.invoices, payments: d.payments, now: new Date() }).get(tripId)!;

function scheduleTrip(tripId: string, o: { force?: boolean; immediate?: boolean } = {}) {
  const d = D(); const trip = d.trips.find(t => t.id === tripId); if (!trip) return { report: null, created: false, reason: 'Viaje inexistente' };
  const dv = tripDataVersion(trip, d); const mine = d.tripReports.filter(r => r.tripId === tripId).sort((a, b) => a.version - b.version); const latest = mine[mine.length - 1];
  if (latest?.status === 'pendiente') { latest.dataVersion = dv; return { report: latest, created: false, reason: 'Ya hay un informe pendiente: se agruparon los cambios' }; }
  if (latest?.status === 'generando') return { report: latest, created: false, reason: 'El informe se está generando' };
  if (latest?.status === 'disponible' && latest.dataVersion === dv) return { report: latest, created: false, reason: 'Sin cambios desde la última versión' };
  if (latest?.status === 'error' && latest.dataVersion === dv && !o.force) return { report: latest, created: false, reason: 'El último intento falló: usá Reintentar' };
  const rep: TripReport = { id: uid(), tripId, version: (latest?.version ?? 0) + 1, status: 'pendiente', provisional: true, dataVersion: dv, createdAt: new Date().toISOString(), generatedAt: null, scheduledFor: new Date(Date.now() + (o.immediate ? 0 : DEBOUNCE)).toISOString(), attempts: 0, error: null, missing: [], fileName: null, fileSize: null };
  d.tripReports.push(rep); runTripJob(rep.id, o.immediate ? 200 : DEBOUNCE); return { report: rep, created: true, reason: 'Informe programado' };
}
function runTripJob(rid: string, delay: number) {
  const d = D(); const now = new Date().toISOString();
  const job = { id: uid(), type: 'trip_pdf' as const, key: `trip_pdf:${rid}`, payload: { reportId: rid }, status: 'en_cola' as const, attempts: 0, maxAttempts: MAX, runAt: new Date(Date.now() + delay).toISOString(), createdAt: now, updatedAt: now } as CompanyData['jobs'][number];
  d.jobs.unshift(job);
  const attempt = () => {
    const rep = d.tripReports.find(r => r.id === rid); if (!rep || rep.status === 'disponible') { job.status = 'omitido'; return; }
    job.status = 'ejecutando'; rep.status = 'generando'; job.attempts++; rep.attempts = job.attempts;
    setTimeout(() => {
      if (failNext > 0) { failNext--; job.error = 'Fallo simulado (modo demostración)'; if (job.attempts < MAX) { job.status = 'en_cola'; setTimeout(attempt, 1500 * job.attempts); } else { job.status = 'error'; rep.status = 'error'; rep.error = job.error; } return; }
      const trip = d.trips.find(t => t.id === rep.tripId)!; const calc = calcFor(d, trip.id); const provisional = trip.status !== 'finalizado' || !calc.complete;
      snapshots.set(rid, { trip: clone(trip), calc: clone(calc), data: clone({ ...d, jobs: [], audit: [], tripReports: [], monthlyReports: [], emails: [], notices: [], users: [] }), version: rep.version, provisional });
      Object.assign(rep, { status: 'disponible', provisional, dataVersion: tripDataVersion(trip, d), generatedAt: new Date().toISOString(), missing: calc.missing, error: null });
      job.status = 'hecho'; job.result = 'Ficha generada (simulado en el navegador)';
      audit(d, SYS, 'informe', trip.id, 'generado', `Ficha de viaje ${trip.id} v${rep.version} (${provisional ? 'provisoria' : 'completa'}) · simulado`, { refs: [trip.clientId, trip.truckId, trip.driverId] });
      if (tripDataVersion(trip, d) !== rep.dataVersion) scheduleTrip(trip.id);
    }, 900);
  };
  setTimeout(attempt, delay);
}
function monthlyContent(month: string) {
  const d = D(); const figures = buildMonthlyFigures(d, month, new Date()); const missing = monthlyMissing(d, figures);
  const open = d.trips.filter(t => (t.status === 'en_curso' || t.status === 'planificado') && tripMonth(t, d.settings.timezone) === month).length;
  return { figures, missing, provisional: figures.current.trips === 0 || figures.incompleteTripIds.length > 0 || open > 0, dataVersion: hashString(JSON.stringify(figures)) };
}
function scheduleMonthly(month: string, trigger: 'automatico' | 'manual') {
  const d = D(); const c = monthlyContent(month); const mine = d.monthlyReports.filter(r => r.month === month).sort((a, b) => a.version - b.version); const latest = mine[mine.length - 1];
  if (latest && (latest.status === 'pendiente' || latest.status === 'generando')) return { report: latest, created: false, reason: 'Ya hay un informe en proceso' };
  if (latest?.status === 'disponible' && latest.dataVersion === c.dataVersion) return { report: latest, created: false, reason: 'Sin cambios en los datos desde la última versión' };
  const rep: MonthlyReport = { id: uid(), month, version: (latest?.version ?? 0) + 1, status: 'pendiente', provisional: c.provisional, dataVersion: c.dataVersion, trigger, createdAt: new Date().toISOString(), generatedAt: null, attempts: 0, error: null, missing: c.missing, figures: null, analysis: null, fileName: null, fileSize: null };
  d.monthlyReports.push(rep);
  setTimeout(() => { rep.status = 'generando'; setTimeout(() => { const n = monthlyContent(month); Object.assign(rep, { status: 'disponible', provisional: n.provisional, missing: n.missing, dataVersion: n.dataVersion, figures: n.figures, analysis: buildAnalysis(n.figures, d.settings), generatedAt: new Date().toISOString() });
    audit(d, SYS, 'informe mensual', month, 'generado', `Informe de ${month} v${rep.version} (${trigger}) · simulado`); }, 900); }, 300);
  return { report: rep, created: true, reason: 'Informe programado' };
}

const hooks: Hooks = {
  scheduleTrip, scheduleMonthly, retryTrip: id => { const r = D().tripReports.find(x => x.id === id); if (r?.status === 'error') { r.status = 'pendiente'; r.error = null; runTripJob(r.id, 200); } return r ?? null; },
  retryMonthly: id => { const r = D().monthlyReports.find(x => x.id === id); return r ?? null; }, retryEmail: () => null,
  putFile: (id, b) => { store.set(id, b); }, getFile: id => store.get(id) ?? null, delFile: id => { store.delete(id); }, getReport: () => null,
  render: async () => null, // sin pdfkit en el navegador: la interfaz muestra la vista en pantalla
  mail: async () => ({ status: 'sin_configurar', detail: 'Correo no enviado: la versión estática no tiene servidor de correo.' }),
  failNext: n => { failNext = n; }, reset: async () => { await init(true); },
  flags: { demo: true, mailConfigured: false, aiConfigured: false, debounceMs: DEBOUNCE, auth: 'Sesiones simuladas en el navegador (no es seguridad real)' },
};
const env: Env = { data: D, save: () => undefined, now: () => new Date(), hooks };
async function init(force = false) {
  if (db && !force) return; db = buildSeed(new Date(), 'demo'); await initUsers(db); snapshots.clear(); store.clear();
  for (const t of db.trips.filter(x => x.status === 'finalizado').slice(-14)) scheduleTrip(t.id, { immediate: true });
  scheduleMonthly(prevMonth(localDate(new Date(), db.settings.timezone).slice(0, 7)), 'automatico');
}
export async function staticSend(method: string, url: string, body: any, token?: string): Promise<Res> {
  await init(); const [path, qs] = url.split('?');
  return handle(env, { method, path, query: new URLSearchParams(qs ?? ''), body: body === undefined ? undefined : clone(body), token });
}
void tripMonth;
