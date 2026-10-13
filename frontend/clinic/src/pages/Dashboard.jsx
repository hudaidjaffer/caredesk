import { Banknote, CalendarDays, Check, Clock, Receipt, Sparkles, UserPlus, Users } from 'lucide-react';
import { api } from '../../../shared/api';
import { fmtDate, localDate } from '../../../shared/format';
import { Empty, ErrorCard, Loading, PageHead, Stat, useAsync, useModal, useToast } from '../../../shared/ui';
import { go, useApp } from '../context';
import { ApptList, IncomeChart } from '../components/common';
import AppointmentModal, { openAppointment } from '../components/AppointmentModal';
import PatientModal from '../components/PatientModal';
import InvoiceModal from '../components/InvoiceModal';

export default function Dashboard() {
  const { me, money, canWrite, aiOn, version } = useApp();
  const open = useModal();
  const toast = useToast();
  const { data: d, error, loading, reload } = useAsync(() => api(`/api/dashboard?today=${localDate()}`), [version]);
  if (error) return <ErrorCard error={error} onRetry={reload} />;
  if (loading && !d) return <Loading />;
  const first = (me.clinic.owner_name || '').replace(/^(dr\.?|mr\.?|mrs\.?|ms\.?)\s+/i, '').split(' ')[0];
  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const st = d.stats;
  const openAppt = (a) => openAppointment(open, toast, a.id);
  return (
    <>
      <PageHead title={`${greet}${first ? `, ${first}` : ''}`}
        sub={`${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${st.appointments_today} appointment${st.appointments_today === 1 ? '' : 's'} today`}>
        {aiOn && <button className="btn" onClick={() => go('#/assistant')}><Sparkles /><span>Ask AI</span></button>}
        <button className="btn" disabled={!canWrite} onClick={() => open((c) => <PatientModal close={c} />)}><UserPlus /><span>New patient</span></button>
        <button className="btn" disabled={!canWrite} onClick={() => open((c) => <InvoiceModal close={c} />)}><Receipt /><span>New invoice</span></button>
        <button className="btn primary" disabled={!canWrite} onClick={() => open((c) => <AppointmentModal close={c} />)}><CalendarDays /><span>Book appointment</span></button>
      </PageHead>
      <div className="stats">
        <Stat icon={CalendarDays} tone="teal" label="Today's appointments" value={st.appointments_today} hint={`${st.appointments_week} in the next 7 days`} />
        <Stat icon={Users} tone="blue" label="Patients" value={st.patients.toLocaleString()} hint={`+${st.new_patients_month} new this month`} />
        <Stat icon={Banknote} tone="green" label="Income this month" value={money(st.income_month)} hint={`Expenses ${money(st.expenses_month)}`} />
        <Stat icon={Receipt} tone="amber" label="Outstanding" value={money(st.outstanding)} hint="Unpaid invoice balances" />
      </div>
      <div className="two-col">
        <div className="card">
          <div className="card-head"><h2>Today's schedule</h2><span className="spacer" /><a href="#/appointments">Open calendar</a></div>
          {d.today_appointments.length ? <ApptList list={d.today_appointments} onOpen={openAppt} />
            : <Empty icon={CalendarDays} title="No appointments today" text={canWrite ? 'Use “Book appointment” to add one.' : ''} />}
        </div>
        <div className="stack" style={{ gap: 20 }}>
          <div className="card">
            <div className="card-head"><h2>Coming up</h2><span className="faint small">Next 7 days</span></div>
            {d.upcoming.length ? <ApptList list={d.upcoming} showDate onOpen={openAppt} /> : <Empty icon={Clock} title="Nothing booked yet" />}
          </div>
          <div className="card">
            <div className="card-head"><h2>Overdue invoices</h2></div>
            {d.overdue.length ? (
              <div className="appt-list">{d.overdue.map((i) => (
                <a key={i.id} className="appt" href={`#/invoice/${i.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                  <div className="info"><b>{i.patient_name}</b><span>{i.number} · due {fmtDate(i.due_date)}</span></div>
                  <b className="mono" style={{ color: 'var(--danger)' }}>{money(i.balance)}</b>
                </a>
              ))}</div>
            ) : <Empty icon={Check} title="All caught up" text="No overdue invoices." />}
          </div>
        </div>
      </div>
      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-head"><h2>Income vs expenses</h2><span className="faint small">Last 6 months</span></div>
        <div className="card-body"><IncomeChart rows={d.months} /></div>
      </div>
    </>
  );
}
