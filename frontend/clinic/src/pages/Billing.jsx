import { useState } from 'react';
import { Download, Plus, Receipt, Search, Wallet } from 'lucide-react';
import { api, qs } from '../../../shared/api';
import { fmtDate, rangeFor } from '../../../shared/format';
import { Badge, Empty, ErrorCard, Loading, PageHead, Seg, useAsync, useModal } from '../../../shared/ui';
import { INV_STATUS, go, useApp } from '../context';
import { RangeSeg } from '../components/common';
import InvoiceModal from '../components/InvoiceModal';

const billState = { tab: 'invoices', status: '', range: 'month' };

export default function Billing() {
  const { money, canWrite, version } = useApp();
  const open = useModal();
  const [s, setS] = useState(billState);
  const update = (patch) => { Object.assign(billState, patch); setS({ ...billState }); };
  const [q, setQ] = useState('');
  const r = rangeFor(s.range);
  const { data, error, loading, reload } = useAsync(
    () => (s.tab === 'invoices' ? api(`/api/invoices${qs({ status: s.status })}`) : api(`/api/payments${qs(r)}`)),
    [s.tab, s.status, s.range, version],
  );
  if (error) return <ErrorCard error={error} onRetry={reload} />;
  const rows = data || [];
  const needle = q.trim().toLowerCase();
  const invoices = s.tab === 'invoices' ? rows.filter((i) => !needle || i.number.toLowerCase().includes(needle) || i.patient_name.toLowerCase().includes(needle)) : [];
  return (
    <>
      <PageHead title="Billing" sub="Invoices and payments received">
        <a className="btn" href={`/api/export/${s.tab}.xlsx`} download><Download /><span>Excel</span></a>
        <button className="btn primary" disabled={!canWrite} onClick={() => open((c) => <InvoiceModal close={c} />)}><Plus /><span>New invoice</span></button>
      </PageHead>
      <div className="card">
        <div className="pill-tabs">
          <button className={s.tab === 'invoices' ? 'on' : ''} onClick={() => update({ tab: 'invoices' })}>Invoices</button>
          <button className={s.tab === 'payments' ? 'on' : ''} onClick={() => update({ tab: 'payments' })}>Payments received</button>
        </div>
        {s.tab === 'invoices' ? (
          <>
            <div className="toolbar">
              <div className="search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search invoice no. or patient…" /></div>
              <Seg options={[['', 'All'], ['unpaid', 'Unpaid'], ['partial', 'Part paid'], ['paid', 'Paid']]} value={s.status} onChange={(v) => update({ status: v })} />
              <span className="spacer" /><span className="small muted">Outstanding: <b style={{ color: 'var(--text)' }}>{money(rows.reduce((t, i) => t + i.total - i.paid, 0))}</b></span>
            </div>
            {loading && !data ? <Loading minHeight={200} /> : invoices.length ? (
              <div className="table-wrap"><table className="t">
                <thead><tr><th>Invoice</th><th>Date</th><th>Patient</th><th className="right">Total</th><th className="right">Paid</th><th className="right">Balance</th><th>Status</th></tr></thead>
                <tbody>{invoices.map((i) => (
                  <tr key={i.id} className="click" onClick={() => go(`#/invoice/${i.id}`)}>
                    <td><b>{i.number}</b></td><td className="nowrap">{fmtDate(i.date)}</td><td>{i.patient_name}</td>
                    <td className="right mono">{money(i.total)}</td><td className="right mono">{money(i.paid)}</td>
                    <td className="right mono">{i.total - i.paid > 0 ? <b>{money(i.total - i.paid)}</b> : <span className="faint">—</span>}</td>
                    <td><Badge status={i.status}>{INV_STATUS[i.status]}</Badge></td>
                  </tr>
                ))}</tbody>
              </table></div>
            ) : <Empty icon={Receipt} title="No invoices found" text={canWrite ? 'Create an invoice after a visit to bill your patient.' : ''} />}
          </>
        ) : (
          <>
            <div className="toolbar"><RangeSeg value={s.range} onChange={(v) => update({ range: v })} /><span className="spacer" />
              <span className="small muted">Total received: <b style={{ color: 'var(--text)' }}>{money(rows.reduce((t, p) => t + p.amount, 0))}</b></span></div>
            {loading && !data ? <Loading minHeight={200} /> : rows.length ? (
              <div className="table-wrap"><table className="t">
                <thead><tr><th>Date</th><th>Patient</th><th>Invoice</th><th>Method</th><th>Reference</th><th className="right">Amount</th></tr></thead>
                <tbody>{rows.map((p) => (
                  <tr key={p.id}><td className="nowrap">{fmtDate(p.date)}</td><td>{p.patient_name}</td><td><a href={`#/invoice/${p.invoice_id}`}>{p.invoice_number}</a></td>
                    <td>{p.method || '—'}</td><td className="muted">{p.reference || ''}</td><td className="right mono"><b>{money(p.amount)}</b></td></tr>
                ))}</tbody>
              </table></div>
            ) : <Empty icon={Wallet} title="No payments in this period" />}
          </>
        )}
      </div>
    </>
  );
}
