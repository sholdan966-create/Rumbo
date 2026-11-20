import { beforeAll, describe, expect, it } from 'vitest';
import { buildSeed } from '../src/server/seed';
import { Env, Hooks, handle, initUsers } from '../src/api/core';
import { CompanyData } from '../src/shared/types';
import { emptyCompany } from '../src/shared/templates';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==', 'base64');
let d: CompanyData; const files = new Map<string, Uint8Array>(); const scheduled: string[] = [];
const hooks: Hooks = {
  scheduleTrip: id => { scheduled.push(id); return { report: null, created: true, reason: '' }; }, scheduleMonthly: () => ({ report: null, created: true, reason: '' }), retryTrip: () => null, retryMonthly: () => null, retryEmail: () => null,
  putFile: (id, b) => { files.set(id, b); }, getFile: id => files.get(id) ?? null, delFile: id => { files.delete(id); }, getReport: () => null, render: async () => null,
  mail: async () => ({ status: 'sin_configurar', detail: 'sin SMTP' }), failNext: () => undefined, reset: async () => undefined, flags: { demo: true, mailConfigured: false, aiConfigured: false, debounceMs: 0, auth: 'test' },
};
const env: Env = { data: () => d, save: () => undefined, now: () => new Date('2026-11-20T15:00:00Z'), hooks };
const call = async (token: string | undefined, method: string, path: string, body?: unknown) => { const [p, q] = path.split('?'); return handle(env, { method, path: p, query: new URLSearchParams(q ?? ''), body, token }); };
const login = async (userId: string, pin = '1234') => { const r = await call(undefined, 'POST', '/api/auth/login', { userId, pin }); return (r.body as { token?: string }).token as string; };
let admin: string, oper: string, cons: string, d1: string, d2: string;

beforeAll(async () => {
  d = buildSeed(new Date('2026-11-20T15:00:00Z'), 'demo'); await initUsers(d);
  [admin, oper, cons, d1, d2] = await Promise.all([login('u-admin'), login('u-oper'), login('u-cons'), login('u-d1'), login('u-d2')]);
}, 30000);

describe('instalación real y usuarios', () => {
  it('setup solo una vez, con código y contraseña válida; luego se ingresa con usuario y contraseña', async () => {
    const empty: CompanyData = emptyCompany('t'); const e2: Env = { data: () => empty, save: () => undefined, now: () => new Date(), hooks: { ...hooks, flags: { ...hooks.flags, demo: false, setupToken: 'abc123' } } };
    const c = (m: string, p: string, b?: unknown, t?: string) => handle(e2, { method: m, path: p, query: new URLSearchParams(), body: b, token: t });
    expect(((await c('GET', '/api/setup/status')).body as any).needsSetup).toBe(true); expect((await c('GET', '/api/auth/users')).body).toEqual({ users: [] });
    const good = { setupToken: 'abc123', company: { name: 'Transportes Rosario SRL', cuit: '30-1' }, admin: { name: 'Ana', username: 'Ana.Perez', password: 'clave-larga-123' } };
    expect((await c('POST', '/api/setup', { ...good, setupToken: 'x' })).status).toBe(403); expect((await c('POST', '/api/setup', { ...good, admin: { ...good.admin, password: '12345678901' } })).status).toBe(422); expect((await c('POST', '/api/setup', { ...good, admin: { ...good.admin, password: 'corta' } })).status).toBe(422);
    const r = await c('POST', '/api/setup', good); expect(r.status).toBe(200); expect(empty.settings.companyName).toBe('Transportes Rosario SRL'); expect(empty.settings.timezone).toBe('America/Argentina/Buenos_Aires'); expect(empty.isDemo).toBe(false);
    expect((await c('POST', '/api/setup', good)).status).toBe(409); expect(JSON.stringify(empty.users)).not.toContain('clave-larga-123');
    const login = await c('POST', '/api/auth/login', { username: 'ana.perez', password: 'clave-larga-123' }); expect(login.status).toBe(200); const tok = (login.body as any).token;
    expect((await c('POST', '/api/auth/login', { username: 'ana.perez', password: 'otra' })).status).toBe(401);
    // gestión de usuarios
    empty.drivers.push({ id: 'D1', name: 'Juan' });
    expect((await c('POST', '/api/users', { name: 'Juan', username: 'juan', role: 'chofer', password: 'password-segura-1' }, tok)).status).toBe(422); // sin chofer asociado
    const cu = await c('POST', '/api/users', { name: 'Juan', username: 'juan', role: 'chofer', driverId: 'D1', password: 'password-segura-1' }, tok); expect(cu.status).toBe(200);
    expect((await c('POST', '/api/users', { name: 'Otro', username: 'juan', role: 'operador', password: 'password-segura-2' }, tok)).status).toBe(422); // usuario repetido
    const jt = ((await c('POST', '/api/auth/login', { username: 'juan', password: 'password-segura-1' })).body as any).token; expect((await c('GET', '/api/users', undefined, jt)).status).toBe(403);
    const jid = (cu.body as any).user.id; expect((await c('PUT', `/api/users/${jid}`, { active: false }, tok)).status).toBe(200); expect((await c('GET', '/api/auth/me', undefined, jt)).status).toBe(401); // sesión cerrada
    expect((await c('POST', '/api/auth/login', { username: 'juan', password: 'password-segura-1' })).status).toBe(401); // desactivado
    expect((await c('PUT', `/api/users/${empty.users[0].id}`, { active: false }, tok)).status).toBe(422); // no se puede dejar sin administrador
    expect((await c('POST', '/api/auth/password', { current: 'mal', next: 'nueva-clave-larga' }, tok)).status).toBe(422); expect((await c('POST', '/api/auth/password', { current: 'clave-larga-123', next: 'nueva-clave-larga' }, tok)).status).toBe(200);
    expect((await c('POST', '/api/auth/login', { username: 'ana.perez', password: 'nueva-clave-larga' })).status).toBe(200);
    expect(JSON.stringify(empty.audit)).not.toMatch(/clave|password-segura|pinHash/);
  });
});

