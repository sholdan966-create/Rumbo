// Modelo de datos compartido entre cliente y servidor.
// Convenciones:
//  - Fechas y horas de operación: ISO 8601 en UTC (se muestran en la zona horaria de la empresa).
//  - Fechas de facturación, vencimiento y cobro: 'YYYY-MM-DD' (fecha calendario).
//  - Un importe `null` significa "pendiente de carga". Un `0` es un valor confirmado.

export type TripStatus = 'planificado' | 'en_curso' | 'finalizado' | 'cancelado';

export type ExpenseCategory = 'fuel' | 'tolls' | 'driverPay' | 'perDiem' | 'other';
export const EXPENSE_CATEGORIES: ExpenseCategory[] = ['fuel', 'tolls', 'driverPay', 'perDiem', 'other'];
/** Categorías que deben estar registradas (o confirmadas en $0) para considerar completo un viaje finalizado. */
export const REQUIRED_EXPENSES: ExpenseCategory[] = ['fuel', 'tolls', 'driverPay', 'perDiem'];
export const EXPENSE_LABEL: Record<ExpenseCategory, string> = {
  fuel: 'Combustible', tolls: 'Peajes', driverPay: 'Chofer', perDiem: 'Viáticos', other: 'Otros gastos',
};

export type ExpenseStatus = 'pendiente_revision' | 'aprobado' | 'rechazado';
export interface Expense {
  id: string;
  category: ExpenseCategory;
  amount: number;
  date?: string; // YYYY-MM-DD
  note?: string;
  /** Sin valor = cargado por la oficina (cuenta como aprobado). Los gastos del chofer nacen 'pendiente_revision'. */
  status?: ExpenseStatus;
  rejectionReason?: string;
  createdBy?: string; // nombre del usuario
  createdById?: string;
  reviewedBy?: string;
  reviewedAt?: string;
}
export type BudgetCat = ExpenseCategory | 'allocated';
export const BUDGET_CATS: BudgetCat[] = ['fuel', 'tolls', 'driverPay', 'perDiem', 'other', 'allocated'];
export const BUDGET_LABEL: Record<BudgetCat, string> = { ...EXPENSE_LABEL, allocated: 'Costos operativos asignados' };

export interface Incident { id: string; at: string; by: string; text: string }
export interface TimeCorrection { id: string; field: 'actualDeparture' | 'actualArrival'; oldValue: string | null; newValue: string; reason: string; by: string; at: string }
/** Copia INMODIFICABLE del presupuesto aceptado de una cotización y sus supuestos. */
export interface BudgetSnapshot {
  quoteId: string; quoteNumber: string; acceptedAt: string; acceptedBy: string;
  revenueNet: number; ivaRate: number; marginTarget: number; suggestedNet: number;
  costs: Record<BudgetCat, number>; included: Record<BudgetCat, boolean>; assumptions: Record<BudgetCat, string>;
  kmLoaded: number | null; kmEmpty: number | null; plannedHours: number | null; vehicleLabel: string;
}

export interface Stop { id: string; start: string; end: string; reason?: string }

