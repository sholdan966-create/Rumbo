import { CompanyData, Trip, TripCalc } from '../shared/types';
import { routeKey, tripMonth } from '../shared/calc';

export const routesOf = (d: CompanyData): string[] => [...new Set(d.trips.map(routeKey))].sort((a, b) => a.localeCompare(b, 'es'));
export const monthsOf = (d: CompanyData): string[] => [...new Set(d.trips.map(t => tripMonth(t, d.settings.timezone)).filter((m): m is string => !!m))].sort().reverse();
export interface TripFilter { month?: string; truck?: string; route?: string; client?: string; status?: string; q?: string; pending?: boolean }
export function filterTrips(d: CompanyData, calcs: Map<string, TripCalc>, f: TripFilter): Trip[] {
  const tz = d.settings.timezone; const q = f.q?.trim().toLowerCase();
  return d.trips.filter(t => {
    if (f.month && tripMonth(t, tz) !== f.month) return false;
    if (f.truck && t.truckId !== f.truck) return false;
    if (f.route && routeKey(t) !== f.route) return false;
    if (f.client && t.clientId !== f.client) return false;
    if (f.status && t.status !== f.status) return false;
    if (f.pending && !(t.status === 'finalizado' && !calcs.get(t.id)!.complete)) return false;
    if (q) {
      const hay = [t.id, d.clients.find(c => c.id === t.clientId)?.name, d.drivers.find(x => x.id === t.driverId)?.name, d.trucks.find(x => x.id === t.truckId)?.name, d.trucks.find(x => x.id === t.truckId)?.plate, routeKey(t), t.notes].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
export const nameOf = {
  client: (d: CompanyData, id: string) => d.clients.find(c => c.id === id)?.name ?? '—',
  truck: (d: CompanyData, id: string) => d.trucks.find(c => c.id === id)?.name ?? '—',
  driver: (d: CompanyData, id: string) => d.drivers.find(c => c.id === id)?.name ?? '—',
};
export const monthName = (m: string): string => {
  const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};