describe('autenticación y permisos', () => {
  it('sin sesión: 401; PIN incorrecto: 401; el PIN no se guarda en claro', async () => {
    expect((await call(undefined, 'GET', '/api/state')).status).toBe(401);
    expect((await call(undefined, 'POST', '/api/auth/login', { userId: 'u-admin', pin: '0000' })).status).toBe(401);
    expect(JSON.stringify(d.users)).not.toContain('"1234"'); expect(d.users[0].pinHash.length).toBe(64);
  });
  it('el estado enviado al navegador no incluye hashes ni sales', async () => {
    const r = await call(admin, 'GET', '/api/state'); const users = ((r.body as any).data.users as any[]); expect(users.every(u => u.pinHash === '' && u.salt === '')).toBe(true);
  });
  it('un chofer no accede a la API de gestión (403) ni a configuración', async () => {
    expect((await call(d1, 'GET', '/api/state')).status).toBe(403); expect((await call(d1, 'PUT', '/api/settings', {})).status).toBe(403); expect((await call(d1, 'GET', '/api/reports/trip/x/file')).status).toBe(403);
  });
  it('consulta lee pero no escribe; operador no cambia la configuración', async () => {
    expect((await call(cons, 'GET', '/api/state')).status).toBe(200); expect((await call(cons, 'PUT', '/api/clients/C1', { name: 'x', paymentTermDays: 30 })).status).toBe(403);
    expect((await call(oper, 'PUT', '/api/settings', d.settings)).status).toBe(403); expect((await call(admin, 'PUT', '/api/settings', d.settings)).status).toBe(200);
  });
  it('la sesión se cierra', async () => { const t = await login('u-cons'); await call(t, 'POST', '/api/auth/logout'); expect((await call(t, 'GET', '/api/state')).status).toBe(401); });
});

