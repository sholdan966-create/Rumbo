// Importación de viajes desde CSV / Excel: parseo, correspondencia de columnas, validación y duplicados.
import { CompanyData, Trip, TripStatus, ExpenseCategory } from './types';
import { localInputToIso } from './time';
import { findDuplicates, validateTrip } from './validate';
import { operationInstant } from './calc';

export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const first = clean.split(/\r?\n/)[0] ?? '';
  const delim = [';', '\t', ','].map(d => ({ d, n: first.split(d).length })).sort((a, b) => b.n - a.n)[0].d;
  const rows: string[][] = []; let row: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (q) { if (ch === '"') { if (clean[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && clean[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

export interface ImportField { key: string; label: string; required?: boolean; aliases: string[] }
export const IMPORT_FIELDS: ImportField[] = [
  { key: 'id', label: 'Identificador', aliases: ['id', 'viaje', 'nro viaje', 'numero', 'identificador'] },
  { key: 'client', label: 'Cliente', required: true, aliases: ['cliente'] },
  { key: 'origin', label: 'Origen', required: true, aliases: ['origen'] },
  { key: 'destination', label: 'Destino', required: true, aliases: ['destino'] },
  { key: 'truck', label: 'Camión', required: true, aliases: ['camion', 'camión', 'patente', 'unidad'] },
  { key: 'driver', label: 'Chofer', required: true, aliases: ['chofer', 'conductor'] },
  { key: 'status', label: 'Estado', aliases: ['estado'] },
  { key: 'plannedDeparture', label: 'Salida prevista', aliases: ['salida prevista', 'salida_prevista'] },
  { key: 'plannedArrival', label: 'Llegada prevista', aliases: ['llegada prevista', 'llegada_prevista'] },
  { key: 'actualDeparture', label: 'Salida real', aliases: ['salida real', 'salida_real', 'salida'] },
  { key: 'actualArrival', label: 'Llegada real', aliases: ['llegada real', 'llegada_real', 'llegada'] },
  { key: 'kmLoaded', label: 'Km con carga', aliases: ['km con carga', 'km_carga', 'km carga'] },
  { key: 'kmEmpty', label: 'Km vacíos', aliases: ['km vacios', 'km vacíos', 'km_vacio', 'km vacio'] },
  { key: 'odometerStart', label: 'Odómetro inicial', aliases: ['odometro inicial', 'odómetro inicial', 'odometro_inicio'] },
  { key: 'odometerEnd', label: 'Odómetro final', aliases: ['odometro final', 'odómetro final', 'odometro_fin'] },
  { key: 'serviceValue', label: 'Valor del servicio (neto)', required: true, aliases: ['valor del servicio', 'valor_servicio', 'importe', 'valor', 'tarifa'] },
  { key: 'fuel', label: 'Combustible', aliases: ['combustible'] },
  { key: 'tolls', label: 'Peajes', aliases: ['peajes', 'peaje'] },
  { key: 'driverPay', label: 'Chofer (pago)', aliases: ['pago chofer', 'chofer_pago', 'sueldo chofer', 'comision chofer'] },
  { key: 'perDiem', label: 'Viáticos', aliases: ['viaticos', 'viáticos'] },
  { key: 'other', label: 'Otros gastos', aliases: ['otros', 'otros gastos'] },
  { key: 'notes', label: 'Observaciones', aliases: ['observaciones', 'notas'] },
];
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[_\-]+/g, ' ').trim();

/** Correspondencia automática columna -> campo (por nombre). Devuelve índice de columna por campo, o -1. */
export function autoMap(headers: string[]): Record<string, number> {
  const out: Record<string, number> = {}; const used = new Set<number>();
  for (const f of IMPORT_FIELDS) {
    const names = [f.label, ...f.aliases].map(norm);
    let idx = headers.findIndex((h, i) => !used.has(i) && names.includes(norm(h)));
    out[f.key] = idx; if (idx >= 0) used.add(idx);
  }
  return out;
}
export const TEMPLATE_HEADERS = ['id', 'cliente', 'origen', 'destino', 'camion', 'chofer', 'estado', 'salida_prevista', 'llegada_prevista', 'salida_real', 'llegada_real', 'km_carga', 'km_vacio', 'odometro_inicio', 'odometro_fin', 'valor_servicio', 'combustible', 'peajes', 'chofer_pago', 'viaticos', 'otros', 'observaciones'];
export const TEMPLATE_EXAMPLE = ['', 'Cliente Ejemplo S.A.', 'Rosario', 'Córdoba', 'Camión 1', 'Nombre Apellido', 'finalizado', '15/10/2026 06:00', '15/10/2026 12:00', '15/10/2026 06:10', '15/10/2026 12:20', '400', '400', '', '', '1320000', '520000', '85000', '210000', '40000', '0', 'Ejemplo: celda vacía = dato pendiente; 0 = gasto confirmado en $0'];

/** Número en formato argentino (1.234,56) o internacional (1234.56). Vacío => null. NaN => undefined (inválido). */
export function parseNumber(raw: string): number | null | undefined {
  let s = raw.trim().replace(/[$\s]/g, ''); if (s === '') return null;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s); return Number.isFinite(n) ? n : undefined;
}
export function parseDateTime(raw: string, tz: string): string | null | undefined {
  const s = raw.trim(); if (!s) return null;
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(s);
  let naive: string | null = null;
  if (m) naive = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T${(m[4] ?? '0').padStart(2, '0')}:${m[5] ?? '00'}`;
  else if ((m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s))) naive = `${m[1]}-${m[2]}-${m[3]}T${(m[4] ?? '0').padStart(2, '0')}:${m[5] ?? '00'}`;
  if (!naive) return undefined;
  return localInputToIso(naive, tz) ?? undefined;
}
const STATUS: Record<string, TripStatus> = { planificado: 'planificado', 'en curso': 'en_curso', encurso: 'en_curso', en_curso: 'en_curso', finalizado: 'finalizado', cancelado: 'cancelado' };

export interface ImportRowResult {
  row: number; // número de fila en el archivo (1 = encabezado)
  trip?: Trip; errors: string[]; warnings: string[]; duplicate?: string;
  newClient?: string; newDriver?: string;
}
export interface ImportResult { rows: ImportRowResult[]; accepted: number; rejected: number; duplicates: number }

export function nextTripId(trips: { id: string }[], year: number): string {
  const re = new RegExp(`^V-${year}-(\\d+)$`);
  const max = trips.reduce((m, t) => { const x = re.exec(t.id); return x ? Math.max(m, Number(x[1])) : m; }, 0);
  return `V-${year}-${String(max + 1).padStart(4, '0')}`;
}

export function mapRows(data: string[][], map: Record<string, number>, d: CompanyData, nowIso: string, genId: (existing: { id: string }[]) => string): ImportResult {
  const tz = d.settings.timezone; const rows: ImportRowResult[] = [];
  const pending: Trip[] = []; // viajes aceptados dentro del mismo archivo
  const newClients = new Set<string>(), newDrivers = new Set<string>();
  data.slice(1).forEach((r, i) => {
    const res: ImportRowResult = { row: i + 2, errors: [], warnings: [] };
    const cell = (k: string) => (map[k] >= 0 && map[k] != null ? (r[map[k]] ?? '').trim() : '');
    const num = (k: string, label: string): number | null => {
      const v = parseNumber(cell(k)); if (v === undefined) { res.errors.push(`${label}: "${cell(k)}" no es un número válido`); return null; } return v;
    };
    const dt = (k: string, label: string): string | null => {
      const v = parseDateTime(cell(k), tz); if (v === undefined) { res.errors.push(`${label}: fecha u hora inválida ("${cell(k)}")`); return null; } return v;
    };
    for (const f of IMPORT_FIELDS) if (f.required && !cell(f.key) && f.key !== 'serviceValue') res.errors.push(`Falta ${f.label.toLowerCase()}`);
    const clientName = cell('client'); const driverName = cell('driver'); const truckRef = cell('truck');
    const truck = d.trucks.find(t => norm(t.name) === norm(truckRef) || norm(t.plate) === norm(truckRef));
    if (truckRef && !truck) res.errors.push(`Camión "${truckRef}" no existe en la flota`);
    let client = d.clients.find(c => norm(c.name) === norm(clientName));
    let driver = d.drivers.find(x => norm(x.name) === norm(driverName));
    const stRaw = cell('status'); const status = stRaw ? STATUS[norm(stRaw)] : 'finalizado';
    if (stRaw && !status) res.errors.push(`Estado "${stRaw}" no reconocido`);
    const sv = num('serviceValue', 'Valor del servicio');
    if (cell('serviceValue') === '') res.errors.push('Falta valor del servicio');
    const expenses: Trip['expenses'] = []; const confirmed: Trip['expenseConfirmed'] = {};
    (['fuel', 'tolls', 'driverPay', 'perDiem', 'other'] as ExpenseCategory[]).forEach(k => {
      const v = num(k, k); if (v == null) return;
      if (v === 0) confirmed[k] = true; else if (v < 0) res.errors.push(`Gasto negativo en ${k}`); else expenses.push({ id: `imp-${k}`, category: k, amount: v });
    });
    const trip: Trip = {
      id: cell('id') || '', clientId: client?.id ?? `new:${clientName}`, origin: cell('origin'), destination: cell('destination'),
      truckId: truck?.id ?? '', driverId: driver?.id ?? `new:${driverName}`, status: status ?? 'finalizado',
      plannedDeparture: dt('plannedDeparture', 'Salida prevista'), plannedArrival: dt('plannedArrival', 'Llegada prevista'),
      actualDeparture: dt('actualDeparture', 'Salida real'), actualArrival: dt('actualArrival', 'Llegada real'),
      kmLoaded: num('kmLoaded', 'Km con carga'), kmEmpty: num('kmEmpty', 'Km vacíos'),
      odometerStart: num('odometerStart', 'Odómetro inicial'), odometerEnd: num('odometerEnd', 'Odómetro final'),
      serviceValue: sv, ivaRate: d.settings.defaultIvaRate, expenses, expenseConfirmed: confirmed, notes: cell('notes'),
      createdAt: nowIso, updatedAt: nowIso,
    };
    if (!trip.id) trip.id = genId([...d.trips, ...pending]);
    else if (d.trips.some(t => t.id === trip.id) || pending.some(t => t.id === trip.id)) res.errors.push(`El identificador ${trip.id} ya existe`);
    if (clientName && !client) { res.newClient = clientName; newClients.add(clientName); }
    if (driverName && !driver) { res.newDriver = driverName; newDrivers.add(driverName); }
    if (!res.errors.length) {
      // validar con clientes/choferes provisorios incluidos
      const ctx = { ...d, clients: [...d.clients, ...(res.newClient ? [{ id: trip.clientId, name: clientName, cuit: '', paymentTermDays: 30 }] : [])], drivers: [...d.drivers, ...(res.newDriver ? [{ id: trip.driverId, name: driverName }] : [])], trips: [...d.trips, ...pending] };
      const v = validateTrip(trip, ctx, false);
      res.errors.push(...v.errors.map(e => e.message)); res.warnings.push(...v.warnings.map(e => e.message));
      const dup = findDuplicates(trip, ctx.trips, tz)[0];
      if (dup) { res.duplicate = dup.id; res.errors.push(`Posible duplicado de ${dup.id} (mismo cliente, ruta, camión, día e importe)`); }
      if (operationInstant(trip) == null) res.errors.push('Falta una fecha de salida (prevista o real)');
    }
    if (!res.errors.length) { res.trip = trip; pending.push(trip); }
    rows.push(res);
  });
  return { rows, accepted: rows.filter(r => r.trip).length, rejected: rows.filter(r => !r.trip).length, duplicates: rows.filter(r => r.duplicate).length };
}
