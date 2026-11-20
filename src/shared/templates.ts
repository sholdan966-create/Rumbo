// Plantilla inicial para empresas de transporte de cargas de Rosario y el Gran Rosario.
// Son valores de partida editables: la empresa debe verificar qué documentación y requisitos corresponden a su operación.
import { CompanyData, DocType, Settings } from './types';

export const ROSARIO_TZ = 'America/Argentina/Buenos_Aires';

/** Localidades frecuentes (solo para autocompletar origen y destino; no fijan distancias ni tarifas). */
export const ROSARIO_PLACES = [
  'Rosario', 'Granadero Baigorria', 'Capitán Bermúdez', 'Fray Luis Beltrán', 'Puerto General San Martín', 'San Lorenzo', 'Timbúes', 'Puerto Gaboto',
  'Villa Gobernador Gálvez', 'Pérez', 'Zavalla', 'Funes', 'Roldán', 'Arroyo Seco', 'Villa Constitución', 'Casilda', 'Cañada de Gómez',
  'San Nicolás', 'Ramallo', 'Zárate', 'Campana', 'Buenos Aires', 'Pergamino', 'Venado Tuerto', 'Rufino', 'Rafaela', 'Santa Fe', 'Paraná',
  'Villa María', 'Río Cuarto', 'Córdoba', 'Bahía Blanca', 'Mendoza', 'San Luis', 'Tucumán', 'Salta', 'Resistencia', 'Corrientes', 'Posadas', 'Neuquén',
];

export const ROSARIO_DOC_TYPES: DocType[] = [
  { id: 'seguro', label: 'Seguro del vehículo', ownerType: 'vehiculo', hasExpiry: true, required: true },
  { id: 'rto', label: 'Revisión técnica obligatoria (RTO)', ownerType: 'vehiculo', hasExpiry: true, required: true },
  { id: 'cedula', label: 'Cédula del vehículo', ownerType: 'vehiculo', hasExpiry: false, required: false },
  { id: 'habilitacion_veh', label: 'Habilitación del vehículo para transporte', ownerType: 'vehiculo', hasExpiry: true, required: false },
  { id: 'licencia', label: 'Licencia de conducir profesional', ownerType: 'chofer', hasExpiry: true, required: true },
  { id: 'linti', label: 'Licencia nacional interjurisdiccional (LiNTI)', ownerType: 'chofer', hasExpiry: true, required: false },
  { id: 'psico', label: 'Examen psicofísico', ownerType: 'chofer', hasExpiry: true, required: false },
  { id: 'art', label: 'Cobertura de ART / seguro del chofer', ownerType: 'chofer', hasExpiry: true, required: false },
  { id: 'habilitacion', label: 'Habilitación de transporte de la empresa', ownerType: 'empresa', hasExpiry: true, required: false },
  { id: 'seguro_rc', label: 'Seguro de responsabilidad civil / carga', ownerType: 'empresa', hasExpiry: true, required: false },
];

/** Rubros de costo mensual que se reparten por km entre los viajes de cada camión. Importes en $0 hasta que la empresa los cargue. */
export const DEFAULT_PAYMENT_METHODS = ['Transferencia', 'Efectivo', 'Cheque', 'Echeq', 'Mercado Pago', 'Tarjeta', 'Cuenta corriente', 'Otro'];

export const FIXED_COST_TEMPLATE = ['Seguro', 'Patente y tasas', 'Rastreo satelital', 'Cochera o playa', 'Administración'];

export const rosarioSettings = (over: Partial<Settings> = {}): Settings => ({
  companyName: '', legalName: '', cuit: '', address: '', phone: '', email: '', logoDataUrl: null, currency: 'ARS', timezone: ROSARIO_TZ, reportRecipients: [],
  marginTarget: 20, profitabilityBasis: 'net', defaultIvaRate: 0.21, dueSoonDays: 7, monthlyReportDay: 1, monthlyReportHour: 6,
  emailOnTripReport: false, emailOnMonthlyReport: false, emailOverdueDigest: false, aiNarrative: false,
  fuelPricePerLiter: null, deviationAlertPct: 10, quoteValidityDays: 15,
  quoteTerms: 'Pago a 30 días de la fecha de factura. La tarifa está sujeta a disponibilidad de unidad y a los peajes y combustible vigentes al momento del viaje. Demoras en carga o descarga pueden generar costos adicionales.',
  agingBuckets: [30, 60, 90], docAlertDays: [30, 15, 7], documentTypes: ROSARIO_DOC_TYPES, emailDocAlerts: false, maxFileKb: 5000, paymentMethods: DEFAULT_PAYMENT_METHODS,
  driverPortal: { showTripValue: false, showExpenseTotals: false }, ...over,
});

export const emptyCompany = (companyId: string): CompanyData => ({
  companyId, isDemo: false, settings: rosarioSettings(), clients: [], drivers: [], trucks: [], trips: [], invoices: [], payments: [], tripReports: [], monthlyReports: [],
  jobs: [], emails: [], notices: [], audit: [], users: [], quotes: [], documents: [], files: [], collections: [], messages: [],
});
