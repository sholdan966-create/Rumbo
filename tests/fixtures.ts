import { CompanyData, Settings, Trip, Truck } from '../src/shared/types';

export const settings: Settings = {
  companyName: 'Demo', legalName: 'Demo SRL', cuit: '', address: '', phone: '', email: '', logoDataUrl: null, currency: 'ARS',
  timezone: 'America/Argentina/Buenos_Aires', reportRecipients: [], marginTarget: 20, profitabilityBasis: 'net', defaultIvaRate: 0.21,
  dueSoonDays: 7, monthlyReportDay: 1, monthlyReportHour: 6, emailOnTripReport: false, emailOnMonthlyReport: false, emailOverdueDigest: false, aiNarrative: false,
  fuelPricePerLiter: 1700, deviationAlertPct: 10, quoteValidityDays: 15, quoteTerms: 'Pago a 30 días', agingBuckets: [30, 60, 90], docAlertDays: [30, 15, 7],
  documentTypes: [{ id: 'seguro', label: 'Seguro', ownerType: 'vehiculo', hasExpiry: true, required: true }, { id: 'licencia', label: 'Licencia', ownerType: 'chofer', hasExpiry: true, required: false }],
  emailDocAlerts: false, maxFileKb: 5000, driverPortal: { showTripValue: false, showExpenseTotals: false },
};
export const truck = (id = 'T1', over: Partial<Truck> = {}): Truck => ({
  id, name: `Camión ${id}`, plate: 'AA123BB', model: 'X', year: 2020, odometerKm: 100000, odometerDate: '2026-01-01',
  params: { maintenancePerKm: 150, tireSetCost: 9_000_000, tireLifeKm: 90_000, baseValue: 140_000_000, residualValue: 40_000_000, lifeKm: 1_000_000, updatedAt: '2026-01-01' },
  monthlyFixedCosts: [{ id: 'f', label: 'Seguro', amount: 1_000_000 }], servicePlans: [], serviceHistory: [], ...over,
});
export const trip = (id: string, over: Partial<Trip> = {}): Trip => ({
  id, clientId: 'C1', origin: 'Rosario', destination: 'Córdoba', truckId: 'T1', driverId: 'D1', status: 'finalizado',
  plannedDeparture: null, plannedArrival: null, actualDeparture: '2026-10-10T09:00:00.000Z', actualArrival: '2026-10-10T18:00:00.000Z',
  kmLoaded: 400, kmEmpty: 400, odometerStart: null, odometerEnd: null, serviceValue: 1_000_000, ivaRate: 0.21,
  expenses: [
    { id: 'a', category: 'fuel', amount: 300_000 }, { id: 'b', category: 'tolls', amount: 50_000 },
    { id: 'c', category: 'driverPay', amount: 100_000 }, { id: 'd', category: 'perDiem', amount: 50_000 },
  ], expenseConfirmed: { other: true }, notes: '', createdAt: '', updatedAt: '', ...over,
});
export const data = (over: Partial<CompanyData> = {}): CompanyData => ({
  companyId: 'x', isDemo: true, settings, clients: [{ id: 'C1', name: 'Cliente 1', cuit: '', paymentTermDays: 30 }],
  drivers: [{ id: 'D1', name: 'Chofer 1' }], trucks: [truck()], trips: [], invoices: [], payments: [], tripReports: [], monthlyReports: [],
  jobs: [], emails: [], notices: [], audit: [], users: [], quotes: [], documents: [], files: [], collections: [], messages: [], ...over,
});
