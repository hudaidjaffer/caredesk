import { useEffect, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, Pencil, ClipboardList } from 'lucide-react';
import { api, qs } from '../../../shared/api';
import { age, fmtDate, fmtTime, fullName, parseLocal, RANGE_LABELS, safeColor } from '../../../shared/format';
import { Badge, Empty, Seg, useDebounced } from '../../../shared/ui';
import { STATUS, useApp } from '../context';

export function ApptList({ list, showDate, onOpen }) {
  if (!list.length) return null;
  return (
    <div className="appt-list">
      {list.map((a) => (
        <div className="appt" key={a.id} onClick={() => onOpen(a)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(a)}>
          <div className="time">{fmtTime(a.starts_at)}<small>{showDate ? fmtDate(a.starts_at) : `${a.duration_min} min`}</small></div>
          <div className="bar" style={{ background: safeColor(a.practitioner_color) }} />
          <div className="info"><b>{a.patient_name}</b><span>{a.service_name || 'Appointment'}{a.practitioner_name ? ` · ${a.practitioner_name}` : ''}</span></div>
          <Badge status={a.status}>{STATUS[a.status] || a.status}</Badge>
        </div>
      ))}
    </div>
  );
}

export function IncomeChart({ rows, height = 230 }) {
  const { money, me } = useApp();
  if (!rows.length) return <Empty icon={BarChart3} title="No data for this period" />;
  const data = rows.map((r) => ({
    label: parseLocal(`${r.month}-01`).toLocaleDateString(undefined, { month: 'short', year: rows.length > 12 ? '2-digit' : undefined }),
    Income: r.income / 100, Expenses: r.expenses / 100,
  }));
  const sym = me.clinic.currency || '$';
  const compact = (v) => `${sym}${Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : v}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={4}>
        <CartesianGrid vertical={false} stroke="#e2e9ef" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#5d6f82', fontSize: 12 }} />
        <YAxis tickLine={false} axisLine={false} tick={{ fill: '#93a3b3', fontSize: 11 }} tickFormatter={compact} width={58} />
        <Tooltip formatter={(v) => money(Math.round(v * 100))} cursor={{ fill: 'rgba(14,124,134,.06)' }} contentStyle={{ borderRadius: 10, border: '1px solid #e2e9ef' }} />
        <Legend iconType="circle" iconSize={9} wrapperStyle={{ fontSize: 12.5 }} />
        <Bar dataKey="Income" fill="#0e7c86" radius={[6, 6, 2, 2]} maxBarSize={28} />
        <Bar dataKey="Expenses" fill="#f0a35b" radius={[6, 6, 2, 2]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function HBars({ rows, label, value, fmt }) {
  if (!rows.length) return <Empty icon={BarChart3} title="No data for this period" />;
  const max = Math.max(1, ...rows.map((r) => r[value]));
  return rows.slice(0, 10).map((r, i) => (
    <div className="hbar" key={i}>
      <span>{r[label]}</span><b className="mono">{fmt(r[value])}</b>
      <div className="track"><div className="fill" style={{ width: `${(r[value] / max) * 100}%`, ...(r.color ? { background: safeColor(r.color) } : {}) }} /></div>
    </div>
  ));
}

export const RangeSeg = ({ value, onChange }) => <Seg options={Object.entries(RANGE_LABELS)} value={value} onChange={onChange} />;

export function NoteItem({ n, showPatient, onOpen }) {
  const { canWrite } = useApp();
  const parts = [['Subjective', n.subjective], ['Objective', n.objective], ['Assessment', n.assessment], ['Plan', n.plan]].filter(([, t]) => t);
  return (
    <div className="note">
      <div className="row wrap">
        <b>{fmtDate(n.date)}</b>
        {showPatient && <a href={`#/patients/${n.patient_id}`}>{n.patient_name}</a>}
        {n.practitioner_name && <span className="muted">· {n.practitioner_name}</span>}
        {n.area && <span className="badge b-confirmed">{n.area}</span>}
        <span className="spacer" />
        <button className="btn ghost sm" onClick={() => onOpen(n)}>{canWrite ? <Pencil /> : <ClipboardList />}<span>{canWrite ? 'Edit' : 'View'}</span></button>
      </div>
      <div className="soap">{parts.length ? parts.map(([l, t]) => <div key={l}><b>{l}</b>{t}</div>) : <div className="faint">Empty note</div>}</div>
    </div>
  );
}

// Search-as-you-type patient chooser; can create a new patient from the typed name.
export function PatientPicker({ value, name, onChange, label = 'Patient' }) {
  const { canWrite } = useApp();
  const [text, setText] = useState(name || '');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [hl, setHl] = useState(0);
  const q = useDebounced(text, 180);
  const typed = useRef(false);
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    api(`/api/patients${qs({ limit: 8, q })}`).then((list) => {
      if (!alive) return;
      const out = list.map((p) => ({ id: p.id, name: fullName(p), sub: [p.phone, p.dob ? age(p.dob) : ''].filter(Boolean).join(' · ') }));
      if (q.trim() && canWrite && !out.some((i) => i.name.toLowerCase() === q.trim().toLowerCase())) out.push({ create: true, text: q.trim() });
      setItems(out);
      setHl(0);
    }).catch(() => {});
    return () => { alive = false; };
  }, [q, open, canWrite]);
  const choose = async (it) => {
    if (!it) return;
    if (it.create) {
      const [first, ...rest] = it.text.split(/\s+/);
      const p = await api('/api/patients', { method: 'POST', body: { first_name: first, last_name: rest.join(' ') } });
      onChange(p.id, fullName(p));
      setText(fullName(p));
    } else {
      onChange(it.id, it.name);
      setText(it.name);
    }
    typed.current = false;
    setOpen(false);
  };
  return (
    <label className="f">{label}
      <div className="picker">
        <input value={text} autoComplete="off" placeholder="Search by name or phone, or type a new name"
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => { setText(e.target.value); typed.current = true; setOpen(true); if (value) onChange('', ''); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(h + 1, items.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)); }
            if (e.key === 'Enter') { e.preventDefault(); if (open) choose(items[hl]); }
          }} />
        {open && (
          <div className="picker-menu">
            {items.length ? items.map((it, i) => (
              <div key={it.id || 'new'} className={i === hl ? 'hl' : ''} onMouseDown={(e) => { e.preventDefault(); choose(it); }}>
                {it.create ? <span style={{ color: 'var(--primary)', fontWeight: 600 }}>+ Add new patient “{it.text}”</span> : <>{it.name}<small>{it.sub}</small></>}
              </div>
            )) : <div className="muted">No patients yet. Type a name to add one.</div>}
          </div>
        )}
      </div>
    </label>
  );
}

export function practitionerOptions(list, selected, allowEmpty = true) {
  const items = list.filter((p) => p.active || p.id === selected);
  return [
    allowEmpty && <option key="" value="">Unassigned</option>,
    ...items.map((p) => <option key={p.id} value={p.id}>{p.name}{p.role ? ` (${p.role})` : ''}</option>),
  ];
}

export function serviceOptions(list, selected, money) {
  return [
    <option key="" value="">Choose a service</option>,
    ...list.filter((s) => s.active || s.id === selected).map((s) => <option key={s.id} value={s.id}>{s.name} · {money(s.price)}</option>),
  ];
}