describe('portal del chofer', () => {
  it('lista solo sus viajes y nunca expone costos, márgenes ni presupuesto', async () => {
    const r = await call(d1, 'GET', '/api/driver/trips'); const trips = (r.body as any).trips as any[]; expect(trips.length).toBeGreaterThan(0);
    const mine = new Set(d.trips.filter(t => t.driverId === 'D1').map(t => t.id)); expect(trips.every(t => mine.has(t.id))).toBe(true);
    const text = JSON.stringify(r.body); for (const k of ['budgetSnapshot', 'marginTarget', 'serviceValue', 'revenue', 'allocated', 'monthlyFixedCosts']) expect(text).not.toContain(k);
  });
  it('un viaje ajeno devuelve 404 en todas las operaciones', async () => {
    const other = d.trips.find(t => t.driverId === 'D2' && t.status !== 'cancelado')!.id;
    for (const [m, p, b] of [['GET', ''], ['POST', '/depart', {}], ['POST', '/arrive', {}], ['POST', '/expenses', { category: 'fuel', amount: 10 }], ['POST', '/incidents', { text: 'x' }], ['POST', '/finish', {}], ['POST', '/stops', {}]] as [string, string, unknown][])
      expect((await call(d1, m, `/api/driver/trips/${other}${p}`, b)).status, `${m} ${p}`).toBe(404);
  });
  it('la información financiera visible se configura (valor del servicio)', async () => {
    const t = d.trips.find(x => x.driverId === 'D1' && x.status === 'planificado')!;
    expect(((await call(d1, 'GET', `/api/driver/trips/${t.id}`)).body as any).trip.serviceValue).toBeUndefined();
    d.settings.driverPortal.showTripValue = true; expect(((await call(d1, 'GET', `/api/driver/trips/${t.id}`)).body as any).trip.serviceValue).toBe(t.serviceValue); d.settings.driverPortal.showTripValue = false;
  });
  it('salida con hora distinta de la actual exige motivo y deja registro de quién corrigió', async () => {
    const t = d.trips.find(x => x.driverId === 'D1' && x.status === 'planificado')!;
    expect((await call(d1, 'POST', `/api/driver/trips/${t.id}/depart`, { at: '2026-11-20T12:00:00Z' })).status).toBe(422);
    expect((await call(d1, 'POST', `/api/driver/trips/${t.id}/depart`, { at: '2026-11-20T12:00:00Z', reason: 'Olvidé registrarla al salir', odometer: 1000 })).status).toBe(200);
    expect(t.status).toBe('en_curso'); expect(t.odometerStart).toBe(1000); expect(t.timeCorrections![0].by).toBe('Carlos Benítez'); expect(t.timeCorrections![0].reason).toContain('Olvidé');
    expect((await call(d1, 'POST', `/api/driver/trips/${t.id}/depart`, { at: '2026-11-20T12:30:00Z' })).status).toBe(422); // cambiar una salida ya registrada requiere motivo
  });
  it('rechaza hora futura, llegada previa a la salida y odómetro final menor', async () => {
    const t = d.trips.find(x => x.driverId === 'D1' && x.status === 'en_curso' && x.actualDeparture)!;
    expect((await call(d1, 'POST', `/api/driver/trips/${t.id}/arrive`, { at: '2027-01-01T00:00:00Z' })).status).toBe(422);
    expect((await call(d1, 'POST', `/api/driver/trips/${t.id}/arrive`, { at: '2020-01-01T00:00:00Z', reason: 'x' })).status).toBe(422);
    t.odometerStart = 5000; expect((await call(d1, 'POST', `/api/driver/trips/${t.id}/odometer`, { end: 4000 })).status).toBe(422);
  });
});

