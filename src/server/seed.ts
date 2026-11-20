// Datos de demostración ficticios y coherentes, generados de forma determinística a partir de la fecha actual.
import { BUDGET_CATS, BudgetCat, Client, CollectionAction, CompanyData, Doc, DocType, Driver, Expense, ExpenseCategory, Invoice, Payment, Quote, ServicePlan, Trip, TripStatus, Truck } from '../shared/types';
import { nextQuoteNumber, quoteCalc, snapshotFromQuote } from '../shared/quote';
import { addDays, localDate, localInputToIso, monthEnd, nextMonth, prevMonth } from '../shared/time';

const TZ = 'America/Argentina/Buenos_Aires';
function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }

interface Route { o: string; d: string; km: number; rate: number; tolls: number; days: number; weight: number }
const ROUTES: Route[] = [
  { o: 'Rosario', d: 'Buenos Aires', km: 300, rate: 3300, tolls: 95000, days: 1, weight: 5 },
  { o: 'Rosario', d: 'Córdoba', km: 400, rate: 3300, tolls: 70000, days: 1, weight: 4 },
  { o: 'Rosario', d: 'Bahía Blanca', km: 650, rate: 3000, tolls: 110000, days: 2, weight: 3 },
  { o: 'Rosario', d: 'Mendoza', km: 950, rate: 2650, tolls: 85000, days: 3, weight: 2 },
  { o: 'Rosario', d: 'Santa Fe', km: 170, rate: 3700, tolls: 20000, days: 1, weight: 3 },
  { o: 'Rosario', d: 'Tucumán', km: 1050, rate: 2950, tolls: 60000, days: 3, weight: 1 },
];
const CLIENTS: Client[] = [
  { id: 'C1', name: 'Molinos del Paraná S.A.', cuit: '30-71234567-1', paymentTermDays: 30 },
  { id: 'C2', name: 'Agroexport Litoral S.R.L.', cuit: '30-70987654-3', paymentTermDays: 45 },
  { id: 'C3', name: 'Distribuidora San Martín', cuit: '30-68123456-9', paymentTermDays: 30 },
  { id: 'C4', name: 'Aceitera del Sur S.A.', cuit: '30-65432198-5', paymentTermDays: 60 },
  { id: 'C5', name: 'Frigorífico Los Andes', cuit: '30-71888999-2', paymentTermDays: 30 },
  { id: 'C6', name: 'Cerámica Pampeana S.A.', cuit: '30-69876543-0', paymentTermDays: 45 },
  { id: 'C7', name: 'Insumos Agrícolas Rosario', cuit: '30-70555444-7', paymentTermDays: 30 },
];
const DRIVERS: Driver[] = ['Carlos Benítez', 'Marcelo Ríos', 'Jorge Domínguez', 'Luis Acosta', 'Ramón Giménez', 'Pablo Sosa'].map((n, i) => ({ id: `D${i + 1}`, name: n }));

const monthlyPoolOf = (t: Truck) => t.monthlyFixedCosts.reduce((a, f) => a + f.amount, 0);

