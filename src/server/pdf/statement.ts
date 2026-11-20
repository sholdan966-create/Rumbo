import { CompanyData } from '../../shared/types';
import { clientAccount } from '../../shared/account';
import { invoiceTotals, EPS } from '../../shared/calc';
import { daysBetween } from '../../shared/time';
import { fmtDate, fmtMoney } from '../../shared/format';
import { C, M, W, docHeader, finish, kpis, kv, newDoc, para, section, table, toBuffer } from './kit';

export async function renderStatementPdf(data: CompanyData, clientId: string, asof: string): Promise<Buffer> {
  const s = data.settings; const c = data.clients.find(x => x.id === clientId)!; const $ = (v: number) => fmtMoney(v, s.currency, 2);
  const acc = clientAccount(data, clientId, asof, `${asof.slice(0, 7)}-01`, asof);
  const doc = newDoc(`Estado de cuenta ${c.name}`, s.companyName);
  docHeader(doc, s, { title: 'Estado de cuenta', subtitle: `Saldos al ${fmtDate(asof)}`, badges: data.isDemo ? [{ text: 'DATOS DE DEMOSTRACIÓN', color: C.muted }] : [] });
  const y = kv(doc, [['Cliente', c.name], ['CUIT', c.cuit || '—'], ['Plazo de pago', `${c.paymentTermDays} días`]], M, doc.y, W, 90); doc.y = y + 6; doc.x = M;
  kpis(doc, [{ label: 'Saldo pendiente', value: $(acc.pending) }, { label: 'Vencido', value: $(acc.overdue), color: acc.overdue > 0 ? C.red : C.ink }, { label: 'Próximos vencimientos (30 días)', value: $(acc.upcoming.reduce((a, x) => a + x.balance, 0)) }]);
  section(doc, 'Antigüedad de la deuda'); table(doc, [{ label: 'Tramo', w: 50 }, { label: 'Facturas', w: 20, align: 'right' }, { label: 'Saldo', w: 30, align: 'right' }], acc.aging.map(a => [a.label, String(a.count), $(a.amount)]));
  section(doc, 'Facturas con saldo');
  const rows = data.invoices.filter(i => i.clientId === clientId && i.issueDate <= asof).map(i => ({ i, t: invoiceTotals(i, data.payments, asof, s.dueSoonDays) })).filter(x => x.t.balance > EPS).sort((a, b) => a.i.dueDate.localeCompare(b.i.dueDate));
  table(doc, [{ label: 'Factura', w: 24 }, { label: 'Emisión', w: 14 }, { label: 'Vence', w: 14 }, { label: 'Total', w: 20, align: 'right' }, { label: 'Cobrado', w: 20, align: 'right' }, { label: 'Saldo', w: 20, align: 'right' }, { label: 'Atraso', w: 12, align: 'right' }],
    rows.length ? rows.map(({ i, t }) => { const late = daysBetween(i.dueDate, asof); return [i.number, fmtDate(i.issueDate), fmtDate(i.dueDate), $(t.adjusted), $(t.paid), { t: $(t.balance), color: late > 0 ? C.red : C.ink }, late > 0 ? `${late} d` : '—']; }) : [['Sin facturas con saldo', '', '', '', '', '', '']]);
  const pays = data.payments.filter(p => data.invoices.some(i => i.id === p.invoiceId && i.clientId === clientId) && p.date <= asof && p.date >= `${asof.slice(0, 4)}-01-01`).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15);
  if (pays.length) { section(doc, 'Últimos cobros registrados'); table(doc, [{ label: 'Fecha', w: 20 }, { label: 'Factura', w: 30 }, { label: 'Medio', w: 25 }, { label: 'Importe', w: 25, align: 'right' }], pays.map(p => [fmtDate(p.date), data.invoices.find(i => i.id === p.invoiceId)!.number, p.method, $(p.amount)])); }
  para(doc, 'Documento informativo. Los saldos surgen de las facturas y cobros registrados en el sistema; si un pago ya fue realizado y no figura, envíenos el comprobante.', { color: C.muted, size: 8.5 });
  finish(doc, `${s.companyName}  ·  Estado de cuenta ${c.name}  ·  ${fmtDate(asof)}`); return toBuffer(doc);
}
