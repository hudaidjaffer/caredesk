import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { api, qs } from '../../../shared/api';
import { fmtTime, localDate, pad, parseLocal, safeColor } from '../../../shared/format';
import { Badge, Empty, ErrorCard, Loading, PageHead, Seg, useAsync, useModal, useToast } from '../../../shared/ui';
import { useApp } from '../context';
import { ApptList } from '../components/common';
import AppointmentModal, { openAppointment } from '../components/AppointmentModal';

const H0 = 7;
const H1 = 21;
const PX = 56;
// remembered while the app is open
const calState = { date: localDate(), view: window.innerWidth < 860 ? 'list' : 'week', practitioner: '' };

function layoutDay(evs) {
  evs.sort((a, b) => a.s - b.s || b.e - a.e);
  let cluster = [];
  let lanes = [];
  let end = -1;
  const flush = () => { cluster.forEach((e) => { e.n = lanes.length; }); cluster = []; lanes = []; };
  for (const e of evs) {
    if (e.s >= end && cluster.length) flush();
    let li = lanes.findIndex((x) => x <= e.s);
    if (li < 0) { li = lanes.length; lanes.push(0); }
    lanes[li] = e.e;
    e.lane = li;
    cluster.push(e);
    end = Math.max(end, e.e);
  }
  flush();
  return evs;
}

export default function Appointments() {
  const { refs, canWrite, version } = useApp();
  const open = useModal();
  const toast = useToast();
  const [c, setC] = useState(calState);
  useEffect(() => { Object.assign(calState, c); }, [c]);
  const base = parseLocal(c.date);
  const start = new Date(base);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const days = [...Array(7)].map((_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const from = localDate(days[0]);
  const to = localDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7));
  const { data: list, error, loading, reload } = useAsync(
    () => api(`/api/appointments${qs({ from: `${from}T00:00`, to: `${to}T00:00`, practitioner_id: c.practitioner })}`), [from, c.practitioner, version]);
  const scroller = useRef(null);
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = PX; }, [c.view, from]);
  if (error) return <ErrorCard error={error} onRetry={reload} />;

  const today = localDate();
  const label = `${days[0].toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${days[6].toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const move = (n) => setC({ ...c, date: n === 0 ? localDate() : localDate(new Date(base.getFullYear(), base.getMonth(), base.getDate() + n)) });
  const openAppt = (a) => openAppointment(open, toast, a.id);
  const rows = list || [];
  const nowD = new Date();
  const nowMin = nowD.getHours() * 60 + nowD.getMinutes();

  return (
    <>
      <PageHead title="Appointments" sub={`${rows.filter((a) => a.status !== 'cancelled').length} booked this week`}>
        <button className="btn primary" disabled={!canWrite} onClick={() => open((cl) => <AppointmentModal close={cl} />)}><Plus /><span>Book appointment</span></button>
      </PageHead>
      <div className="card">
        <div className="toolbar">
          <button className="btn icon" aria-label="Previous week" onClick={() => move(-7)}><ChevronLeft /></button>
          <button className="btn" onClick={() => move(0)}>Today</button>
          <button className="btn icon" aria-label="Next week" onClick={() => move(7)}><ChevronRight /></button>
          <h3 style={{ margin: '0 6px' }}>{label}</h3>
          <span className="spacer" />
          <select value={c.practitioner} onChange={(e) => setC({ ...c, practitioner: e.target.value })} style={{ width: 'auto' }}>
            <option value="">All practitioners</option>
            {refs.practitioners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <Seg options={[['week', 'Week'], ['list', 'List']]} value={c.view} onChange={(v) => setC({ ...c, view: v })} />
        </div>
        {loading && !list ? <Loading minHeight={300} /> : c.view === 'week' ? (
          <div className="cal-scroll" ref={scroller}>
            <div className="cal">
              <div className="cal-head" />
              {days.map((d) => (
                <div key={d.toISOString()} className={`cal-head${localDate(d) === today ? ' today' : ''}`}>
                  {d.toLocaleDateString(undefined, { weekday: 'short' })}<b>{d.getDate()}</b>
                </div>
              ))}
              <div className="cal-times">{[...Array(H1 - H0)].map((_, i) => (
                <div key={i}>{i ? new Date(2000, 0, 1, H0 + i).toLocaleTimeString(undefined, { hour: 'numeric' }) : ''}</div>
              ))}</div>
              {days.map((d) => {
                const ds = localDate(d);
                const evs = layoutDay(rows.filter((a) => a.starts_at.slice(0, 10) === ds).map((a) => {
                  const t = parseLocal(a.starts_at);
                  const s = t.getHours() * 60 + t.getMinutes();
                  return { a, s, e: s + Math.max(Number(a.duration_min) || 30, 15) };
                }));
                return (
                  <div key={ds} className={`cal-day${ds === today ? ' today' : ''}`} style={{ height: (H1 - H0) * PX }}
                    onClick={(e) => {
                      if (e.target.closest('.cal-ev') || !canWrite) return;
                      const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
                      const mins = H0 * 60 + Math.floor(((y / PX) * 60) / 15) * 15;
                      open((cl) => <AppointmentModal close={cl} preset={{ starts_at: `${ds}T${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`, practitioner_id: c.practitioner || undefined }} />);
                    }}>
                    {evs.map(({ a, s, e, lane, n }) => {
                      const top = Math.max(0, ((s - H0 * 60) / 60) * PX);
                      const height = Math.max(22, ((Math.min(e, H1 * 60) - Math.max(s, H0 * 60)) / 60) * PX - 2);
                      const w = 100 / n;
                      return (
                        <div key={a.id} className={`cal-ev ${a.status}`} title={`${fmtTime(a.starts_at)} ${a.patient_name} · ${a.service_name || ''}`}
                          onClick={() => openAppt(a)}
                          style={{ top, height, left: `calc(${lane * w}% + 3px)`, width: `calc(${w}% - 6px)`, right: 'auto', '--c': safeColor(a.practitioner_color) }}>
                          <b>{a.patient_name}</b>{fmtTime(a.starts_at)}{a.service_name ? ` · ${a.service_name}` : ''}
                        </div>
                      );
                    })}
                    {ds === today && nowMin >= H0 * 60 && nowMin <= H1 * 60 && <div className="now-line" style={{ top: ((nowMin - H0 * 60) / 60) * PX }} />}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          days.some((d) => rows.some((a) => a.starts_at.slice(0, 10) === localDate(d))) ? days.map((d) => {
            const ds = localDate(d);
            const evs = rows.filter((a) => a.starts_at.slice(0, 10) === ds);
            if (!evs.length) return null;
            return (
              <div key={ds}>
                <div className="card-head" style={{ background: 'var(--surface-2)' }}>
                  <h3>{d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
                  {ds === today && <Badge status="confirmed">Today</Badge>}<span className="spacer" />
                  <span className="faint small">{evs.length} appointment{evs.length === 1 ? '' : 's'}</span>
                </div>
                <ApptList list={evs} onOpen={openAppt} />
              </div>
            );
          }) : <Empty icon={CalendarDays} title="No appointments this week" />
        )}
      </div>
      {c.view === 'week' && canWrite && <p className="small faint">Tip: click an empty slot in the calendar to book at that time.</p>}
    </>
  );
}
