// Cuenta del cliente. Reutiliza facturas y pagos del módulo Cobros: no existen saldos propios que puedan contradecirse.
import { CompanyData } from './types';
import { invoiceTotals, EPS } from './calc';
import { addDays, daysBetween } from './time';

export interface AgingBucket { label: string; amount: number; count: number }
export function agingBuckets(d: CompanyData, clientId: string, asOf: string): AgingBucket[] {
  const edges = [...d.settings.agingBuckets].sort((a, b) => a - b);
  const labels = ['No vencido', ...edges.map((e, i) => `${i === 0 ? 1 : edges[i - 1] + 1}–${e} días`), `Más de ${edges[edges.length - 1] ?? 0} días`];
  const out: AgingBucket[] = labels.map(label => ({ label, amount: 0, count: 0 }));
  for (const inv of d.invoices.filter(i => i.clientId === clientId && i.issueDate <= asOf)) {
    const t = invoiceTotals(inv, d.payments, asOf, d.settings.dueSoonDays); if (t.balance <= EPS) continue;
    const late = daysBetween(inv.dueDate, asOf); let idx = 0;
    if (late > 0) { idx = 1 + edges.findIndex(e => late <= e); if (idx === 0) idx = labels.length - 1; }
    out[idx].amount += t.balance; out[idx].count++;
  }
  return out;
}
export function clientAccount(d: CompanyData, clientId: string, asOf: string, from: string, to: string) {
  const invs = d.invoices.filter(i => i.clientId === clientId);
  let pending = 0, overdue = 0, billed = 0; const upcoming: { number: string; dueDate: string; balance: number }[] = [];
  for (const inv of invs) {
    if (inv.issueDate >= from && inv.issueDate <= to) billed += inv.lines.reduce((s, l) => s + l.net, 0) * (1 + inv.ivaRate);
    if (inv.issueDate > asOf) continue;
    const t = invoiceTotals(inv, d.payments, asOf, d.settings.dueSoonDays); if (t.balance <= EPS) continue;
    pending += t.balance; if (t.status === 'vencida') overdue += t.balance; else if (inv.dueDate <= addDays(asOf, 30)) upcoming.push({ number: inv.number, dueDate: inv.dueDate, balance: t.balance });
  }
  return { billed, pending, overdue, upcoming: upcoming.sort((a, b) => a.dueDate.localeCompare(b.dueDate)), aging: agingBuckets(d, clientId, asOf) };
}
