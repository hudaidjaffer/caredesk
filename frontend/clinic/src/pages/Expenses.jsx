import { useState } from 'react';
import { Download, Plus, Wallet } from 'lucide-react';
import { api, qs } from '../../../shared/api';
import { fmtDate, rangeFor } from '../../../shared/format';
import { Empty, ErrorCard, Loading, PageHead, useAsync, useModal } from '../../../shared/ui';
import { useApp } from '../context';
import { RangeSeg } from '../components/common';
import ExpenseModal from '../components/ExpenseModal';

let remembered = 'month';

export default function Expenses() {
  const { money, canWrite, version } = useApp();
  const open = useModal();
  const [range, setRange] = useState(remembered);
  const { data, error, loading, reload } = useAsync(() => api(`/api/expenses${qs(rangeFor(range))}`), [range, version]);
  if (error) return <ErrorCard error={error} onRetry={reload} />;
  const rows = data || [];
  return (
    <>
      <PageHead title="Expenses" sub="Track what the clinic spends">
        <a className="btn" href="/api/export/expenses.xlsx" download><Download /><span>Excel</span></a>
        <button className="btn primary" disabled={!canWrite} onClick={() => open((c) => <ExpenseModal close={c} />)}><Plus /><span>New expense</span></button>
      </PageHead>
      <div className="card">
        <div className="toolbar"><RangeSeg value={range} onChange={(v) => { remembered = v; setRange(v); }} /><span className="spacer" />
          <span className="small muted">Total: <b style={{ color: 'var(--text)' }}>{money(rows.reduce((s, e) => s + e.amount, 0))}</b></span></div>
        {loading && !data ? <Loading minHeight={200} /> : rows.length ? (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Paid by</th><th className="right">Amount</th></tr></thead>
            <tbody>{rows.map((e) => (
              <tr key={e.id} className={canWrite ? 'click' : ''} onClick={() => canWrite && open((c) => <ExpenseModal close={c} expense={e} />)}>
                <td className="nowrap">{fmtDate(e.date)}</td><td><b>{e.category}</b></td><td className="muted">{e.description || ''}</td>
                <td>{e.method || ''}</td><td className="right mono">{money(e.amount)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty icon={Wallet} title="No expenses in this period" text={canWrite ? 'Record rent, supplies, salaries and more to see your true profit. You can scan receipts too.' : ''} />}
      </div>
    </>
  );
}