export function buildSeed(now: Date, companyId: string): CompanyData {
  const rand = rng(20261120);
  const today = localDate(now, TZ);
  const curMonth = today.slice(0, 7);
  const m0 = prevMonth(prevMonth(curMonth)); // primer mes con datos
  const iso = (date: string, hh: number, mm = 0) => localInputToIso(`${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, TZ)!;
  const nowIso = now.toISOString();

  const trucks: Truck[] = [
    ['Camión 1', 'AF 412 KL', 'Scania R450', 2021, 412300], ['Camión 2', 'AE 903 TP', 'Volvo FH 460', 2020, 538900],
    ['Camión 3', 'AG 127 MR', 'Mercedes-Benz Actros 2046', 2022, 287500], ['Camión 4', 'AD 655 QZ', 'Iveco Stralis 480', 2019, 689200],
    ['Camión 5', 'AF 078 HN', 'Scania G410', 2021, 451800], ['Camión 6', 'AH 340 BC', 'Volvo FH 540', 2023, 176400],
  ].map(([name, plate, model, year, odo], i): Truck => ({
    id: `T${i + 1}`, name: name as string, plate: plate as string, model: model as string, year: year as number,
    odometerKm: odo as number, odometerDate: addDays(today, -(i + 2)),
    params: { fuelLPer100km: 36 + i * 0.9 + (i === 4 ? 2.5 : 0), maintenancePerKm: 150 + i * 10, tireSetCost: 9_200_000, tireLifeKm: 90_000, baseValue: 152_000_000 - i * 4_000_000, residualValue: 52_000_000, lifeKm: 1_000_000, updatedAt: `${m0}-05` },
    monthlyFixedCosts: [
      { id: `F${i}a`, label: 'Seguro', amount: 620_000 }, { id: `F${i}b`, label: 'Patente y habilitaciones', amount: 240_000 },
      { id: `F${i}c`, label: 'Rastreo satelital y cochera', amount: 190_000 }, { id: `F${i}d`, label: 'Administración', amount: 350_000 },
    ],
    servicePlans: [], serviceHistory: [],
  }));
  // Mantenimiento: intervalos configurados por la empresa (datos ficticios, distintos por camión; no son valores universales).
  const mk = (id: string, name: string, intervalKm: number | null, intervalDays: number | null, lastKm: number | null, lastDate: string | null, abk: number | null, abd: number | null, source: string): ServicePlan =>
    ({ id, name, intervalKm, intervalDays, lastKm, lastDate, alertBeforeKm: abk, alertBeforeDays: abd, source });
  const odo = (i: number) => trucks[i].odometerKm!;
  trucks[0].servicePlans = [mk('S1', 'Cambio de aceite y filtros', 40000, 180, odo(0) - 26000, addDays(today, -110), 4000, 20, 'Configurado por la empresa (demo)')];
  trucks[1].servicePlans = [mk('S2', 'Cambio de aceite y filtros', 40000, 180, odo(1) - 38500, addDays(today, -150), 4000, 20, 'Configurado por la empresa (demo)'), mk('S3', 'Revisión de frenos', null, 120, null, addDays(today, -95), null, 15, 'Indicación registrada por el taller (demo)')];
  trucks[2].servicePlans = [mk('S4', 'Cambio de aceite y filtros', 35000, null, odo(2) - 9000, null, 3000, null, 'Configurado por la empresa (demo)')];
  trucks[3].servicePlans = [mk('S5', 'Cambio de aceite y filtros', 40000, 180, odo(3) - 41200, addDays(today, -190), 4000, 20, 'Configurado por la empresa (demo)')];
  trucks[4].servicePlans = [mk('S6', 'Cambio de aceite y filtros', 40000, 180, odo(4) - 12000, addDays(today, -60), 4000, 20, 'Configurado por la empresa (demo)')];
  trucks[5].servicePlans = [mk('S7', 'Primer servicio de garantía', 30000, null, 0, null, 3000, null, 'Indicación del fabricante registrada (demo)')];
  trucks[0].serviceHistory = [{ id: 'H1', name: 'Cambio de aceite y filtros', date: addDays(today, -110), km: odo(0) - 26000, cost: 410_000, note: 'Taller Rosario Norte' }];
  trucks[1].serviceHistory = [{ id: 'H2', name: 'Cambio de aceite y filtros', date: addDays(today, -150), km: odo(1) - 38500, cost: 438_000 }, { id: 'H3', name: 'Revisión de frenos', date: addDays(today, -95), km: odo(1) - 31000, cost: 265_000 }];

  const wtotal = ROUTES.reduce((s, r) => s + r.weight, 0);
  const pickRoute = (truckIdx: number) => {
    let x = rand() * wtotal;
    // Camiones 2 y 5 tienen más tramos largos; el Camión 6 casi no hace larga distancia
    for (const r of ROUTES) { const w = r.weight * (truckIdx === 5 && r.km > 600 ? 0.2 : (truckIdx === 1 || truckIdx === 4) && r.km > 600 ? 1.8 : 1); x -= w; if (x <= 0) return r; }
    return ROUTES[0];
  };

  const trips: Trip[] = [];
  const raw: { trip: Trip; dep: string }[] = [];
  const startDate = `${m0}-01`;
  for (let ti = 0; ti < 6; ti++) {
    let cursor = iso(addDays(startDate, Math.floor(rand() * 3)), 5 + Math.floor(rand() * 4));
    for (let guard = 0; guard < 60; guard++) {
      const r = pickRoute(ti);
      const night = rand() < 0.22;
      const dep = new Date(cursor);
      if (night) { const p = localDate(dep, TZ); cursor = iso(p, 21 + Math.floor(rand() * 2)); }
      const depD = new Date(cursor);
      const empty = rand() < 0.15 ? r.km * (0.6 + rand() * 0.4) : r.km; // algunos regresos con carga parcial
      const loaded = r.km; const drive = (loaded + empty) / (58 + rand() * 6) + 1.5 + rand();
      const arrD = new Date(depD.getTime() + drive * 3600_000);
      if (localDate(depD, TZ) > today) break;
      const cl = CLIENTS[Math.floor(rand() * CLIENTS.length)];
      const noisy = 0.93 + rand() * 0.14;
      const km = loaded + empty;
      const fuelPrice = 1_620 + rand() * 120; const l100 = 36 + ti * 0.9 + (ti === 4 ? 2.5 : 0) + rand() * 3;
      const revenue = Math.round((loaded * r.rate * noisy) / 1000) * 1000;
      const fuel = Math.round((km * l100 / 100 * fuelPrice) / 100) * 100;
      const tolls = Math.round(r.tolls * (0.95 + rand() * 0.1) / 100) * 100;
      const driverPay = Math.round(revenue * 0.14 / 100) * 100;
      const perDiem = Math.round(r.days * 38_000 / 100) * 100 + (r.days > 1 ? 0 : 0);
      const other = rand() < 0.2 ? Math.round((15_000 + rand() * 60_000) / 100) * 100 : 0;
      const exp: Expense[] = [];
      const id = `e${raw.length}`;
      const add = (category: ExpenseCategory, amount: number) => exp.push({ id: `${id}${category}`, category, amount, date: localDate(arrD, TZ) });
      add('fuel', fuel); add('tolls', tolls); add('driverPay', driverPay); add('perDiem', perDiem); if (other) add('other', other);
      const od0 = odo(ti) - 2000 - raw.length; // se reasigna luego
      const t: Trip = {
        id: '', clientId: cl.id, origin: r.o, destination: r.d, truckId: trucks[ti].id, driverId: DRIVERS[ti].id, status: 'finalizado',
        plannedDeparture: new Date(depD.getTime() + (rand() < 0.3 ? 20 * 60000 : 0)).toISOString(),
        plannedArrival: new Date(arrD.getTime() - (rand() < 0.5 ? 40 : -25) * 60000).toISOString(),
        actualDeparture: depD.toISOString(), actualArrival: arrD.toISOString(), kmLoaded: loaded, kmEmpty: Math.round(empty),
        odometerStart: od0, odometerEnd: od0 + loaded + Math.round(empty), serviceValue: revenue, ivaRate: 0.21,
        expenses: exp, expenseConfirmed: other ? {} : { other: true }, notes: '',
        budget: { fuel: Math.round(km * 38 / 100 * 1650 / 1000) * 1000, tolls: r.tolls, driverPay: Math.round(revenue * 0.14 / 1000) * 1000 },
        createdAt: depD.toISOString(), updatedAt: arrD.toISOString(),
      };
      raw.push({ trip: t, dep: t.actualDeparture! });
      cursor = new Date(arrD.getTime() + (40 + rand() * 50) * 3600_000).toISOString();
      if (localDate(new Date(cursor), TZ) > today) break;
    }
  }
  raw.sort((a, b) => a.dep.localeCompare(b.dep));
  raw.forEach((x, i) => { x.trip.id = `V-${localDate(new Date(x.dep), TZ).slice(0, 4)}-${String(i + 1).padStart(4, '0')}`; trips.push(x.trip); });
  // Odómetros coherentes por camión (encadenados hasta el kilometraje actual)
  for (let ti = 0; ti < 6; ti++) {
    const mine = trips.filter(t => t.truckId === trucks[ti].id);
    let end = odo(ti) - 400;
    for (let i = mine.length - 1; i >= 0; i--) { const km = mine[i].kmLoaded! + mine[i].kmEmpty!; mine[i].odometerEnd = end; mine[i].odometerStart = end - km; end -= km + Math.round(rand() * 60); }
  }
  // Estados: viajes cuyo arribo es posterior a ahora => en curso; viajes futuros planificados
  for (const t of trips) if (new Date(t.actualArrival!) > now) { t.status = 'en_curso'; t.actualArrival = null; t.odometerEnd = null; t.kmEmpty = t.kmEmpty; t.expenses = t.expenses.filter(e => e.category === 'fuel').slice(0, 1).map(e => ({ ...e, amount: Math.round(e.amount * 0.4) })); t.expenseConfirmed = {}; }
  // Un viaje cancelado y tres planificados próximos
  const cancelled = trips[Math.floor(trips.length * 0.55)];
  cancelled.status = 'cancelado'; cancelled.actualDeparture = null; cancelled.actualArrival = null; cancelled.expenses = []; cancelled.expenseConfirmed = {};
  cancelled.kmLoaded = null; cancelled.kmEmpty = null; cancelled.odometerStart = cancelled.odometerEnd = null; cancelled.notes = 'Cancelado por el cliente el día anterior a la salida.';
  const lastId = () => trips.length;
  const planned: Trip[] = [];
  for (let k = 0; k < 3; k++) {
    const r = ROUTES[(k * 2) % ROUTES.length]; const ti = (k + 1) % 6;
    const depDay = addDays(today, 1 + k);
    planned.push({
      id: `V-${today.slice(0, 4)}-${String(lastId() + k + 1).padStart(4, '0')}`, clientId: CLIENTS[(k + 2) % 7].id, origin: r.o, destination: r.d, truckId: trucks[ti].id, driverId: DRIVERS[ti].id,
      status: 'planificado', plannedDeparture: iso(depDay, 6), plannedArrival: iso(addDays(depDay, r.days > 1 ? 1 : 0), r.days > 1 ? 14 : 15), actualDeparture: null, actualArrival: null,
      kmLoaded: r.km, kmEmpty: null, odometerStart: null, odometerEnd: null, serviceValue: Math.round(r.km * r.rate / 1000) * 1000, ivaRate: 0.21,
      expenses: [], expenseConfirmed: {}, notes: 'Pendiente de confirmar carga con el cliente.', createdAt: nowIso, updatedAt: nowIso,
    });
  }
  trips.push(...planned);

  // Registros incompletos identificados (viajes finalizados recientes, para que se vean en la demo)
  const done = trips.filter(t => t.status === 'finalizado');
  const incomplete = [done.length - 3, done.length - 8, Math.floor(done.length * 0.5)];
  done[incomplete[0]].expenses = done[incomplete[0]].expenses.filter(e => e.category !== 'tolls'); // peajes pendientes
  done[incomplete[1]].expenses = done[incomplete[1]].expenses.filter(e => e.category !== 'fuel'); done[incomplete[1]].notes = 'Falta cargar la tarjeta de combustible.';
  done[incomplete[2]].kmEmpty = null; done[incomplete[2]].odometerStart = null; done[incomplete[2]].odometerEnd = null;
  done[done.length - 1].notes = 'Descarga demorada en destino (esperó 3 h).';
  done[Math.floor(done.length * 0.3)].stops = (() => { const t = done[Math.floor(done.length * 0.3)]; const s = new Date(t.actualDeparture!).getTime(); return [{ id: 's1', start: new Date(s + 3 * 3600_000).toISOString(), end: new Date(s + 3.75 * 3600_000).toISOString(), reason: 'Descanso del chofer' }]; })();

  // Facturación: una factura por cliente y semana de llegada, emitida 3 días después. Los viajes recientes quedan sin facturar.
  const invoices: Invoice[] = []; const payments: Payment[] = [];
  const cutoffInvoice = addDays(today, -9);
  const groups = new Map<string, Trip[]>();
  for (const t of done) {
    const arr = localDate(new Date(t.actualArrival!), TZ); if (arr > cutoffInvoice) continue;
    const wk = addDays(arr, -((new Date(arr).getUTCDay() + 6) % 7));
    const k = `${t.clientId}|${wk}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(t);
  }
  let n = 4120; let pi = 0;
  const methods = ['Transferencia', 'Transferencia', 'Cheque', 'Echeq'];
  const sorted = [...groups].sort((a, b) => a[0].split('|')[1].localeCompare(b[0].split('|')[1]));
  for (const [k, ts] of sorted) {
    const [cid, wk] = k.split('|'); const client = CLIENTS.find(c => c.id === cid)!;
    const issue = addDays(wk, 7 + 3); const due = addDays(issue, client.paymentTermDays);
    const inv: Invoice = { id: `I${invoices.length + 1}`, number: `0004-${String(++n).padStart(8, '0')}`, clientId: cid, issueDate: issue, dueDate: due, ivaRate: 0.21, lines: ts.map(t => ({ tripId: t.id, net: t.serviceValue! })), adjustments: [] };
    invoices.push(inv);
    const total = inv.lines.reduce((s, l) => s + l.net, 0) * 1.21;
    const r = rand();
    const payOn = (days: number, amount: number, i2 = 0) => { const d2 = addDays(due, days); if (d2 <= today) payments.push({ id: `P${++pi}`, invoiceId: inv.id, date: d2, amount: Math.round(amount * 100) / 100, method: methods[(pi + i2) % methods.length], reference: `OP-${3000 + pi}` }); };
    if (cid === 'C4' && r < 0.7) continue; // Aceitera del Sur: paga tarde, queda vencido
    if (r < 0.62) payOn(Math.round(rand() * 8 - 4), total);
    else if (r < 0.82) { payOn(-2, total * 0.5); payOn(12, total * 0.5, 1); } // cobros parciales completados
    else if (r < 0.92) payOn(Math.round(rand() * 5), total * 0.6); // cobro parcial vigente
    if (r > 0.97) inv.adjustments.push({ id: `A${pi}`, date: addDays(issue, 5), amount: -Math.round(total * 0.03), reason: 'Nota de crédito por faltante en descarga' });
  }
  // Un caso vencido con cobro parcial puntual
  const overdueInv = invoices.find(i => i.dueDate < addDays(today, -20) && !payments.some(p => p.invoiceId === i.id));
  if (overdueInv) { const tot = overdueInv.lines.reduce((s, l) => s + l.net, 0) * 1.21; payments.push({ id: `P${++pi}`, invoiceId: overdueInv.id, date: addDays(overdueInv.dueDate, 6), amount: Math.round(tot * 0.4), method: 'Transferencia', reference: 'Pago a cuenta' }); }


  // ---------------------------------------------------------------- ampliación: contactos, documentos, cotizaciones, cobranzas
  CLIENTS.forEach((c, i) => { c.contacts = [{ id: `K${i}a`, name: ['Lucía Fernández', 'Martín Pereyra', 'Ana Rossi', 'Diego Salas', 'Paula Núñez', 'Hernán Vega', 'Carla Ibáñez'][i], role: 'Administración', email: `pagos@cliente${i + 1}.ejemplo.com.ar`, phone: `+54 341 555-01${i}0` }]; });
  const docTypes: DocType[] = [
    { id: 'seguro', label: 'Seguro del vehículo', ownerType: 'vehiculo', hasExpiry: true, required: true },
    { id: 'rto', label: 'Revisión técnica obligatoria', ownerType: 'vehiculo', hasExpiry: true, required: true },
    { id: 'cedula', label: 'Cédula del vehículo', ownerType: 'vehiculo', hasExpiry: false, required: false },
    { id: 'licencia', label: 'Licencia de conducir profesional', ownerType: 'chofer', hasExpiry: true, required: true },
    { id: 'psico', label: 'Examen psicofísico', ownerType: 'chofer', hasExpiry: true, required: false },
    { id: 'habilitacion', label: 'Habilitación de transporte', ownerType: 'empresa', hasExpiry: true, required: true },
    { id: 'seguro_rc', label: 'Seguro de responsabilidad civil', ownerType: 'empresa', hasExpiry: true, required: false },
  ];
  const documents: Doc[] = []; let dn = 0;
  const addDoc = (typeId: string, ownerType: Doc['ownerType'], ownerId: string, identifier: string, expiryOffset: number | null, issued = -300, extraNotes = '', replaced: string | null = null, supersedes: string | null = null): Doc => {
    const d: Doc = { id: `DOC${++dn}`, typeId, ownerType, ownerId, identifier, issueDate: addDays(today, issued), expiryDate: expiryOffset == null ? null : addDays(today, expiryOffset), fileId: null, notes: extraNotes, replacedBy: replaced, supersedes, createdAt: nowIso, createdBy: 'Carga inicial (demo)' };
    documents.push(d); return d;
  };
  const sOff = [200, 95, 22, 160, 9, 310]; const rOff = [140, 60, -12, 240, 28, 120];
  trucks.forEach((t, i) => {
    if (i === 1) { const old = addDoc('seguro', 'vehiculo', t.id, `POL-${5000 + i}-A`, -30, -400, 'Póliza anterior'); const nw = addDoc('seguro', 'vehiculo', t.id, `POL-${5000 + i}-B`, sOff[i], -20, 'Renovación anual', null, old.id); old.replacedBy = nw.id; }
    else addDoc('seguro', 'vehiculo', t.id, `POL-${5000 + i}`, sOff[i]);
    if (i !== 5) addDoc('rto', 'vehiculo', t.id, `RTO-${7000 + i}`, rOff[i]);   // Camión 6: revisión técnica pendiente de cargar
    addDoc('cedula', 'vehiculo', t.id, t.plate, null, -900);
  });
  DRIVERS.forEach((dr, i) => { if (i !== 3) addDoc('licencia', 'chofer', dr.id, `LIC-${30000 + i}`, [180, 11, 340, 0, 75, 400][i]); });   // Chofer 4: licencia pendiente; Chofer 2 próxima a vencer
  addDoc('habilitacion', 'empresa', 'empresa', 'HAB-0001', 210);

  const doneTrips = trips.filter(t => t.status === 'finalizado');
  const quotes: Quote[] = []; let qn = 0;
  const mkQuote = (over: Partial<Quote>, t?: Trip): Quote => {
    const km = t ? { kl: t.kmLoaded, ke: t.kmEmpty } : { kl: 400, ke: 400 };
    const costs = Object.fromEntries(BUDGET_CATS.map(c => [c, { amount: 0, included: c !== 'other', source: 'Sin dato: completar' }])) as Quote['costs'];
    const q: Quote = { id: `Q${++qn}`, number: nextQuoteNumber(quotes, 2026), clientId: t?.clientId ?? CLIENTS[0].id, origin: t?.origin ?? 'Rosario', destination: t?.destination ?? 'Córdoba', truckId: t?.truckId ?? null, vehicleType: t ? '' : 'Semirremolque 28 t',
      kmLoaded: km.kl, kmEmpty: km.ke, plannedHours: t ? Math.round((new Date(t.plannedArrival!).getTime() - new Date(t.plannedDeparture!).getTime()) / 3600000 * 10) / 10 : 9, costs, marginTarget: 22, priceNet: null, ivaRate: 0.21, validUntil: addDays(today, 15),
      notes: '', terms: 'Pago a 30 días de la factura. Tarifa sujeta a disponibilidad de unidad y a peajes vigentes al momento del viaje.', status: 'borrador', shares: [], acceptance: null, rejection: null, tripId: null, duplicatedFrom: null, createdAt: nowIso, updatedAt: nowIso, createdBy: 'Administración', ...over };
    quotes.push(q); return q;
  };
  // Viajes que nacieron de una cotización aceptada (presupuesto histórico congelado con desvíos reales)
  const planCost = (t: Trip, cat: ExpenseCategory, f: number) => Math.round(t.expenses.filter(e => e.category === cat).reduce((a, e) => a + e.amount, 0) * f / 1000) * 1000;
  const picks = [doneTrips.length - 2, doneTrips.length - 6, doneTrips.length - 11, Math.floor(doneTrips.length * 0.62), Math.floor(doneTrips.length * 0.4), Math.floor(doneTrips.length * 0.2)];
  const factors = [[0.86, 1, 1, 1], [1, 0.9, 1.02, 1], [0.97, 1, 1, 1], [1.12, 1, 1, 1.1], [1, 1, 1, 1], [0.95, 1.05, 1, 1]];
  picks.forEach((ix, k) => {
    const t = doneTrips[ix]; const [ff, ft, fd, fp] = factors[k];
    const q = mkQuote({ status: 'aceptada', createdAt: t.createdAt, updatedAt: t.createdAt, validUntil: addDays(localDate(new Date(t.createdAt), TZ), 20), tripId: t.id,
      shares: [{ id: `s${k}`, at: t.createdAt, channel: 'Correo', by: 'Administración', note: 'Enviada al contacto de compras' }], acceptance: { at: t.createdAt, by: 'Administración', note: 'Aceptada por correo del cliente (registrada manualmente)' } }, t);
    q.costs.fuel = { amount: planCost(t, 'fuel', ff), included: true, source: 'Promedio histórico de la ruta (demo)' };
    q.costs.tolls = { amount: planCost(t, 'tolls', ft), included: true, source: 'Tarifas de peaje vigentes al cotizar (demo)' };
    q.costs.driverPay = { amount: planCost(t, 'driverPay', fd), included: true, source: '14 % del flete (convenio, demo)' };
    q.costs.perDiem = { amount: planCost(t, 'perDiem', fp), included: true, source: 'Viáticos por día de viaje (demo)' };
    q.costs.other = { amount: 0, included: false, source: 'No incluido' };
    const trk = trucks.find(x => x.id === t.truckId)!; const km = (t.kmLoaded ?? 0) + (t.kmEmpty ?? 0);
    q.costs.allocated = { amount: Math.round(monthlyPoolOf(trk) / 2500 * km), included: true, source: `Costos mensuales de ${trk.name} ÷ 2.500 km/mes de referencia (demo)` };
    const c = quoteCalc(q); q.priceNet = t.serviceValue; q.tripId = t.id;
    t.quoteId = q.id; t.budgetSnapshot = snapshotFromQuote(q, { trucks }, t.createdAt, 'Administración'); void c;
    if (k === 0) t.deviationNotes = { fuel: { text: 'Se consiguió gasoil con descuento en la estación de ruta.', by: 'Administración', at: nowIso } };
  });
  // Otras cotizaciones: enviada vigente, enviada por vencer, enviada vencida, borrador, rechazada
  const cl = (i: number) => CLIENTS[i].id;
  const fill = (q: Quote, c: [number, number, number, number, number], truckId: string | null) => { (['fuel', 'tolls', 'driverPay', 'perDiem', 'allocated'] as BudgetCat[]).forEach((k, i) => { q.costs[k] = { amount: c[i], included: true, source: 'Estimación inicial (demo)' }; }); q.truckId = truckId; if (truckId) q.vehicleType = ''; return q; };
  fill(mkQuote({ clientId: cl(1), origin: 'Rosario', destination: 'Mendoza', kmLoaded: 950, kmEmpty: 950, plannedHours: 36, status: 'enviada', validUntil: addDays(today, 10), shares: [{ id: 'sh1', at: addDays(today, -4) + 'T14:00:00.000Z', channel: 'WhatsApp', by: 'Administración', note: 'Enviada al jefe de logística' }] }), [1_420_000, 85_000, 360_000, 114_000, 560_000], 'T4');
  fill(mkQuote({ clientId: cl(2), origin: 'Rosario', destination: 'Santa Fe', kmLoaded: 170, kmEmpty: 170, plannedHours: 5, status: 'enviada', validUntil: addDays(today, 2), shares: [{ id: 'sh2', at: addDays(today, -12) + 'T10:00:00.000Z', channel: 'Correo', by: 'Operador', note: '' }] }), [260_000, 20_000, 90_000, 38_000, 150_000], 'T1');
  fill(mkQuote({ clientId: cl(4), origin: 'Rosario', destination: 'Bahía Blanca', kmLoaded: 650, kmEmpty: 650, plannedHours: 22, status: 'enviada', validUntil: addDays(today, -6), shares: [{ id: 'sh3', at: addDays(today, -25) + 'T10:00:00.000Z', channel: 'Correo', by: 'Administración', note: '' }] }), [900_000, 110_000, 270_000, 76_000, 380_000], 'T2');
  fill(mkQuote({ clientId: cl(5), origin: 'Rosario', destination: 'Tucumán', kmLoaded: 1050, kmEmpty: 1050, plannedHours: 40, status: 'borrador', validUntil: addDays(today, 20) }), [1_550_000, 60_000, 390_000, 114_000, 610_000], 'T5');
  fill(mkQuote({ clientId: cl(6), origin: 'Rosario', destination: 'Córdoba', kmLoaded: 400, kmEmpty: 400, plannedHours: 9, status: 'rechazada', validUntil: addDays(today, -3), shares: [{ id: 'sh4', at: addDays(today, -15) + 'T09:00:00.000Z', channel: 'Correo', by: 'Administración', note: '' }], rejection: { at: addDays(today, -9) + 'T12:00:00.000Z', by: 'Administración', reason: 'El cliente consiguió una tarifa menor con otro transportista.' } }), [650_000, 70_000, 195_000, 38_000, 280_000], 'T3');

  // Gastos cargados por choferes (pendientes de revisión y uno rechazado) y asignaciones para el portal
  const lastDone = doneTrips[doneTrips.length - 1];
  lastDone.expenses.push({ id: 'ex-ped-1', category: 'other', amount: 18_500, date: localDate(new Date(lastDone.actualArrival!), TZ), note: 'Playa de estacionamiento en destino', status: 'pendiente_revision', createdBy: DRIVERS.find(x => x.id === lastDone.driverId)!.name, createdById: `u-${lastDone.driverId.toLowerCase()}` });
  lastDone.expenseConfirmed.other = undefined;
  const rej = doneTrips[doneTrips.length - 4]; rej.expenses.push({ id: 'ex-rej-1', category: 'other', amount: 42_000, date: localDate(new Date(rej.actualArrival!), TZ), note: 'Reparación de cubierta', status: 'rechazado', rejectionReason: 'El ticket no es legible; volvé a cargarlo con una foto nítida.', reviewedBy: 'Administración', reviewedAt: nowIso, createdBy: DRIVERS.find(x => x.id === rej.driverId)!.name, createdById: `u-${rej.driverId.toLowerCase()}` });
  const t1 = trips.filter(t => t.truckId === 'T1'); const nxt = trips.find(t => t.status === 'planificado' && t.truckId === 'T1');
  if (!nxt) { const r = ROUTES[0]; trips.push({ id: `V-${today.slice(0, 4)}-${String(trips.length + 1).padStart(4, '0')}`, clientId: CLIENTS[0].id, origin: r.o, destination: r.d, truckId: 'T1', driverId: 'D1', status: 'planificado', plannedDeparture: iso(addDays(today, 1), 5, 30), plannedArrival: iso(addDays(today, 1), 12), actualDeparture: null, actualArrival: null, kmLoaded: r.km, kmEmpty: null, odometerStart: null, odometerEnd: null, serviceValue: 990_000, ivaRate: 0.21, expenses: [], expenseConfirmed: {}, notes: '', instructions: 'Retirar la carga en el depósito de Molinos del Paraná (puerta 3). Presentar remito conformado en destino.', createdAt: nowIso, updatedAt: nowIso }); }
  else nxt.instructions = 'Retirar la carga en el depósito del cliente (puerta 3). Presentar remito conformado en destino.';
  void t1;

  // Gestión de cobranzas: acciones registradas y compromisos de pago
  const collections: CollectionAction[] = [];
  const overdueClients = ['C7', 'C2', 'C5'];
  overdueClients.forEach((cid, i) => collections.push({ id: `G${i + 1}`, clientId: cid, at: addDays(today, -(6 + i * 3)) + 'T13:30:00.000Z', by: 'Administración', channel: i === 1 ? 'Teléfono' : 'Correo', note: i === 0 ? 'Se envió recordatorio con estado de cuenta; piden reenviar facturas.' : 'Conversación con administración: están a la espera de la aprobación de pago.',
    promise: i === 0 ? { date: addDays(today, 5), amount: 3_000_000, status: 'pendiente' } : i === 1 ? { date: addDays(today, -2), amount: null, status: 'pendiente' } : null, nextAction: { date: addDays(today, 3 + i), text: i === 0 ? 'Confirmar recepción del pago' : 'Volver a llamar' } }));

  const users = ([['u-admin', 'Administración', 'administrador'], ['u-oper', 'Operador de tráfico', 'operador'], ['u-cons', 'Gerencia (solo consulta)', 'consulta'],
    ...DRIVERS.map(d => [`u-${d.id.toLowerCase()}`, d.name, 'chofer'])] as [string, string, 'administrador' | 'operador' | 'consulta' | 'chofer'][]).map(([id, name, role]) => ({ id, name, role, driverId: role === 'chofer' ? id.slice(2).toUpperCase() : undefined, salt: '', pinHash: '' }));
  void monthEnd; void nextMonth;
  return {
    companyId, isDemo: true,
    settings: {
      companyName: 'Transportes del Litoral', legalName: 'Transportes del Litoral S.R.L. (datos de demostración)', cuit: '30-00000000-0', address: 'Av. Circunvalación 1234, Rosario, Santa Fe', phone: '+54 341 000-0000',
      email: 'administracion@ejemplo.com.ar', logoDataUrl: null, currency: 'ARS', timezone: TZ, reportRecipients: ['gerencia@ejemplo.com.ar'], marginTarget: 22,
      profitabilityBasis: 'net', defaultIvaRate: 0.21, dueSoonDays: 7, monthlyReportDay: 1, monthlyReportHour: 6, emailOnTripReport: false, emailOnMonthlyReport: true, emailOverdueDigest: false, aiNarrative: false,
      fuelPricePerLiter: 1700, deviationAlertPct: 10, quoteValidityDays: 15, quoteTerms: 'Pago a 30 días de la factura. Tarifa sujeta a disponibilidad de unidad y a peajes vigentes al momento del viaje.', agingBuckets: [30, 60, 90], docAlertDays: [30, 15, 7], documentTypes: docTypes, emailDocAlerts: false, maxFileKb: 5000, driverPortal: { showTripValue: false, showExpenseTotals: false },
    },
    clients: CLIENTS, drivers: DRIVERS, trucks, trips, invoices, payments,
    tripReports: [], monthlyReports: [], jobs: [], emails: [], notices: [], audit: [],
    users, quotes, documents, files: [], collections, messages: [],
  };
}
void (null as unknown as TripStatus);
