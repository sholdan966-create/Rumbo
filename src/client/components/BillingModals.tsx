import { useMemo, useState } from 'react';
import { useApp } from '../store';
import { api } from '../api';
import { Field, Modal, NumField } from './ui';
import { Invoice, Payment } from '../../shared/types';
import { invoiceTotals, routeKey } from '../../shared/calc';
import { validateInvoice, validatePayment } from '../../shared/validate';
import { addDays } from '../../shared/time';
import { fmtDate } from '../../shared/format';
import { DEFAULT_PAYMENT_METHODS } from '../../shared/templates';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

export function PaymentModal({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const { data, today, money, run } = useApp();
  const t = invoiceTotals(invoice, data.payments, '9999-12-31', 0);
  const [amount, setAmount] = useState<number | null>(Math.round(t.balance * 100) / 100);
  const [date, setDate] = useState(today); const [method, setMethod] = useState('Transferencia'); const [ref, setRef] = useState('');
  const draft: Payment = { id: uid(), invoiceId: invoice.id, date, amount: amount ?? NaN, method, reference: ref || undefined };
  const v = validatePayment(draft, data); const err = v.errors[0]?.message;
  const save = async () => { if (v.errors.length) return; const ok = await run(() => api('PUT', `/api/payments/${draft.id}`, draft), 'Cobro registrado'); if (ok) onClose(); };
  return (
    <Modal title={`Registrar cobro · ${invoice.number}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!!v.errors.length} onClick={save}>Registrar cobro</button></>}>
      <div className="stack">
        <div className="banner blue"><div>Total ajustado <b>{money(t.adjusted, 2)}</b> · cobrado <b>{money(t.paid, 2)}</b> · saldo <b>{money(t.balance, 2)}</b>. Podés registrar un cobro parcial.</div></div>
        <div className="grid g2">
          <NumField label="Importe cobrado" prefix="$" value={amount} onChange={setAmount} error={err} hint={amount != null && amount < t.balance - 0.005 ? `Cobro parcial: quedará un saldo de ${money(t.balance - amount, 2)}` : undefined} />
          <Field label="Fecha de cobro"><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
          <Field label="Medio"><select value={method} onChange={e => setMethod(e.target.value)}>{(data.settings.paymentMethods ?? DEFAULT_PAYMENT_METHODS).map(m => <option key={m}>{m}</option>)}</select></Field>
          <Field label="Referencia (opcional)"><input type="text" value={ref} onChange={e => setRef(e.target.value)} /></Field>
        </div>
        {v.warnings.map(w => <div key={w.message} className="banner amber">{w.message}</div>)}
      </div>
    </Modal>
  );
}

export function AdjustmentModal({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const { today, money, run, data } = useApp();
  const [amount, setAmount] = useState<number | null>(null); const [reason, setReason] = useState('Nota de crédito'); const [date, setDate] = useState(today);
  const save = async () => {
    if (!amount) return;
    const inv: Invoice = { ...invoice, adjustments: [...invoice.adjustments, { id: uid(), date, amount: -Math.abs(amount), reason }] };
    const ok = await run(() => api('PUT', `/api/invoices/${invoice.id}`, inv), 'Ajuste registrado'); if (ok) onClose();
  };
  void data;
  return (
    <Modal title={`Nota de crédito · ${invoice.number}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!amount} onClick={save}>Registrar</button></>}>
      <div className="grid g2">
        <NumField label="Importe a descontar (con IVA)" prefix="$" value={amount} onChange={setAmount} hint={amount ? `Reduce el total de la factura en ${money(amount, 2)}` : undefined} />
        <Field label="Fecha"><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
        <Field label="Motivo" className="" ><input type="text" value={reason} onChange={e => setReason(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export function InvoiceModal({ onClose, clientId: cid, tripIds }: { onClose: () => void; clientId?: string; tripIds?: string[] }) {
  const { data, calcs, today, money, run } = useApp();
  const [clientId, setClientId] = useState(cid ?? data.trips.find(t => t.id === tripIds?.[0])?.clientId ?? data.clients[0]?.id ?? '');
  const client = data.clients.find(c => c.id === clientId);
  const open = useMemo(() => data.trips.filter(t => t.clientId === clientId && t.status === 'finalizado' && t.serviceValue != null && t.serviceValue - calcs.get(t.id)!.invoicedNet > 0.5), [data, calcs, clientId]);
  const [sel, setSel] = useState<Record<string, number>>(() => Object.fromEntries((tripIds ?? []).map(id => { const t = data.trips.find(x => x.id === id)!; return [id, Math.max(0, (t.serviceValue ?? 0) - calcs.get(id)!.invoicedNet)]; })));
  const [number, setNumber] = useState(() => { const last = [...data.invoices].sort((a, b) => a.number.localeCompare(b.number)).pop()?.number; const m = last && /^(.*?)(\d+)$/.exec(last); return m ? `${m[1]}${String(Number(m[2]) + 1).padStart(m[2].length, '0')}` : ''; });
  const [issue, setIssue] = useState(today); const [due, setDue] = useState(addDays(today, client?.paymentTermDays ?? 30)); const [iva, setIva] = useState(data.settings.defaultIvaRate * 100);
  const lines = Object.entries(sel).filter(([id, n]) => n > 0 && open.some(t => t.id === id)).map(([tripId, net]) => ({ tripId, net }));
  const inv: Invoice = { id: uid(), number, clientId, issueDate: issue, dueDate: due, ivaRate: iva / 100, lines, adjustments: [] };
  const v = validateInvoice(inv, data, true); const net = lines.reduce((a, l) => a + l.net, 0);
  const save = async () => { const ok = await run(() => api('PUT', `/api/invoices/${inv.id}`, inv), 'Factura registrada'); if (ok) onClose(); };
  return (
    <Modal title="Nueva factura" size="wide" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!!v.errors.length} onClick={save}>Guardar factura</button></>}>
      <div className="grid g4">
        <Field label="Cliente"><select value={clientId} onChange={e => { setClientId(e.target.value); setSel({}); setDue(addDays(issue, data.clients.find(c => c.id === e.target.value)?.paymentTermDays ?? 30)); }}>{data.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Número"><input type="text" value={number} onChange={e => setNumber(e.target.value)} /></Field>
        <Field label="Emisión (facturación)"><input type="date" value={issue} onChange={e => { setIssue(e.target.value); setDue(addDays(e.target.value, client?.paymentTermDays ?? 30)); }} /></Field>
        <Field label="Vencimiento" hint={client ? `Plazo del cliente: ${client.paymentTermDays} días` : undefined}><input type="date" value={due} onChange={e => setDue(e.target.value)} /></Field>
      </div>
      <h3 style={{ margin: '18px 0 8px' }}>Viajes finalizados sin facturar de este cliente</h3>
      <div className="panel"><div className="table-wrap"><table className="tbl"><thead><tr><th></th><th>Viaje</th><th>Ruta</th><th className="num">Valor neto</th><th className="num">Ya facturado</th><th className="num">Neto a facturar</th></tr></thead><tbody>
        {open.map(t => { const billed = calcs.get(t.id)!.invoicedNet; const checked = sel[t.id] != null && sel[t.id] > 0; return (
          <tr key={t.id}><td><input type="checkbox" aria-label={`Facturar ${t.id}`} checked={checked} onChange={e => setSel(s => ({ ...s, [t.id]: e.target.checked ? t.serviceValue! - billed : 0 }))} /></td>
            <td>{t.id}</td><td>{routeKey(t)}</td><td className="num">{money(t.serviceValue)}</td><td className="num">{money(billed)}</td>
            <td className="num"><input type="number" style={{ width: 130, textAlign: 'right' }} disabled={!checked} value={sel[t.id] ?? 0} onChange={e => setSel(s => ({ ...s, [t.id]: Number(e.target.value) }))} /></td></tr>); })}
        {!open.length && <tr><td colSpan={6} className="empty">Este cliente no tiene viajes finalizados pendientes de facturar.</td></tr>}</tbody></table></div></div>
      <div className="row between" style={{ marginTop: 14 }}>
        <Field label="IVA (%)"><input type="number" style={{ width: 110 }} value={iva} onChange={e => setIva(Number(e.target.value))} /></Field>
        <div style={{ textAlign: 'right' }}><div className="muted small">Neto {money(net, 2)} · IVA {money(net * iva / 100, 2)}</div><div style={{ fontSize: 20, fontWeight: 600 }} className="num">Total {money(net * (1 + iva / 100), 2)}</div><div className="muted small">Vence el {fmtDate(due)}</div></div>
      </div>
      {v.errors.length > 0 && lines.length > 0 && <div className="banner red" style={{ marginTop: 12 }}><div>{v.errors.map(e => <div key={e.message}>{e.message}</div>)}</div></div>}
    </Modal>
  );
}
