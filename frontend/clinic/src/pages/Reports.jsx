import { useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Banknote, BarChart3, CalendarDays, Check, FileSpreadsheet, Printer, Users, Wallet } from 'lucide-react';
import { api, qs } from '../../../shared/api';
import { fmtDate, rangeFor } from '../../../shared/format';
import { Badge, Empty, ErrorCard, Loading, PageHead, Stat, useAsync } from '../../../shared/ui';
import { STATUS, go, useApp } from '../context';
import { HBars, IncomeChart, RangeSeg } from '../components/common';

const PIE = { scheduled: '#3b82f6', confirmed: '#0e7c86', completed: '#15935a', cancelled: '#94a3b8', no_show: '#d0353a' };
let remembered = 'month';

export default function Reports() {
  const { money, version } = useApp();
  const [range, setRange] = useState(remembered);
  const r = rangeFor(range);
  const { data: d, error, loading, reload } = useAsync(() => api(`/api/reports${qs(r)}`), [range, version]);
  if (error) return <ErrorCard error={error} onRetry={reload} />;
  if (loading && !d) return <Loading />;
  const apptTotal = d.appointments_by_status.reduce((s, x) => s + x.count, 0);
  const count = (k) => (d.appointments_by_status.find((x) => x.status === k) || {}).count || 0;
  const pie = Object.keys(STATUS).map((k) => ({ name: STATUS[k], key: k, value: count(k) })).filter((x) => x.value);
  return (
    <>
      <PageHead title="Reports" sub={range === 'all' ? 'All time' : `${fmtDate(d.from)} – ${fmtDate(d.to)}`}>
        <a className="btn no-print" href={`/api/export/report.xlsx${qs(r)}`} download><FileSpreadsheet /><span>Excel report</span></a>
        <button className="btn no-print" onClick={() => window.print()}><Printer /><span>Print</span></button>
      </PageHead>
      <div className="card no-print" style={{ marginBottom: 20 }}><div className="toolbar" style={{ border: 0 }}>
        <RangeSeg value={range} onChange={(v) => { remembered = v; setRange(v); }} /></div></div>
      <div className="stats">
        <Stat icon={Banknote} tone="green" label="Income received" value={money(d.income)} hint={`${money(d.invoiced)} invoiced`} />
        <Stat icon={Wallet} tone="amber" label="Expenses" value={money(d.expenses)} />
        <Stat icon={BarChart3} tone={d.net >= 0 ? 'teal' : 'red'} label="Net profit" value={money(d.net)} hint={d.income ? `${Math.round((d.net / d.income) * 100)}% margin` : ''} />
        <Stat icon={Users} tone="blue" label="New patients" value={d.new_patients} hint={`${apptTotal} appointments`} />
      </div>
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-head"><h2>Income vs expenses by month</h2></div>
        <div className="card-body"><IncomeChart rows={d.by_month.map((x) => ({ month: x.m, income: x.income, expenses: x.expenses }))} height={260} /></div>
      </div>
      <div className="halves" style={{ marginBottom: 20 }}>
        <div className="card"><div className="card-head"><h2>Revenue by service</h2><span className="faint small">Invoiced</span></div>
          <div className="card-body"><HBars rows={d.by_service} label="name" value="amount" fmt={money} /></div></div>
        <div className="card"><div className="card-head"><h2>Expenses by category</h2></div>
          <div className="card-body"><HBars rows={d.expenses_by_category} label="category" value="amount" fmt={money} /></div></div>
      </div>
      <div className="halves" style={{ marginBottom: 20 }}>
        <div className="card"><div className="card-head"><h2>Appointments by practitioner</h2></div>
          <div className="card-body"><HBars rows={d.appointments_by_practitioner} label="name" value="count" fmt={(n) => `${n}`} /></div></div>
        <div className="card"><div className="card-head"><h2>Appointment outcomes</h2></div>
          <div className="card-body">
            {apptTotal ? (
              <div className="row wrap" style={{ alignItems: 'center' }}>
                <div style={{ width: 170, height: 170 }}>
                  <ResponsiveContainer><PieChart>
                    <Pie data={pie} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={2} stroke="none">
                      {pie.map((x) => <Cell key={x.key} fill={PIE[x.key]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e2e9ef' }} />
                  </PieChart></ResponsiveContainer>
                </div>
                <div className="stack" style={{ gap: 9, flex: 1, minWidth: 180 }}>
                  {Object.entries(STATUS).map(([k, l]) => (
                    <div key={k} className="row"><Badge status={k}>{l}</Badge><span className="spacer" /><b className="mono">{count(k)}</b>
                      <span className="faint small" style={{ width: 44, textAlign: 'right' }}>{Math.round((count(k) / apptTotal) * 100)}%</span></div>
                  ))}
                </div>
              </div>
            ) : <Empty icon={CalendarDays} title="No appointments in this period" />}
            {d.by_payment_method.length > 0 && <><h3 style={{ margin: '22px 0 10px' }}>Payment methods</h3><HBars rows={d.by_payment_method} label="method" value="amount" fmt={money} /></>}
          </div></div>
      </div>
      <div className="card">
        <div className="card-head"><h2>Outstanding balances</h2><span className="faint small">All unpaid invoices</span></div>
        {d.outstanding.length ? (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Patient</th><th>Phone</th><th className="right">Invoices</th><th className="right">Balance</th></tr></thead>
            <tbody>{d.outstanding.map((o) => (
              <tr key={o.id} className="click" onClick={() => go(`#/patients/${o.id}`)}><td><b>{o.name}</b></td><td>{o.phone || '—'}</td>
                <td className="right">{o.invoices}</td><td className="right mono"><b style={{ color: 'var(--danger)' }}>{money(o.balance)}</b></td></tr>
            ))}</tbody>
          </table></div>
        ) : <Empty icon={Check} title="Nothing outstanding" text="Every invoice is fully paid." />}
      </div>
    </>
  );
}
