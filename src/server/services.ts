// Lógica de negocio del servidor: programación de informes, trabajos, notificaciones y correo.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { buildMonthlyFigures, computeTrips, currentOdometer, hashString, invoiceTotals, monthlyMissing, serviceStatus, tripDataVersion, tripMonth } from '../shared/calc';
import { buildAnalysis } from '../shared/analysis';
import { localDate, localParts, monthLabel, prevMonth, daysInMonth } from '../shared/time';
import { CompanyData, EmailRecord, Job, MonthlyReport, Notice, Trip, TripReport } from '../shared/types';
import { fmtMoney } from '../shared/format';
import { Store } from './store';
import { Actor, audit } from '../api/core';
import { docAttention } from '../shared/documents';
import { alertThreshold } from '../shared/documents';
import { quoteStatus } from '../shared/quote';
import { renderTripPdf } from './pdf/trip';
import { renderMonthlyPdf } from './pdf/monthly';
import { renderQuotePdf } from './pdf/quote';
import { renderStatementPdf } from './pdf/statement';
import { enhanceNarrative, aiConfigured } from './ai';
import { mailConfigured, sendMail } from './mailer';

const num = (k: string, d: number) => (process.env[k] ? Number(process.env[k]) : d);
/** Espera antes de generar el PDF de un viaje guardado: agrupa ediciones seguidas en una sola versión. Objetivo: disponible en ≤ 3 min. */
export const DEBOUNCE_MS = num('PDF_DEBOUNCE_MS', 20_000);
export const RETRY_BASE_MS = num('RETRY_BASE_MS', 10_000);
export const MAX_ATTEMPTS = 3;
export const APP_URL = process.env.APP_URL ?? 'http://localhost:8787';
export const uid = () => crypto.randomUUID();
let failNext = 0;
export const setFailNext = (n: number) => { failNext = n; };

export const SYS: Actor = { id: 'sistema', name: 'Proceso automático', type: 'proceso' };
const sysAudit = (d: CompanyData, entity: string, id: string, action: string, summary: string, refs: string[] = []) => audit(d, SYS, entity, id, action, summary, { refs });

export class Services {
  private busy = new Set<string>();
  constructor(readonly store: Store) {}

  // ------------------------------------------------------------------ cola de trabajos
  enqueue(companyId: string, j: Pick<Job, 'type' | 'key' | 'payload'> & { runAt?: string; dataVersion?: string }): Job {
    const d = this.store.get(companyId);
    const active = d.jobs.find(x => x.key === j.key && (x.status === 'en_cola' || x.status === 'ejecutando'));
    if (active) return active; // control de duplicados: misma clave activa => no se encola otra vez
    const now = new Date().toISOString();
    const job: Job = { id: uid(), type: j.type, key: j.key, payload: j.payload, status: 'en_cola', attempts: 0, maxAttempts: MAX_ATTEMPTS, runAt: j.runAt ?? now, dataVersion: j.dataVersion, createdAt: now, updatedAt: now };
    d.jobs.unshift(job); if (d.jobs.length > 300) d.jobs.length = 300;
    this.store.save(); return job;
  }

  async tick() {
    for (const cid of this.store.ids()) {
      const d = this.store.get(cid);
      const due = d.jobs.filter(j => j.status === 'en_cola' && j.runAt <= new Date().toISOString() && !this.busy.has(j.id)).reverse();
      for (const job of due) {
        this.busy.add(job.id);
        try { await this.run(cid, job); } finally { this.busy.delete(job.id); }
      }
    }
  }