export interface Trip {
  id: string; // p. ej. V-2026-0001
  clientId: string;
  origin: string;
  destination: string;
  truckId: string;
  driverId: string;
  status: TripStatus;
  plannedDeparture: string | null;
  plannedArrival: string | null;
  actualDeparture: string | null;
  actualArrival: string | null;
  kmLoaded: number | null;
  kmEmpty: number | null;
  odometerStart: number | null;
  odometerEnd: number | null;
  serviceValue: number | null; // importe NETO del servicio
  ivaRate: number; // 0.21
  expenses: Expense[];
  /** Categorías confirmadas aunque no tengan gastos (gasto confirmado de $0). */
  expenseConfirmed: Partial<Record<ExpenseCategory, boolean>>;
  budget?: Partial<Record<ExpenseCategory, number>>;
  stops?: Stop[];
  notes: string;
  instructions?: string; // indicaciones para el chofer
  quoteId?: string;
  budgetSnapshot?: BudgetSnapshot;
  deviationNotes?: Record<string, { text: string; by: string; at: string }>;
  incidents?: Incident[];
  timeCorrections?: TimeCorrection[];
  driverDone?: { at: string; by: string } | null; // el chofer marcó el trabajo como terminado
  reviewedAt?: string | null; // revisión administrativa
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceLine { tripId: string; net: number }
export interface Adjustment { id: string; date: string; amount: number; reason: string } // amount negativo = nota de crédito
export interface Invoice {
  id: string;
  number: string;
  clientId: string;
  issueDate: string;
  dueDate: string;
  ivaRate: number;
  lines: InvoiceLine[];
  adjustments: Adjustment[];
  notes?: string;
}
export interface Payment {
  id: string; invoiceId: string; date: string; amount: number; method: string; reference?: string;
}

export interface Contact { id: string; name: string; role: string; email: string; phone: string }
export interface Client { id: string; name: string; cuit: string; paymentTermDays: number; contacts?: Contact[]; notes?: string }
export interface Driver { id: string; name: string }

export interface ServicePlan {
  id: string;
  name: string;
  intervalKm: number | null;
  intervalDays: number | null;
  lastKm: number | null;
  lastDate: string | null;
  alertBeforeKm: number | null;
  alertBeforeDays: number | null;
  source: string; // origen del intervalo: "Configurado por la empresa", "Indicación del manual", etc.
}
export interface ServiceRecord { id: string; name: string; date: string; km: number | null; cost: number | null; note?: string }

export interface UsageParams {
  maintenancePerKm: number | null;
  tireSetCost: number | null;
  tireLifeKm: number | null;
  baseValue: number | null;
  residualValue: number | null;
  lifeKm: number | null;
  fuelLPer100km?: number | null; // consumo de referencia (para cotizar)
  updatedAt: string | null;
}
export interface FixedCost { id: string; label: string; amount: number }

export interface Truck {
  id: string;
  name: string;
  plate: string;
  model: string;
  year: number | null;
  odometerKm: number | null;
  odometerDate: string | null;
  params: UsageParams;
  monthlyFixedCosts: FixedCost[]; // costos operativos mensuales a asignar por km
  servicePlans: ServicePlan[];
  serviceHistory: ServiceRecord[];
}

export interface Settings {
  companyName: string;
  legalName: string;
  cuit: string;
  address: string;
  phone: string;
  email: string;
  logoDataUrl: string | null;
  currency: string; // ARS
  timezone: string; // America/Argentina/Buenos_Aires
  reportRecipients: string[];
  marginTarget: number; // % objetivo
  profitabilityBasis: 'net' | 'gross'; // base de ingresos para rentabilidad
  defaultIvaRate: number;
  dueSoonDays: number;
  monthlyReportDay: number; // día del mes en que se genera el informe del mes anterior
  monthlyReportHour: number;
  emailOnTripReport: boolean;
  emailOnMonthlyReport: boolean;
  emailOverdueDigest: boolean;
  aiNarrative: boolean; // preferencia; la integración está pendiente de configuración
  fuelPricePerLiter: number | null;
  deviationAlertPct: number; // desvío de costo (%) a partir del cual se avisa
  quoteValidityDays: number;
  quoteTerms: string;
  agingBuckets: number[]; // p. ej. [30, 60, 90]
  docAlertDays: number[]; // p. ej. [30, 15, 7]
  documentTypes: DocType[];
  emailDocAlerts: boolean;
  maxFileKb: number;
  paymentMethods?: string[]; // formas de pago ofrecidas al registrar un cobro
  driverPortal: { showTripValue: boolean; showExpenseTotals: boolean }; // márgenes y costos internos nunca se muestran al chofer
}
export type OwnerType = 'empresa' | 'vehiculo' | 'chofer';
export interface DocType { id: string; label: string; ownerType: OwnerType; hasExpiry: boolean; required: boolean }

export type ReportStatus = 'pendiente' | 'generando' | 'disponible' | 'error';
export interface TripReport {
  id: string;
  tripId: string;
  version: number;
  status: ReportStatus;
  provisional: boolean;
  dataVersion: string;
  createdAt: string;
  generatedAt: string | null;
  scheduledFor: string | null;
  attempts: number;
  error: string | null;
  missing: string[];
  fileName: string | null;
  fileSize: number | null;
}

export interface MonthlyReport {
  id: string;
  month: string; // YYYY-MM
  version: number;
  status: ReportStatus;
  provisional: boolean;
  dataVersion: string;
  trigger: 'automatico' | 'manual';
  createdAt: string;
  generatedAt: string | null;
  attempts: number;
  error: string | null;
  missing: string[];
  figures: MonthlyFigures | null;
  analysis: MonthlyAnalysis | null;
  fileName: string | null;
  fileSize: number | null;
}

export interface Job {
  id: string;
  type: 'trip_pdf' | 'monthly_report' | 'notifications' | 'send_email';
  key: string;
  payload: Record<string, unknown>;
  status: 'en_cola' | 'ejecutando' | 'hecho' | 'error' | 'omitido';
  attempts: number;
  maxAttempts: number;
  runAt: string;
  dataVersion?: string;
  result?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmailRecord {
  id: string;
  key: string;
  to: string[];
  subject: string;
  summary: string;
  link: string;
  status: 'pendiente' | 'sin_configurar' | 'enviado' | 'error';
  detail: string;
  createdAt: string;
}

export interface AuditEntry {
  id: string; at: string; user: string; userId?: string; actorType: 'usuario' | 'proceso'; entity: string; entityId: string; action: string; summary: string;
  before?: unknown; after?: unknown; reason?: string; refs?: string[];
}
export interface Notice { id: string; key: string; kind: 'cobro_vencido' | 'datos_pendientes' | 'servicio' | 'documento' | 'compromiso' | 'cotizacion'; text: string; at: string; ref: string }

export interface CompanyData {
  companyId: string;
  isDemo: boolean;
  settings: Settings;
  clients: Client[];
  drivers: Driver[];
  trucks: Truck[];
  trips: Trip[];
  invoices: Invoice[];
  payments: Payment[];
  tripReports: TripReport[];
  monthlyReports: MonthlyReport[];
  jobs: Job[];
  emails: EmailRecord[];
  notices: Notice[];
  audit: AuditEntry[];
  users: User[];
  quotes: Quote[];
  documents: Doc[];
  files: FileMeta[];
  collections: CollectionAction[];
  messages: SentMessage[];
}

export type Role = 'administrador' | 'operador' | 'consulta' | 'chofer';
export interface User { id: string; name: string; username?: string; role: Role; driverId?: string; active?: boolean; kdf?: number; salt: string; pinHash: string }

export type QuoteStatus = 'borrador' | 'enviada' | 'aceptada' | 'rechazada' | 'vencida';
export interface QuoteCost { amount: number; included: boolean; source: string }
export interface Quote {
  id: string; number: string; clientId: string; origin: string; destination: string;
  truckId: string | null; vehicleType: string; kmLoaded: number | null; kmEmpty: number | null; plannedHours: number | null;
  costs: Record<BudgetCat, QuoteCost>;
  marginTarget: number; priceNet: number | null; // null = usar el precio sugerido
  ivaRate: number; validUntil: string; notes: string; terms: string;
  status: Exclude<QuoteStatus, 'vencida'>;
  shares: { id: string; at: string; channel: string; by: string; note: string }[];
  acceptance?: { at: string; by: string; note: string } | null;
  rejection?: { at: string; by: string; reason: string } | null;
  tripId?: string | null; duplicatedFrom?: string | null;
  createdAt: string; updatedAt: string; createdBy: string;
}

export interface Doc {
  id: string; typeId: string; ownerType: OwnerType; ownerId: string; identifier: string; issueDate: string | null; expiryDate: string | null;
  fileId: string | null; notes: string; replacedBy: string | null; supersedes: string | null; createdAt: string; createdBy: string;
}
export type AttachKind = 'viaje' | 'gasto' | 'factura' | 'cliente' | 'camion' | 'chofer' | 'documento' | 'cotizacion' | 'empresa';
export interface FileMeta {
  id: string; name: string; mime: string; size: number; uploadedAt: string; uploadedBy: string; uploadedById: string;
  entityType: AttachKind; entityId: string; description: string; links: { type: AttachKind; id: string }[];
}
export interface CollectionAction {
  id: string; clientId: string; at: string; by: string; channel: string; note: string;
  promise?: { date: string; amount: number | null; status: 'pendiente' | 'cumplido' | 'incumplido' } | null;
  nextAction?: { date: string; text: string } | null;
}
export interface SentMessage {
  id: string; clientId: string; kind: 'recordatorio' | 'estado_cuenta'; channel: 'correo' | 'whatsapp' | 'otro'; at: string; by: string;
  to: string; subject: string; body: string; result: 'enviado' | 'sin_configurar' | 'manual' | 'error' | 'pendiente'; detail: string;
}

// ---- Resultados de cálculo ----
export type N = number | null; // null = No disponible

export interface TripCalc {
  tripId: string;
  kmLoaded: N; kmEmpty: N; kmTotal: N;
  revenueNet: N; revenueGross: N; revenue: N; // revenue = según base de rentabilidad
  direct: Record<ExpenseCategory, number | null>; // null = pendiente de carga
  directTotal: number; // suma de lo registrado
  pendingCategories: ExpenseCategory[];
  allocated: N; // costos operativos asignados (null si no aplica aún)
  totalCost: N;
  result: N; marginPct: N; costPerKm: N; revenuePerKm: N;
  estimates: { maintenance: number; tires: number; depreciation: number; total: number } | null;
  economicResult: N; // resultado − estimaciones (comparativo, no contable)
  invoicedNet: number; invoicedTotal: number; paid: number; balance: number;
  durationMin: N; plannedDurationMin: N; drivingMin: N; stopsMin: N;
  pendingReview: { count: number; amount: number };
  resultIfApproved: N; // resultado si se aprueban todos los gastos pendientes de revisión
  missing: string[];
  complete: boolean;
}

export interface Agg {
  trips: number;
  km: number; // km de viajes con km disponible
  revenue: number;
  direct: Record<ExpenseCategory, number>;
  directTotal: number;
  allocated: number;
  totalCost: number;
  result: number;
  marginPct: N;
  costPerKm: N;
  revenuePerKm: N;
  estimates: number;
  incomplete: number;
}

export interface MonthlyFigures {
  month: string; // YYYY-MM
  prevMonth: string;
  timezone: string;
  basis: 'net' | 'gross';
  cutoffDate: string; // fecha de cierre YYYY-MM-DD
  current: Agg;
  previous: Agg | null; // null = sin datos comparables
  byRoute: (Agg & { route: string })[];
  byTruck: (Agg & { truckId: string; truck: string })[];
  receivables: {
    pending: number; overdue: number; dueSoon: number; current: number;
    byClient: { clientId: string; client: string; pending: number; overdue: number }[];
    fromPreviousMonths: number;
    invoicesOpen: number;
  };
  unbilledTrips: number;
  unallocatedFixed: number;
  incompleteTripIds: string[];
  maintenanceDue: { truck: string; service: string; status: string }[];
  deviations: { tripId: string; route: string; planned: number; actual: number; diff: number; pct: number | null; reliable: boolean }[];
  quoted: { trips: number; plannedRevenue: number; actualRevenue: number; plannedResult: number; actualResult: number; incomplete: number } | null;
  docsAttention: { owner: string; type: string; status: string; days: number | null }[];
  expensesInReview: number;
  collectionPromises: { client: string; date: string; amount: number | null }[];
}
export interface MonthlyAnalysis {
  facts: string[];
  hypotheses: string[]; // posibles causas que requieren investigación
  priorities: { title: string; detail: string }[];
}