describe('flujo cotización → viaje → gasto de chofer → aprobación', () => {
  let tripId = '', expenseId = '', quoteId = '';
  it('crear, calcular, compartir, aceptar manualmente y convertir', async () => {
    const costs = (await call(admin, 'POST', '/api/quotes/suggest', { truckId: 'T1', origin: 'Rosario', destination: 'Córdoba', kmLoaded: 400, kmEmpty: 400 })).body as any;
    expect(costs.costs.fuel.source).toBeTruthy();
    const q = { id: 'QX', number: 'x', clientId: 'C1', origin: 'Rosario', destination: 'Córdoba', truckId: 'T1', vehicleType: '', kmLoaded: 400, kmEmpty: 400, plannedHours: 9, costs: costs.costs, marginTarget: 25, priceNet: null, ivaRate: 0.21, validUntil: '2026-12-31', notes: '', terms: 'Pago a 30 días' };
    q.costs.fuel = { amount: 300000, included: true, source: 'ajuste manual' }; for (const k of ['tolls', 'driverPay', 'perDiem', 'other', 'allocated']) q.costs[k] = { amount: 0, included: false, source: '' };
    const r = await call(oper, 'PUT', '/api/quotes/QX', q); expect(r.status).toBe(200); const qq = (r.body as any).quote; quoteId = qq.id;
    expect(qq.calc.suggestedNet).toBe(400000); expect(qq.calc.marginPct).toBeCloseTo(25);
    expect((await call(oper, 'PUT', '/api/quotes/QX', { ...q, marginTarget: 100 })).status).toBe(422);
    expect((await call(oper, 'POST', `/api/quotes/${quoteId}/convert`, {})).status).toBe(422); // aún no aceptada
    expect((await call(oper, 'POST', `/api/quotes/${quoteId}/share`, {})).status).toBe(422); // falta el canal
    expect((await call(oper, 'POST', `/api/quotes/${quoteId}/share`, { channel: 'WhatsApp', note: 'al jefe de compras' })).status).toBe(200);
    expect((await call(oper, 'POST', `/api/quotes/${quoteId}/accept`, { note: 'Confirmó por teléfono' })).status).toBe(200);
    expect((await call(oper, 'PUT', '/api/quotes/QX', { ...q, marginTarget: 30 })).status).toBe(422); // aceptada: no se modifica
    expect((await call(oper, 'POST', `/api/quotes/${quoteId}/convert`, {})).status).toBe(422); // falta chofer
    const c = await call(oper, 'POST', `/api/quotes/${quoteId}/convert`, { driverId: 'D2', truckId: 'T2', plannedDeparture: '2026-11-21T09:00:00Z', plannedArrival: '2026-11-21T18:00:00Z' });
    expect(c.status).toBe(200); tripId = (c.body as any).tripId; const t = d.trips.find(x => x.id === tripId)!;
    expect(t.budgetSnapshot!.revenueNet).toBe(400000); expect(t.budgetSnapshot!.costs.fuel).toBe(300000); expect(t.serviceValue).toBe(400000); expect(t.driverId).toBe('D2'); expect(t.truckId).toBe('T2');
    expect(((await call(oper, 'POST', `/api/quotes/${quoteId}/convert`, { driverId: 'D2', truckId: 'T2' })).body as any).unchanged).toBe(true); // no crea otro viaje
    expect(d.trips.filter(x => x.quoteId === quoteId).length).toBe(1);
  });
  it('el chofer asignado carga gasto y comprobante; otro chofer no ve el archivo', async () => {
    expect((await call(d2, 'POST', `/api/driver/trips/${tripId}/depart`, { odometer: 10000 })).status).toBe(200);
    const e = await call(d2, 'POST', `/api/driver/trips/${tripId}/expenses`, { category: 'fuel', amount: 320000, note: 'Tanque lleno', clientRequestId: 'req-1' }); expect(e.status).toBe(200); expenseId = (e.body as any).expenseId;
    const again = await call(d2, 'POST', `/api/driver/trips/${tripId}/expenses`, { category: 'fuel', amount: 320000, clientRequestId: 'req-1' }); expect((again.body as any).duplicate).toBe(true); // reintento: no duplica
    expect(d.trips.find(x => x.id === tripId)!.expenses.length).toBe(1);
    const bad = await call(d2, 'POST', `/api/driver/trips/${tripId}/files`, { name: 'ticket.png', dataBase64: Buffer.from('no soy una imagen').toString('base64'), expenseId }); expect(bad.status).toBe(422);
    const up = await call(d2, 'POST', `/api/driver/trips/${tripId}/files`, { name: 'ticket.png', description: 'Ticket YPF', dataBase64: PNG.toString('base64'), expenseId }); expect(up.status).toBe(200);
    const f = d.files[d.files.length - 1]; expect(f.entityType).toBe('gasto'); expect(f.links).toEqual([{ type: 'viaje', id: tripId }]);
    expect(d.trips.find(x => x.id === tripId)!.expenses[0].status).toBe('pendiente_revision'); // la foto no confirma el gasto
    expect((await call(d2, 'GET', `/api/files/${f.id}`)).status).toBe(200); expect((await call(d1, 'GET', `/api/files/${f.id}`)).status).toBe(404); expect((await call(undefined, 'GET', `/api/files/${f.id}`)).status).toBe(401);
    expect((await call(oper, 'GET', `/api/files/${f.id}`)).status).toBe(200);
  });
  it('archivos: límite de tamaño y tipos', async () => {
    d.settings.maxFileKb = 100; const big = Buffer.concat([PNG, Buffer.alloc(200 * 1024)]); expect((await call(admin, 'POST', '/api/files', { entityType: 'viaje', entityId: tripId, name: 'big.png', dataBase64: big.toString('base64') })).status).toBe(422); d.settings.maxFileKb = 5000;
    expect((await call(admin, 'POST', '/api/files', { entityType: 'viaje', entityId: 'no-existe', name: 'a.png', dataBase64: PNG.toString('base64') })).status).toBe(422);
  });
  it('aprobar el gasto no genera un segundo gasto ni duplica el costo; es idempotente', async () => {
    const t = d.trips.find(x => x.id === tripId)!; const n0 = t.expenses.length;
    expect((await call(oper, 'POST', `/api/trips/${tripId}/expenses/${expenseId}/review`, { decision: 'rechazado' })).status).toBe(422); // rechazo sin motivo
    expect((await call(oper, 'POST', `/api/trips/${tripId}/expenses/${expenseId}/review`, { decision: 'aprobado' })).status).toBe(200);
    expect((await call(oper, 'POST', `/api/trips/${tripId}/expenses/${expenseId}/review`, { decision: 'aprobado' })).status).toBe(200);
    expect(t.expenses.length).toBe(n0); expect(t.expenses[0].status).toBe('aprobado'); expect(t.expenses[0].amount).toBe(320000);
    expect(d.audit.filter(a => a.action === 'aprobado' && a.entityId === expenseId).length).toBe(1); // un solo registro de aprobación
  });
  it('edición general del viaje no puede alterar el presupuesto histórico ni los estados de revisión', async () => {
    const t = d.trips.find(x => x.id === tripId)!; const snap = JSON.stringify(t.budgetSnapshot);
    const body = JSON.parse(JSON.stringify(t)); body.budgetSnapshot.revenueNet = 1; body.expenses[0].status = 'pendiente_revision'; delete body.quoteId; body.notes = 'cambio';
    expect((await call(oper, 'PUT', `/api/trips/${tripId}`, body)).status).toBe(200); expect(JSON.stringify(t.budgetSnapshot)).toBe(snap); expect(t.expenses[0].status).toBe('aprobado'); expect(t.quoteId).toBe(quoteId);
  });
  it('llegada, terminar y comparar presupuesto: gasto aprobado cuenta una sola vez', async () => {
    const dep = d.trips.find(x => x.id === tripId)!.actualDeparture!; expect((await call(d2, 'POST', `/api/driver/trips/${tripId}/finish`, {})).status).toBe(422); // falta llegada
    expect(dep).toBeTruthy();
    expect((await call(d2, 'POST', `/api/driver/trips/${tripId}/arrive`, { odometer: 10800 })).status).toBe(200);
    expect((await call(d2, 'POST', `/api/driver/trips/${tripId}/finish`, {})).status).toBe(200);
    const t = d.trips.find(x => x.id === tripId)!; expect(t.status).toBe('finalizado'); expect(t.driverDone!.by).toBe('Marcelo Ríos');
  });
});

