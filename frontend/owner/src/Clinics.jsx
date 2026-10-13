import { useState } from 'react';
import { KeyRound, Lock, LockOpen, Pencil, RefreshCw, Search, Shield, ShieldCheck, Sparkles, Star, Users } from 'lucide-react';
import { api } from '../../shared/api';
import { fmtIso, initials, usd } from '../../shared/format';
import { Badge, Empty, ErrorCard, Field, Loading, Modal, Seg, Stat, Switch, useAsync, useConfirm, useModal, useToast } from '../../shared/ui';

const STATUS_LABEL = { trial: 'Trial', active: 'Active', expired: 'Expired', suspended: 'Suspended' };
const TYPE_LABEL = { dental: 'Dental clinic', therapy: 'Therapy / counselling', physio: 'Physiotherapy', general: 'General practice', other: 'Other' };

function accessText(c) {
  const a = c.access;
  if (a.status === 'trial') return `Trial ends ${fmtIso(a.ends_at)} · ${a.days_left}d left`;
  if (a.status === 'active') return a.lifetime ? 'Lifetime licence' : `Active until ${fmtIso(a.ends_at)} · ${a.days_left}d left`;
  if (a.status === 'expired') return `Ended ${fmtIso(a.ends_at)}`;
  return 'Suspended by you';
}