  private async run(cid: string, job: Job) {
    const d = this.store.get(cid);
    job.status = 'ejecutando'; job.attempts++; job.updatedAt = new Date().toISOString(); this.store.save();
    try {
      const res = await this.handle(cid, job);
      job.status = res.skipped ? 'omitido' : 'hecho'; job.result = res.message; job.error = undefined;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[job ${job.type}] intento ${job.attempts}/${job.maxAttempts} falló:`, msg);
      job.error = msg;
      if (job.attempts < job.maxAttempts) { job.status = 'en_cola'; job.runAt = new Date(Date.now() + RETRY_BASE_MS * job.attempts).toISOString(); }
      else {
        job.status = 'error';
        const rid = job.payload.reportId as string | undefined;
        const tr = d.tripReports.find(r => r.id === rid) ?? d.monthlyReports.find(r => r.id === rid);
        if (tr) { tr.status = 'error'; tr.error = msg; tr.attempts = job.attempts; }
      }
    }
    job.updatedAt = new Date().toISOString(); this.store.save();
  }

  private async handle(cid: string, job: Job): Promise<{ message: string; skipped?: boolean }> {
    switch (job.type) {
      case 'trip_pdf': return this.genTripPdf(cid, job);
      case 'monthly_report': return this.genMonthly(cid, job);
      case 'send_email': return this.deliverEmail(cid, job);
      case 'notifications': return this.runNotifications(cid);
    }
  }

  /** Al reiniciar, los trabajos que quedaron "ejecutando" vuelven a la cola. */
  recover() {
    for (const cid of this.store.ids()) for (const j of this.store.get(cid).jobs) if (j.status === 'ejecutando') { j.status = 'en_cola'; j.runAt = new Date().toISOString(); }
    for (const cid of this.store.ids()) for (const r of this.store.get(cid).tripReports) if (r.status === 'generando' && !this.store.get(cid).jobs.some(j => j.payload.reportId === r.id && j.status === 'en_cola')) { r.status = 'pendiente'; }
    this.store.save();
  }

  // ------------------------------------------------------------------ PDF por viaje
  scheduleTripReport(cid: string, tripId: string, o: { force?: boolean; immediate?: boolean } = {}): { report: TripReport | null; created: boolean; reason: string } {
    const d = this.store.get(cid); const trip = d.trips.find(t => t.id === tripId);
    if (!trip) return { report: null, created: false, reason: 'Viaje inexistente' };
    const dv = tripDataVersion(trip, d);
    const mine = d.tripReports.filter(r => r.tripId === tripId).sort((a, b) => a.version - b.version);
    const latest = mine[mine.length - 1];
    if (latest && (latest.status === 'pendiente')) { latest.dataVersion = dv; this.store.save(); return { report: latest, created: false, reason: 'Ya hay un informe pendiente: se agruparon los cambios' }; }
    if (latest && latest.status === 'generando') return { report: latest, created: false, reason: 'El informe se está generando; se programará otra versión si los datos cambian' };
    if (latest && latest.dataVersion === dv && latest.status === 'disponible') return { report: latest, created: false, reason: 'Sin cambios desde la última versión' };
    if (latest && latest.status === 'error' && latest.dataVersion === dv && !o.force) return { report: latest, created: false, reason: 'El último intento falló: usá Reintentar' };
    const now = new Date();
    const rep: TripReport = {
      id: uid(), tripId, version: (latest?.version ?? 0) + 1, status: 'pendiente', provisional: true, dataVersion: dv, createdAt: now.toISOString(),
      generatedAt: null, scheduledFor: new Date(now.getTime() + (o.immediate ? 0 : DEBOUNCE_MS)).toISOString(), attempts: 0, error: null, missing: [], fileName: null, fileSize: null,
    };
    d.tripReports.push(rep);
    this.enqueue(cid, { type: 'trip_pdf', key: `trip_pdf:${rep.id}`, payload: { reportId: rep.id, tripId }, runAt: rep.scheduledFor!, dataVersion: dv });
    this.store.save();
    return { report: rep, created: true, reason: 'Informe programado' };
  }

  retryTripReport(cid: string, reportId: string) {
    const d = this.store.get(cid); const r = d.tripReports.find(x => x.id === reportId);
    if (!r) return null; if (r.status !== 'error') return r; // doble clic / ya reintentado: no duplica
    r.status = 'pendiente'; r.error = null; r.scheduledFor = new Date().toISOString();
    this.enqueue(cid, { type: 'trip_pdf', key: `trip_pdf:${r.id}`, payload: { reportId: r.id, tripId: r.tripId }, runAt: r.scheduledFor });
    return r;
  }

  retryMonthly(reportId: string) {
    const d = this.store.get('demo'); const r = d.monthlyReports.find(x => x.id === reportId); if (!r) return null;
    if (r.status === 'error') { r.status = 'pendiente'; r.error = null; this.enqueue('demo', { type: 'monthly_report', key: `monthly:${r.id}`, payload: { reportId: r.id, month: r.month } }); this.store.save(); }
    return r;
  }
  /** Reintento manual de un correo que falló: vuelve a la cola sin crear otro registro (no duplica envíos). */
  retryEmail(emailId: string) {
    const d = this.store.get('demo'); const e = d.emails.find(x => x.id === emailId); if (!e) return null;
    if (e.status === 'error' || e.status === 'sin_configurar') { e.status = 'pendiente'; e.detail = 'Reintento en cola'; this.enqueue('demo', { type: 'send_email', key: `send_email:${e.key}:r${Date.now()}`, payload: { emailId: e.id } }); this.store.save(); }
    return e;
  }

  private async genTripPdf(cid: string, job: Job) {
    const d = this.store.get(cid); const rep = d.tripReports.find(r => r.id === job.payload.reportId);
    if (!rep) return { message: 'Informe inexistente', skipped: true };
    if (rep.status === 'disponible') return { message: 'Ya estaba disponible: no se generó de nuevo', skipped: true };
    const trip = d.trips.find(t => t.id === rep.tripId); if (!trip) { rep.status = 'error'; rep.error = 'El viaje ya no existe'; return { message: 'Viaje inexistente', skipped: true }; }
    rep.status = 'generando'; rep.attempts = job.attempts; this.store.save();
    if (failNext > 0) { failNext--; throw new Error('Fallo simulado (modo demostración)'); }
    const now = new Date(); const dv = tripDataVersion(trip, d);
    const calc = computeTrips({ settings: d.settings, trucks: d.trucks, trips: d.trips, invoices: d.invoices, payments: d.payments, now }).get(trip.id)!;
    const provisional = trip.status !== 'finalizado' || !calc.complete;
    const buf = await renderTripPdf({ data: d, trip, calc, version: rep.version, provisional, generatedAt: now.toISOString() });
    const name = `${trip.id}_v${rep.version}.pdf`;
    fs.writeFileSync(this.store.filePath(cid, name), buf);
    Object.assign(rep, { status: 'disponible', provisional, dataVersion: dv, generatedAt: now.toISOString(), missing: calc.missing, fileName: name, fileSize: buf.length, error: null, attempts: job.attempts });
    job.dataVersion = dv;
    sysAudit(d, 'informe', trip.id, 'generado', `Ficha de viaje ${trip.id} v${rep.version} (${provisional ? 'provisoria' : 'completa'})`, [trip.clientId, trip.truckId, trip.driverId]);
    if (d.settings.emailOnTripReport && d.settings.reportRecipients.length)
      this.queueEmail(cid, { key: `email:trip:${rep.id}`, to: d.settings.reportRecipients, subject: `Ficha del viaje ${trip.id} (v${rep.version})`, summary: `Resultado ${fmtMoney(calc.result, d.settings.currency)}, margen ${calc.marginPct == null ? 'No disponible' : calc.marginPct.toFixed(1) + ' %'}${provisional ? ' · informe provisorio' : ''}.`, link: `${APP_URL}/#/viajes/${trip.id}` });
    // Si los datos cambiaron mientras se generaba, se programa una nueva versión
    if (tripDataVersion(trip, d) !== dv) this.scheduleTripReport(cid, trip.id);
    return { message: `PDF generado (${(buf.length / 1024).toFixed(0)} KB)` };
  }

  async previewTrip(cid: string, tripId: string): Promise<Buffer | null> {
    const d = this.store.get(cid); const trip = d.trips.find(t => t.id === tripId); if (!trip) return null;
    const now = new Date();
    const calc = computeTrips({ settings: d.settings, trucks: d.trucks, trips: d.trips, invoices: d.invoices, payments: d.payments, now }).get(trip.id)!;
    const version = Math.max(0, ...d.tripReports.filter(r => r.tripId === tripId).map(r => r.version)) + 1;
    return renderTripPdf({ data: d, trip, calc, version, provisional: trip.status !== 'finalizado' || !calc.complete, generatedAt: now.toISOString(), preview: true });
  }

  async renderOnDemand(cid: string, kind: 'trip_preview' | 'quote' | 'statement' | 'monthly_preview', p: Record<string, string>): Promise<{ name: string; bytes: Uint8Array } | null> {
    const d = this.store.get(cid);
    if (kind === 'trip_preview') { const b = await this.previewTrip(cid, p.tripId); return b ? { name: `${p.tripId}_vista-previa.pdf`, bytes: b } : null; }
    if (kind === 'monthly_preview') return { name: `Informe_${p.month}_vista-previa.pdf`, bytes: await this.previewMonthly(cid, p.month) };
    if (kind === 'quote') { const q = d.quotes.find(x => x.id === p.quoteId); return q ? { name: `Propuesta_${q.number}.pdf`, bytes: await renderQuotePdf(d, q) } : null; }
    const c = d.clients.find(x => x.id === p.clientId); return c ? { name: `Estado_de_cuenta_${c.name.replace(/[^\w]+/g, '_')}_${p.asof}.pdf`, bytes: await renderStatementPdf(d, c.id, p.asof) } : null;
  }

  // ------------------------------------------------------------------ informe mensual
  private monthlyContent(d: CompanyData, month: string, now: Date) {
    const figures = buildMonthlyFigures(d, month, now);
    const missing = monthlyMissing(d, figures);
    const openTrips = d.trips.filter(t => (t.status === 'en_curso' || t.status === 'planificado') && tripMonth(t, d.settings.timezone) === month).length;
    const provisional = figures.current.trips === 0 || figures.incompleteTripIds.length > 0 || openTrips > 0;
    return { figures, missing, provisional, dataVersion: hashString(JSON.stringify(figures)) };
  }

  scheduleMonthly(cid: string, month: string, trigger: 'automatico' | 'manual'): { report: MonthlyReport | null; created: boolean; reason: string } {
    const d = this.store.get(cid); const now = new Date();
    const c = this.monthlyContent(d, month, now);
    const mine = d.monthlyReports.filter(r => r.month === month).sort((a, b) => a.version - b.version); const latest = mine[mine.length - 1];
    if (latest && (latest.status === 'pendiente' || latest.status === 'generando')) return { report: latest, created: false, reason: 'Ya hay un informe en proceso' };
    if (latest && latest.status === 'disponible' && latest.dataVersion === c.dataVersion) return { report: latest, created: false, reason: 'Sin cambios en los datos desde la última versión' };
    const rep: MonthlyReport = { id: uid(), month, version: (latest?.version ?? 0) + 1, status: 'pendiente', provisional: c.provisional, dataVersion: c.dataVersion, trigger, createdAt: now.toISOString(), generatedAt: null, attempts: 0, error: null, missing: c.missing, figures: null, analysis: null, fileName: null, fileSize: null };
    d.monthlyReports.push(rep);
    this.enqueue(cid, { type: 'monthly_report', key: `monthly:${rep.id}`, payload: { reportId: rep.id, month }, dataVersion: c.dataVersion });
    this.store.save();
    return { report: rep, created: true, reason: 'Informe programado' };
  }

  private async genMonthly(cid: string, job: Job) {
    const d = this.store.get(cid); const rep = d.monthlyReports.find(r => r.id === job.payload.reportId);
    if (!rep) return { message: 'Informe inexistente', skipped: true };
    if (rep.status === 'disponible') return { message: 'Ya estaba disponible', skipped: true };
    rep.status = 'generando'; rep.attempts = job.attempts; this.store.save();
    const now = new Date(); const c = this.monthlyContent(d, rep.month, now);
    let analysis = buildAnalysis(c.figures, d.settings);
    if (d.settings.aiNarrative && aiConfigured()) analysis = await enhanceNarrative(c.figures, analysis);
    const buf = await renderMonthlyPdf({ data: d, figures: c.figures, analysis, version: rep.version, provisional: c.provisional, missing: c.missing, generatedAt: now.toISOString() });
    const name = `Informe_${rep.month}_v${rep.version}.pdf`;
    fs.writeFileSync(this.store.filePath(cid, name), buf);
    Object.assign(rep, { status: 'disponible', provisional: c.provisional, missing: c.missing, dataVersion: c.dataVersion, figures: c.figures, analysis, generatedAt: now.toISOString(), fileName: name, fileSize: buf.length, error: null });
    job.dataVersion = c.dataVersion;
    sysAudit(d, 'informe mensual', rep.month, 'generado', `Informe de ${monthLabel(rep.month)} v${rep.version} (${rep.trigger}, ${c.provisional ? 'provisorio' : 'completo'})`);
    if (d.settings.emailOnMonthlyReport && d.settings.reportRecipients.length) {
      const f = c.figures;
      this.queueEmail(cid, { key: `email:monthly:${rep.id}`, to: d.settings.reportRecipients, subject: `Informe mensual ${monthLabel(rep.month)}${c.provisional ? ' (provisorio)' : ''}`,
        summary: `Ingresos ${fmtMoney(f.current.revenue, d.settings.currency)}, resultado ${fmtMoney(f.current.result, d.settings.currency)}, margen ${f.current.marginPct == null ? 'No disponible' : f.current.marginPct.toFixed(1) + ' %'}. Pendiente de cobro al cierre: ${fmtMoney(f.receivables.pending, d.settings.currency)}.`, link: `${APP_URL}/#/informes/mensual/${rep.id}` });
    }
    return { message: `Informe mensual generado (${(buf.length / 1024).toFixed(0)} KB)` };
  }

  previewMonthly(cid: string, month: string) {
    const d = this.store.get(cid); const now = new Date(); const c = this.monthlyContent(d, month, now);
    const analysis = buildAnalysis(c.figures, d.settings);
    return renderMonthlyPdf({ data: d, figures: c.figures, analysis, version: Math.max(0, ...d.monthlyReports.filter(r => r.month === month).map(r => r.version)) + 1, provisional: c.provisional, missing: c.missing, generatedAt: now.toISOString(), preview: true });
  }

  // ------------------------------------------------------------------ correo (bandeja de salida idempotente)
  queueEmail(cid: string, m: { key: string; to: string[]; subject: string; summary: string; link: string }) {
    const d = this.store.get(cid);
    if (d.emails.some(e => e.key === m.key)) return; // no se repite el envío
    const rec: EmailRecord = { id: uid(), key: m.key, to: m.to, subject: m.subject, summary: m.summary, link: m.link, status: 'pendiente', detail: 'En cola', createdAt: new Date().toISOString() };
    d.emails.unshift(rec);
    this.enqueue(cid, { type: 'send_email', key: `send_email:${m.key}`, payload: { emailId: rec.id } });
  }
  private async deliverEmail(cid: string, job: Job) {
    const d = this.store.get(cid); const rec = d.emails.find(e => e.id === job.payload.emailId);
    if (!rec) return { message: 'Registro inexistente', skipped: true };
    if (rec.status === 'enviado') return { message: 'Ya enviado', skipped: true };
    const text = `${rec.summary}\n\nAbrí el informe completo (requiere acceso autorizado): ${rec.link}`;
    let r: { status: 'enviado' | 'sin_configurar'; detail: string };
    try { r = await sendMail({ to: rec.to, subject: rec.subject, text }); }
    catch (e) { rec.status = 'error'; rec.detail = e instanceof Error ? e.message : String(e); if (job.attempts >= job.maxAttempts) sysAudit(d, 'correo', rec.id, 'envío fallido', `Falló el envío de «${rec.subject}»: ${rec.detail}`); throw e; }
    rec.status = r.status; rec.detail = r.detail;
    sysAudit(d, 'correo', rec.id, r.status === 'enviado' ? 'enviado' : 'no enviado', `«${rec.subject}» a ${rec.to.join(', ')}: ${r.status === 'enviado' ? 'enviado' : 'no enviado (sin SMTP configurado)'}`);
    return { message: r.detail, skipped: r.status === 'sin_configurar' };
  }

  // ------------------------------------------------------------------ notificaciones
  private runNotifications(cid: string) {
    const d = this.store.get(cid); const now = new Date(); const today = localDate(now, d.settings.timezone);
    const fresh: string[] = [];
    const add = (key: string, kind: Notice['kind'], text: string, ref: string) => {
      if (d.notices.some(n => n.key === key)) return; d.notices.unshift({ id: uid(), key, kind, text, at: now.toISOString(), ref }); fresh.push(text);
    };
    for (const inv of d.invoices) {
      const t = invoiceTotals(inv, d.payments, today, d.settings.dueSoonDays);
      if (t.status === 'vencida') add(`overdue:${inv.id}`, 'cobro_vencido', `Factura ${inv.number} vencida el ${inv.dueDate}: saldo ${fmtMoney(t.balance, d.settings.currency)}`, inv.id);
    }
    const calcs = computeTrips({ settings: d.settings, trucks: d.trucks, trips: d.trips, invoices: d.invoices, payments: d.payments, now });
    for (const t of d.trips) { const c = calcs.get(t.id)!; if (t.status === 'finalizado' && !c.complete) add(`pending:${t.id}:${c.missing.length}`, 'datos_pendientes', `Viaje ${t.id} con datos pendientes: ${c.missing.join('; ')}`, t.id); }
    for (const tr of d.trucks) for (const p of tr.servicePlans) { const s = serviceStatus(p, currentOdometer(tr, d.trips), today); if (s.status === 'vencido' || s.status === 'proximo') add(`service:${tr.id}:${p.id}:${s.status}`, 'servicio', `${tr.name}: ${p.name} ${s.status === 'vencido' ? 'vencido' : 'próximo'}`, tr.id); }
    const freshDocs: string[] = [];
    for (const r of docAttention(d, today)) {
      const th = r.status === 'proximo' && r.days != null ? alertThreshold(r.days, d.settings.docAlertDays) : null;
      const key = `doc:${r.doc?.id ?? r.key}:${r.status}${th != null ? ':' + th : ''}`; // un aviso por documento y umbral: no se repite
      const text = r.status === 'vencido' ? `${r.type.label} de ${r.owner} VENCIDO (${r.doc!.expiryDate})` : r.status === 'pendiente' ? `${r.type.label} de ${r.owner}: pendiente de cargar` : `${r.type.label} de ${r.owner} vence en ${r.days} días`;
      if (!d.notices.some(n => n.key === key)) { add(key, 'documento', text, r.ownerId); freshDocs.push(text); }
    }
    for (const c of d.collections) if (c.promise?.status === 'pendiente' && c.promise.date <= today) add(`promise:${c.id}:${c.promise.date}`, 'compromiso', `Compromiso de pago de ${d.clients.find(x => x.id === c.clientId)?.name} para el ${c.promise.date}: sin registrar cumplimiento`, c.clientId);
    for (const q of d.quotes) if (quoteStatus(q, today) === 'vencida' && q.status === 'enviada') add(`quote:${q.id}:expired`, 'cotizacion', `Cotización ${q.number} enviada y vencida sin respuesta`, q.id);
    if (d.notices.length > 300) d.notices.length = 300;
    if (freshDocs.length && d.settings.emailDocAlerts && d.settings.reportRecipients.length)
      this.queueEmail(cid, { key: `email:docs:${today}`, to: d.settings.reportRecipients, subject: `Documentación: ${freshDocs.length} aviso(s)`, summary: freshDocs.slice(0, 8).join(' | '), link: `${APP_URL}/#/documentos` });
    if (fresh.length && d.settings.emailOverdueDigest && d.settings.reportRecipients.length)
      this.queueEmail(cid, { key: `email:digest:${today}`, to: d.settings.reportRecipients, subject: `Avisos del día (${fresh.length})`, summary: fresh.slice(0, 8).join(' | '), link: `${APP_URL}/#/resumen` });
    return { message: `${fresh.length} aviso(s) nuevo(s)` };
  }

  // ------------------------------------------------------------------ programador (corre en el servidor aunque no haya nadie conectado)
  schedulerTick() {
    for (const cid of this.store.ids()) {
      const d = this.store.get(cid); const now = new Date(); const tz = d.settings.timezone;
      const p = localParts(now, tz); const cur = localDate(now, tz).slice(0, 7); const target = prevMonth(cur);
      const day = Math.min(d.settings.monthlyReportDay, daysInMonth(cur));
      const reached = p.d > day || (p.d === day && p.h >= d.settings.monthlyReportHour);
      if (reached && !d.monthlyReports.some(r => r.month === target)) this.scheduleMonthly(cid, target, 'automatico');
      const nkey = `notifications:${localDate(now, tz)}`; // una ejecución por día
      if (!d.jobs.some(j => j.key === nkey)) this.enqueue(cid, { type: 'notifications', key: nkey, payload: {} });
    }
  }
}