describe('concurrencia', () => {
  it('un cambio sobre datos desactualizados se rechaza (412) y no pisa el trabajo ajeno', async () => {
    const t = d.trips.find(x => x.status === 'finalizado')!; const stale = { ...JSON.parse(JSON.stringify(t)), updatedAt: '2020-01-01T00:00:00.000Z' };
    expect((await call(oper, 'PUT', `/api/trips/${t.id}`, stale)).status).toBe(412);
  });
});

describe('cambios de un viaje finalizado y su historial', () => {
  it('exige motivo y registra valores anteriores y nuevos', async () => {
    const t = d.trips.find(x => x.status === 'finalizado' && x.serviceValue)!; const body = { ...JSON.parse(JSON.stringify(t)), serviceValue: t.serviceValue! + 1000 };
    const r = await call(oper, 'PUT', `/api/trips/${t.id}`, body); expect(r.status).toBe(422);
    expect((await call(oper, 'PUT', `/api/trips/${t.id}`, { ...body, _reason: 'Ajuste de tarifa acordado con el cliente' })).status).toBe(200);
    const a = d.audit.find(x => x.entityId === t.id && x.action === 'modificado')!; expect((a.before as any)['valor del servicio']).toBe(t.serviceValue); expect((a.after as any)['valor del servicio']).toBe(t.serviceValue! + 1000); expect(a.reason).toContain('tarifa'); expect(a.user).toBe('Operador de tráfico');
  });
  it('los parámetros del vehículo se registran y no alteran presupuestos históricos', async () => {
    const tr = JSON.parse(JSON.stringify(d.trucks[0])); const snaps = JSON.stringify(d.trips.map(t => t.budgetSnapshot)); tr.params.maintenancePerKm = 777;
    expect((await call(oper, 'PUT', `/api/trucks/${tr.id}`, tr)).status).toBe(200); expect(JSON.stringify(d.trips.map(t => t.budgetSnapshot))).toBe(snaps);
    const a = d.audit.find(x => x.action === 'parámetros de costos')!; expect((a.after as any).params.maintenancePerKm).toBe(777);
  });
  it('el historial no contiene PIN ni datos de archivos', () => { const text = JSON.stringify(d.audit); expect(text).not.toContain('pinHash'); expect(text).not.toContain('dataBase64'); });
});

