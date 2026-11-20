// PDF comercial de la cotización, destinado al cliente: precio, servicio y condiciones. NUNCA incluye costos internos ni márgenes.
import { CompanyData, Quote } from '../../shared/types';
import { quoteCalc, quoteStatus } from '../../shared/quote';
import { fmtDate, fmtKm, fmtMoney } from '../../shared/format';
import { localDate } from '../../shared/time';
import { C, M, W, badge, docHeader, finish, kv, newDoc, para, section, table, toBuffer } from './kit';

export async function renderQuotePdf(data: CompanyData, q: Quote): Promise<Buffer> {
  const s = data.settings; const c = quoteCalc(q); const $ = (v: number | null) => fmtMoney(v, s.currency, 2);
  const client = data.clients.find(x => x.id === q.clientId); const truck = data.trucks.find(t => t.id === q.truckId);
  const today = localDate(new Date(), s.timezone); const expired = quoteStatus(q, today) === 'vencida';
  const doc = newDoc(`Propuesta ${q.number}`, s.companyName);
  docHeader(doc, s, { title: 'Propuesta comercial', subtitle: `${q.number}  ·  Emitida ${fmtDate(q.createdAt.slice(0, 10))}`, badges: expired ? [{ text: 'VIGENCIA VENCIDA', color: C.red }] : q.status === 'borrador' ? [{ text: 'BORRADOR', color: C.amber }] : [] });
  const y0 = doc.y; const yl = kv(doc, [['Cliente', client?.name ?? ''], ['CUIT', client?.cuit ?? ''], ['Vigencia', `hasta el ${fmtDate(q.validUntil)}`]], M, y0, W, 70); doc.y = yl + 6; doc.x = M;
  section(doc, 'Servicio propuesto');
  const y1 = doc.y; const yr = kv(doc, [['Ruta', `${q.origin} a ${q.destination}`], ['Vehículo', truck ? `${truck.model}` : q.vehicleType || 'A confirmar'], ['Distancia con carga', q.kmLoaded != null ? fmtKm(q.kmLoaded) : 'A confirmar'], ['Duración estimada', q.plannedHours != null ? `${String(q.plannedHours).replace('.', ',')} horas` : 'A confirmar']], M, y1, W, 110); doc.y = yr + 4; doc.x = M;
  section(doc, 'Precio');
  table(doc, [{ label: 'Concepto', w: 60 }, { label: 'Importe', w: 40, align: 'right' }], [['Servicio de transporte (precio neto)', $(c.priceNet)], [`IVA ${(q.ivaRate * 100).toFixed(1).replace('.0', '').replace('.', ',')} %`, $(c.iva)], ['Total con impuestos', $(c.total)]], { totalRows: [2] });
  para(doc, 'Los impuestos se detallan por separado. Precio expresado en ' + (s.currency === 'ARS' ? 'pesos argentinos' : s.currency) + '.', { color: C.muted, size: 8.5 });
  section(doc, 'Condiciones comerciales'); para(doc, q.terms || s.quoteTerms || 'A convenir.');
  if (q.notes) { section(doc, 'Observaciones'); para(doc, q.notes); }
  para(doc, `Esta propuesta es válida hasta el ${fmtDate(q.validUntil)}. La aceptación se confirma con la empresa por los canales habituales.`, { color: C.muted, size: 9 });
  finish(doc, `${s.legalName.replace(/\s*\(datos de demostración\)/, '')}  ·  ${q.number}${data.isDemo ? '  ·  Datos de demostración' : ''}`);
  void badge; return toBuffer(doc);
}
