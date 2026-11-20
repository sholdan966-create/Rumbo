// Adaptador HTTP: toda la lógica de negocio, validación y autorización vive en src/api/core.ts.
import './env';
import express, { Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { Store } from './store';
import { buildSeed } from './seed';
import { Services, DEBOUNCE_MS, setFailNext } from './services';
import { mailConfigured, sendMail } from './mailer';
import { aiConfigured } from './ai';
import { Env, Hooks, handle, initUsers } from '../api/core';
import { emptyCompany } from '../shared/templates';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT ?? 8787);
/** Por defecto la aplicación arranca como instalación REAL (sin datos de ejemplo). DEMO_MODE=1 genera datos ficticios y un PIN común. */
const DEMO_MODE = process.env.DEMO_MODE === '1';
const CID = 'demo'; // Una sola empresa en la demo. En producción cada usuario pertenece a una empresa y el almacenamiento se filtra por ella.

const store = new Store();
if (!store.has(CID)) {
  if (DEMO_MODE) { store.set(CID, buildSeed(new Date(), CID)); console.log('Datos de demostración creados.'); }
  else { store.set(CID, emptyCompany(CID)); console.log('Instalación nueva: abrí la aplicación para completar la configuración inicial.'); }
}
if (DEMO_MODE) await initUsers(store.get(CID), process.env.DEMO_PIN ?? '1234');
else if (store.get(CID).isDemo) { console.error('ERROR: los datos existentes son de demostración. Usá DEMO_MODE=1 o un DATA_DIR nuevo para una instalación real.'); process.exit(1); }
store.save();
// Código de instalación: evita que un tercero complete la configuración inicial de un servidor público. Se imprime en el registro.
const SETUP_TOKEN = DEMO_MODE ? undefined : (process.env.SETUP_TOKEN || crypto.randomBytes(6).toString('hex'));
if (SETUP_TOKEN && store.get(CID).users.length === 0) console.log(`CÓDIGO DE INSTALACIÓN: ${SETUP_TOKEN}  (se pide en el primer ingreso; también puede fijarse con SETUP_TOKEN)`);
const svc = new Services(store);

const hooks: Hooks = {
  scheduleTrip: (id, o) => svc.scheduleTripReport(CID, id, o), scheduleMonthly: (m, t) => svc.scheduleMonthly(CID, m, t),
  retryTrip: id => svc.retryTripReport(CID, id), retryMonthly: id => svc.retryMonthly(id), retryEmail: id => svc.retryEmail(id),
  putFile: (id, bytes) => { fs.mkdirSync(path.dirname(store.filePath(CID, 'x')), { recursive: true }); fs.writeFileSync(store.uploadPath(CID, id), bytes); },
  getFile: id => { const p = store.uploadPath(CID, id); return fs.existsSync(p) ? fs.readFileSync(p) : null; },
  delFile: id => { try { fs.unlinkSync(store.uploadPath(CID, id)); } catch { /* ya no existe */ } },
  getReport: name => { const p = store.filePath(CID, name); return fs.existsSync(p) ? fs.readFileSync(p) : null; },
  render: (kind, p) => svc.renderOnDemand(CID, kind, p),
  mail: async (to, subject, text) => { try { const r = await sendMail({ to, subject, text }); return r; } catch (e) { return { status: 'error' as const, detail: e instanceof Error ? e.message : 'Error de envío' }; } },
  failNext: setFailNext,
  reset: async () => { if (!DEMO_MODE) return; fs.rmSync(path.join(store.filePath(CID, 'x'), '..'), { recursive: true, force: true }); const d = buildSeed(new Date(), CID); await initUsers(d, process.env.DEMO_PIN ?? '1234'); store.set(CID, d); backfillReports(); },
  flags: { demo: DEMO_MODE, mailConfigured: mailConfigured(), aiConfigured: aiConfigured(), debounceMs: DEBOUNCE_MS, auth: DEMO_MODE ? 'Sesiones con PIN (demostración)' : 'Usuario y contraseña', setupToken: SETUP_TOKEN },
};
const env: Env = { data: () => store.get(CID), save: () => store.save(), now: () => new Date(), hooks };

function backfillReports() {
  const d = store.get(CID); if (d.tripReports.length) return;
  for (const t of d.trips.filter(x => x.status === 'finalizado').slice(-14)) svc.scheduleTripReport(CID, t.id, { immediate: true });
}

const app = express();
app.disable('x-powered-by'); app.set('trust proxy', 1);
// Cabeceras de seguridad. La aplicación no carga nada de terceros; los PDF se previsualizan en un iframe blob:.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-src blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
});
app.get('/healthz', (_req, res) => { res.json({ ok: true, demo: DEMO_MODE }); });
app.use(express.json({ limit: '12mb' }));
app.all('/api/*', async (req: Request, res: Response) => {
  const auth = req.headers.authorization; const token = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
  const r = await handle(env, { method: req.method, path: req.path, query: new URLSearchParams(req.query as Record<string, string>), body: req.body, token });
  res.setHeader('Cache-Control', 'no-store');
  if (r.file) {
    res.status(r.status); res.setHeader('Content-Type', r.file.mime); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `${r.file.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(r.file.name)}`); res.send(Buffer.from(r.file.bytes)); return;
  }
  res.status(r.status).json(r.body ?? {});
});

const dist = path.resolve(process.cwd(), 'dist');
if (fs.existsSync(dist)) { app.use(express.static(dist)); app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html'))); }
app.use((err: Error, _req: Request, res: Response, _next: express.NextFunction) => { console.error('[error]', err); res.status(500).json({ errors: ['Error interno del servidor'] }); });

svc.recover(); backfillReports();
setTimeout(() => store.backupDaily(), 3000); setInterval(() => store.backupDaily(), 6 * 3600_000);
setInterval(() => { svc.tick().catch(e => console.error('[tick]', e)); }, 2000);
setInterval(() => { try { svc.schedulerTick(); } catch (e) { console.error('[scheduler]', e); } }, 60_000);
setTimeout(() => { try { svc.schedulerTick(); } catch (e) { console.error('[scheduler]', e); } }, 1500);
process.on('SIGTERM', () => { store.flush(); process.exit(0); });
process.on('SIGINT', () => { store.flush(); process.exit(0); });
app.listen(PORT, () => console.log(`RUMBO API en http://localhost:${PORT}  (demo=${DEMO_MODE}, SMTP=${mailConfigured() ? 'configurado' : 'sin configurar'})`));