describe('cobranzas, documentos y reemplazo', () => {
  it('registrar gestión con compromiso y mensajes: el envío solo ocurre con acción explícita', async () => {
    expect((await call(oper, 'POST', '/api/clients/C7/collections', { channel: '', note: 'x' })).status).toBe(422);
    const g = await call(oper, 'POST', '/api/clients/C7/collections', { channel: 'Teléfono', note: 'Prometen pagar', promise: { date: '2026-11-30', amount: 1000000 }, nextAction: { date: '2026-11-25', text: 'Llamar' } }); expect(g.status).toBe(200);
    const draft = await call(oper, 'GET', '/api/clients/C7/reminder-draft'); expect((draft.body as any).body).toContain('Saldo total pendiente'); expect(d.messages.length).toBe(0); // el borrador no se envía ni registra
    const m = await call(oper, 'POST', '/api/clients/C7/messages', { channel: 'correo', to: 'pagos@x.com', subject: 's', body: 'b', send: true }); expect((m.body as any).message.result).toBe('sin_configurar'); // jamás figura enviado sin SMTP
    const w = await call(oper, 'POST', '/api/clients/C7/messages', { channel: 'whatsapp', to: '', subject: '', body: 'hola', registerOnly: true }); expect((w.body as any).message.result).toBe('manual');
  });
  it('reemplazar un documento conserva el historial y marca cuál está vigente', async () => {
    const old = d.documents.find(x => x.typeId === 'seguro' && !x.replacedBy)!;
    const r = await call(oper, 'PUT', '/api/documents/DOCNEW', { typeId: 'seguro', ownerType: 'vehiculo', ownerId: old.ownerId, identifier: 'POL-NUEVA', issueDate: '2026-11-20', expiryDate: '2027-11-20', replaces: old.id, notes: '' });
    expect(r.status).toBe(200); expect(d.documents.find(x => x.id === old.id)!.replacedBy).toBe('DOCNEW'); expect(d.documents.some(x => x.id === old.id)).toBe(true);
    expect((await call(oper, 'PUT', '/api/documents/BAD', { typeId: 'seguro', ownerType: 'chofer', ownerId: 'D1', identifier: 'x', expiryDate: '2027-01-01' })).status).toBe(422);
    expect((await call(oper, 'PUT', '/api/documents/BAD2', { typeId: 'seguro', ownerType: 'vehiculo', ownerId: 'T1', identifier: 'x' })).status).toBe(422); // requiere vencimiento
  });
});