export default function Clinics({ me }) {
  const open = useModal();
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useAsync(() => api('/api/admin/clinics'), []);
  if (error) return <ErrorCard error={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  const counts = { all: data.length, trial: 0, active: 0, expired: 0, suspended: 0 };
  data.forEach((c) => { counts[c.access.status]++; });
  const needle = q.toLowerCase();
  const rows = data.filter((c) => (filter === 'all' || c.access.status === filter)
    && (!needle || [c.name, c.owner_name, c.email, c.phone].some((x) => String(x || '').toLowerCase().includes(needle))));
  return (
    <>
      <div className="page-head"><div><h1>Clinic accounts</h1><div className="sub">Every clinic that has signed up. New sign-ups get a {me.trial_days}-day free trial automatically.</div></div></div>
      <div className="stats">
        <Stat icon={Users} tone="teal" label="Total clinics" value={counts.all} />
        <Stat icon={Star} tone="amber" label="On free trial" value={counts.trial} />
        <Stat icon={ShieldCheck} tone="green" label="Active (approved)" value={counts.active} />
        <Stat icon={Lock} tone="red" label="Expired / suspended" value={counts.expired + counts.suspended} />
      </div>
      <div className="card">
        <div className="toolbar">
          <div className="search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clinic, owner, email or phone…" /></div>
          <Seg options={['all', 'trial', 'active', 'expired', 'suspended'].map((k) => [k, `${k === 'all' ? 'All' : STATUS_LABEL[k]} (${counts[k]})`])} value={filter} onChange={setFilter} />
          <span className="spacer" />
          <button className="btn sm" onClick={reload}><RefreshCw /><span>Refresh</span></button>
        </div>
        {rows.length ? (
          <div className="clinic-list">{rows.map((c) => (
            <div key={c.id} className="clinic-card" role="button" tabIndex={0}
              onClick={(e) => { if (!e.target.closest('a')) open((close) => <ManageModal close={close} clinic={c} onChanged={reload} />); }}
              onKeyDown={(e) => e.key === 'Enter' && open((close) => <ManageModal close={close} clinic={c} onChanged={reload} />)}>
              <div className="cc-top">
                <div className="avatar">{initials(c.name)}</div>
                <div className="cc-name"><b>{c.name}</b>
                  <div className="small muted">{TYPE_LABEL[c.clinic_type] || c.clinic_type || ''}{c.admin_note && <> · <span title={c.admin_note}>📝 note</span></>}
                    {c.totp_enabled && <> · <ShieldCheck size={13} style={{ verticalAlign: -2 }} /> 2FA</>}
                    {c.locked_until && Date.parse(c.locked_until) > Date.now() && <> · <span className="err-text">locked</span></>}</div></div>
                <Badge status={c.access.status}>{STATUS_LABEL[c.access.status]}</Badge>
                <button className="btn primary"><Shield /><span>Manage</span></button>
              </div>
              <div className="cc-meta">
                <div><span className="faint">Access</span>{accessText(c)}</div>
                <div><span className="faint">Contact</span>{c.owner_name || ''} {c.owner_name && '·'} <a href={`mailto:${c.email}`}>{c.email}</a>{c.phone && ` · ${c.phone}`}</div>
                <div><span className="faint">Signed up</span>{fmtIso(c.created_at)} · last login {fmtIso(c.last_login_at)}</div>
                <div><span className="faint">Usage</span>{c.patient_count} patients · {c.appointment_count} appts · {c.invoice_count} invoices · {c.document_count} docs
                  {c.ai.requests > 0 && <> · AI {usd(c.ai.used_usd)}</>}</div>
              </div>
            </div>
          ))}</div>
        ) : <Empty icon={Users} title={data.length ? 'No clinics match' : 'No clinics yet'} text={data.length ? '' : 'Share your app link. Clinics that sign up will appear here.'} />}
      </div>
    </>
  );
}

function ManageModal({ close, clinic, onChanged }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [c, setC] = useState(clinic);
  const [days, setDays] = useState('');
  const [pw, setPw] = useState('');
  const [note, setNote] = useState(clinic.admin_note || '');
  const [ai, setAi] = useState({ enabled: clinic.ai_enabled == null ? null : !!clinic.ai_enabled, limit: clinic.ai_monthly_limit ?? '' });
  const act = async (body, msg) => {
    try {
      const updated = await api(`/api/admin/clinics/${c.id}/action`, { method: 'POST', body });
      setC(updated);
      onChanged();
      toast(msg);
    } catch (err) { toast(err.message, true); }
  };
  const suspended = c.access.status === 'suspended';
  const locked = c.locked_until && Date.parse(c.locked_until) > Date.now();
  return (
    <Modal title={c.name} wide onClose={close} hideSubmit>
      <div className="stack">
        <div className="card card-pad" style={{ background: 'var(--surface-2)', boxShadow: 'none' }}>
          <div className="row wrap"><Badge status={c.access.status}>{STATUS_LABEL[c.access.status]}</Badge><b>{accessText(c)}</b></div>
          <div className="small muted" style={{ marginTop: 6 }}>{c.owner_name} · {c.email}{c.phone && ` · ${c.phone}`} · signed up {fmtIso(c.created_at)}</div>
        </div>

        <div className="card card-pad" style={{ boxShadow: 'none' }}>
          <h3><ShieldCheck />Activate / approve</h3>
          <p className="small muted" style={{ margin: '4px 0 12px' }}>Gives full access. If already active, days are added on top of the remaining time.</p>
          <div className="row wrap">
            {[[30, '30 days'], [90, '90 days'], [180, '6 months'], [365, '1 year']].map(([d, l]) => (
              <button key={d} type="button" className="btn" onClick={() => act({ action: 'activate', days: d }, `Activated for ${l}`)}>{l}</button>
            ))}
            <button type="button" className="btn primary" onClick={() => act({ action: 'activate', days: 0 }, 'Lifetime licence activated')}>Lifetime</button>
            <span className="row" style={{ gap: 6 }}><input type="number" min="1" value={days} onChange={(e) => setDays(e.target.value)} placeholder="Days" style={{ width: 90 }} />
              <button type="button" className="btn" onClick={() => (Number(days) > 0 ? act({ action: 'activate', days: Number(days) }, `Activated for ${days} days`) : toast('Enter number of days', true))}>Activate</button></span>
          </div>
        </div>

        <div className="card card-pad" style={{ boxShadow: 'none' }}>
          <h3><Star />Extend free trial</h3>
          <div className="row wrap" style={{ marginTop: 10 }}>{[3, 7, 14, 30].map((d) => (
            <button key={d} type="button" className="btn" onClick={() => act({ action: 'extend_trial', days: d }, `Trial extended by ${d} days`)}>+{d} days</button>
          ))}</div>
        </div>

        <div className="card card-pad" style={{ boxShadow: 'none' }}>
          <h3><Lock />Restrict access</h3>
          <p className="small muted" style={{ margin: '4px 0 12px' }}><b>End access now</b> works like an expired trial (view and export only). <b>Suspend</b> blocks the account completely
            and signs them out everywhere. Data is never deleted.</p>
          <div className="row wrap">
            <button type="button" className="btn danger" onClick={async () => { if (await confirm(`${c.name} will lose add/edit access immediately (read-only).`, { okLabel: 'End access' })) act({ action: 'revoke' }, 'Access ended'); }}>End access now</button>
            {suspended
              ? <button type="button" className="btn" onClick={() => act({ action: 'unsuspend' }, 'Clinic unsuspended')}>Unsuspend</button>
              : <button type="button" className="btn danger" onClick={async () => { if (await confirm(`${c.name} will be fully blocked until you unsuspend them.`, { okLabel: 'Suspend' })) act({ action: 'suspend' }, 'Clinic suspended'); }}>Suspend</button>}
          </div>
        </div>

        <div className="card card-pad" style={{ boxShadow: 'none' }}>
          <h3><Sparkles />AI assistant for this clinic</h3>
          <p className="small muted" style={{ margin: '4px 0 12px' }}>Used this month: <b>{usd(c.ai.used_usd)}</b> of {usd(c.ai.limit_usd)} ({c.ai.requests} requests).
            Leave on "default" to follow your AI settings.</p>
          <div className="row wrap" style={{ alignItems: 'flex-end' }}>
            <Field label="AI access"><select value={ai.enabled === null ? '' : ai.enabled ? 'on' : 'off'} style={{ width: 170 }}
              onChange={(e) => setAi({ ...ai, enabled: e.target.value === '' ? null : e.target.value === 'on' })}>
              <option value="">Default</option><option value="on">On</option><option value="off">Off</option></select></Field>
            <Field label="Monthly limit (USD)"><input type="number" min="0" step="0.5" value={ai.limit} placeholder="Default" style={{ width: 150 }}
              onChange={(e) => setAi({ ...ai, limit: e.target.value })} /></Field>
            <button type="button" className="btn" onClick={() => act({ action: 'ai', enabled: ai.enabled, limit: ai.limit === '' ? null : Number(ai.limit) }, 'AI settings saved')}>Save AI settings</button>
          </div>
        </div>

        <div className="grid2">
          <div className="card card-pad stack" style={{ boxShadow: 'none', gap: 10 }}>
            <h3><KeyRound />Sign-in help</h3>
            <input type="text" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password for the clinic" autoComplete="off" />
            <div className="row wrap">
              <button type="button" className="btn" onClick={() => (pw ? act({ action: 'reset_password', password: pw }, 'Password reset. Share it with the clinic.') : toast('Type a new password first', true))}>Set password</button>
              {c.totp_enabled && <button type="button" className="btn" onClick={async () => { if (await confirm('Two-step sign-in will be turned off for this clinic (e.g. they lost their phone). Only do this after confirming who they are.', { okLabel: 'Reset 2FA' })) act({ action: 'reset_2fa' }, 'Two-step sign-in reset'); }}>Reset 2FA</button>}
              {locked && <button type="button" className="btn" onClick={() => act({ action: 'unlock' }, 'Account unlocked')}><LockOpen /><span>Unlock</span></button>}
            </div>
          </div>
          <div className="card card-pad stack" style={{ boxShadow: 'none', gap: 10 }}>
            <h3><Pencil />Private note</h3>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} style={{ minHeight: 60 }} placeholder="Payment received, plan, reminders… (only you see this)" />
            <div><button type="button" className="btn" onClick={() => act({ action: 'note', note }, 'Note saved')}>Save note</button></div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
