import { ArrowLeft, Banknote, Pencil, Printer, Trash2, X } from 'lucide-react';
import { api } from '../../../shared/api';
import { fmtDate } from '../../../shared/format';
import { Badge, Brand, ErrorCard, Loading, useAsync, useConfirm, useModal, useToast } from '../../../shared/ui';
import { INV_STATUS, go, useApp } from '../context';
import InvoiceModal, { PaymentModal } from '../components/InvoiceModal';

export default function InvoiceView({ id }) {
  const { me, money, canWrite, version, refresh } = useApp();
  const open = useModal();
  const toast = useToast();
  const confirm = useConfirm();
  const { data: inv, error, loading, reload } = useAsync(() => api(`/api/invoices/${encodeURIComponent(id)}`), [id, version]);
  if (error) return <ErrorCard error={error} onRetry={reload} />;
  if (loading && !inv) return <Loading />;
  const c = me.clinic;
  const bal = inv.total - inv.paid;
  const ro = !canWrite;
  return (
    <>
      <div className="row wrap no-print" style={{ marginBottom: 14 }}>
        <a href="#/billing" className="btn ghost sm"><ArrowLeft /><span>Billing</span></a><span className="spacer" />
        {!ro && <>
          <button className="btn danger" onClick={async () => {
            if (!(await confirm(`Invoice ${inv.number} and its payments will be permanently deleted.`))) return;
            await api(`/api/invoices/${inv.id}`, { method: 'DELETE' }); toast('Invoice deleted'); go('#/billing'); refresh();
          }}><Trash2 /><span>Delete</span></button>
          <button className="btn" onClick={() => open((cl) => <InvoiceModal close={cl} inv={inv} />)}><Pencil /><span>Edit</span></button>
        </>}
        <button className="btn" onClick={() => window.print()}><Printer /><span>Print / PDF</span></button>
        {!ro && bal > 0 && <button className="btn primary" onClick={() => open((cl) => <PaymentModal close={cl} inv={inv} />)}><Banknote /><span>Record payment</span></button>}
      </div>
      <div className="card invoice-doc">
        <div className="inv-top">
          <div><Brand name={c.name} /><div className="muted small" style={{ marginTop: 10, whiteSpace: 'pre-line' }}>{[c.address, c.phone, c.email].filter(Boolean).join('\n')}</div></div>
          <div style={{ textAlign: 'right' }}><div className="inv-title">INVOICE</div><div style={{ fontWeight: 700, fontSize: 16 }}>{inv.number}</div>
            <div style={{ marginTop: 6 }}><Badge status={inv.status}>{INV_STATUS[inv.status]}</Badge></div></div>
        </div>
        <div className="row wrap" style={{ alignItems: 'flex-start', gap: 40, marginBottom: 26 }}>
          <div><div className="faint small" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>Bill to</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginTop: 4 }}><a href={`#/patients/${inv.patient_id}`} style={{ color: 'inherit' }}>{inv.patient_name}</a></div>
            <div className="muted small" style={{ whiteSpace: 'pre-line' }}>{[inv.patient_address, inv.patient_phone, inv.patient_email].filter(Boolean).join('\n')}</div></div>
          <span className="spacer" />
          <dl className="kv" style={{ gridTemplateColumns: 'auto auto' }}><dt>Invoice date</dt><dd>{fmtDate(inv.date)}</dd><dt>Due date</dt><dd>{fmtDate(inv.due_date)}</dd></dl>
        </div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Description</th><th className="right">Qty</th><th className="right">Price</th><th className="right">Amount</th></tr></thead>
          <tbody>{inv.items.map((it, i) => (
            <tr key={i}><td>{it.description}</td><td className="right">{it.qty}</td><td className="right mono">{money(it.unit_price)}</td><td className="right mono">{money(Math.round(it.qty * it.unit_price))}</td></tr>
          ))}</tbody>
        </table></div>
        <div className="totals" style={{ marginTop: 18 }}>
          <div><span className="muted">Subtotal</span><span className="mono">{money(inv.subtotal)}</span></div>
          {inv.discount > 0 && <div><span className="muted">Discount</span><span className="mono">−{money(inv.discount)}</span></div>}
          {inv.tax > 0 && <div><span className="muted">Tax ({inv.tax_rate}%)</span><span className="mono">{money(inv.tax)}</span></div>}
          <div className="grand"><span>Total</span><span className="mono">{money(inv.total)}</span></div>
          <div><span className="muted">Paid</span><span className="mono">{money(inv.paid)}</span></div>
          <div style={{ fontWeight: 700 }}><span>Balance due</span><span className="mono" style={{ color: bal > 0 ? 'var(--danger)' : 'var(--success)' }}>{money(bal)}</span></div>
        </div>
        {inv.payments.length > 0 && (
          <>
            <h3 style={{ margin: '28px 0 8px' }}>Payments</h3>
            <table className="t"><tbody>{inv.payments.map((p) => (
              <tr key={p.id}><td>{fmtDate(p.date)}</td><td>{p.method || ''}</td><td className="muted">{p.reference || ''}</td><td className="right mono">{money(p.amount)}</td>
                <td className="right no-print" style={{ width: 40 }}>{!ro && <button className="btn ghost icon sm" title="Remove payment" onClick={async () => {
                  if (!(await confirm('This payment will be removed and the invoice balance updated.', { okLabel: 'Remove' }))) return;
                  await api(`/api/payments/${p.id}`, { method: 'DELETE' }); toast('Payment removed'); refresh();
                }}><X /></button>}</td></tr>
            ))}</tbody></table>
          </>
        )}
        {inv.notes && <p style={{ marginTop: 24, whiteSpace: 'pre-wrap' }}>{inv.notes}</p>}
        {c.invoice_footer && <p className="muted small" style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 14, whiteSpace: 'pre-wrap' }}>{c.invoice_footer}</p>}
      </div>
    </>
  );
}
