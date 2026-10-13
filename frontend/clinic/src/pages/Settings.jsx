import { useState } from 'react';
import { Activity, Building2, Database, Download, FileSpreadsheet, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { api, qs } from '../../../shared/api';
import { fmtIso, fmtIsoTime, usd } from '../../../shared/format';
import { SessionsCard, TwoFactorCard } from '../../../shared/Security';
import { Badge, Field, Loading, PageHead, useAsync, useModal, useToast } from '../../../shared/ui';
import { useApp } from '../context';
import Contact from '../components/Contact';
import ImportModal from '../components/ImportModal';

const ACTION_LABELS = {
  'auth.login': 'Signed in', 'auth.login_failed': 'Failed sign-in attempt', 'auth.logout': 'Signed out', 'auth.register': 'Account created',
  'patients.view': 'Viewed patient record', 'patients.create': 'Added patient', 'patients.update': 'Edited patient', 'patients.delete': 'Deleted patient',
  'patients.import': 'Imported patients', 'notes.create': 'Wrote clinical note', 'notes.update': 'Edited clinical note', 'notes.delete': 'Deleted clinical note',
  'appointments.create': 'Booked appointment', 'appointments.update': 'Changed appointment', 'appointments.delete': 'Deleted appointment',
  'documents.upload': 'Uploaded document', 'documents.update': 'Edited document', 'documents.delete': 'Deleted document', 'documents.download': 'Downloaded document',
  'invoices.create': 'Created invoice', 'invoices.update': 'Edited invoice', 'invoices.delete': 'Deleted invoice',
  'payments.create': 'Recorded payment', 'payments.delete': 'Removed payment', 'expenses.create': 'Added expense', 'expenses.update': 'Edited expense', 'expenses.delete': 'Deleted expense',
  'data.export': 'Exported data', 'clinic.update': 'Changed clinic profile', 'account.password_changed': 'Changed password',
  'account.2fa_enabled': 'Turned on two-step sign-in', 'account.2fa_disabled': 'Turned off two-step sign-in', 'account.recovery_codes_renewed': 'Created new recovery codes',
  'account.signed_out_other_devices': 'Signed out other devices', 'account.signed_out_device': 'Signed out a device',
  'ai.chat': 'Asked the AI assistant', 'ai.patient_summary': 'AI patient summary', 'ai.soap': 'AI SOAP note draft', 'ai.tidy_document': 'AI tidied a document',
};
export const actionLabel = (a) => ACTION_LABELS[a] || (a.startsWith('owner.') ? `Support: ${a.slice(6).replace(/_/g, ' ')}` : a.replace(/[._]/g, ' '));

function Profile() {
  const { me, canWrite, reloadMe } = useApp();
  const toast = useToast();
  const c = me.clinic;
  const [f, setF] = useState({ name: c.name, owner_name: c.owner_name || '', email: c.email, phone: c.phone || '', address: c.address || '',
    currency: c.currency || '$', tax_rate: c.tax_rate || 0, invoice_footer: c.invoice_footer || '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const a = me.access;
  const planText = a.status === 'trial' ? `Free trial · ends ${fmtIso(a.ends_at)} (${a.days_left} day${a.days_left === 1 ? '' : 's'} left)`
    : a.status === 'active' ? (a.lifetime ? 'Active · lifetime licence' : `Active until ${fmtIso(a.ends_at)}`) : 'Expired · read-only access';
  return (
    <div className="two-col">
      <form className="card" onSubmit={async (e) => {
        e.preventDefault();
        setError('');
        try { await api('/api/clinic', { method: 'PUT', body: f }); await reloadMe(); toast('Clinic profile saved'); } catch (err) { setError(err.message); }
      }}>
        <div className="card-head"><h2><Building2 />Clinic profile</h2></div>
        <div className="card-body stack">
          {error && <div className="form-error">{error}</div>}
          <div className="grid2">
            <Field label="Clinic name"><input value={f.name} onChange={set('name')} /></Field>
            <Field label="Owner / lead practitioner"><input value={f.owner_name} onChange={set('owner_name')} /></Field>
            <Field label="Login email"><input type="email" value={f.email} onChange={set('email')} /></Field>
            <Field label="Phone"><input value={f.phone} onChange={set('phone')} /></Field>
            <Field label="Address (shown on invoices)" className="span2"><textarea value={f.address} onChange={set('address')} style={{ minHeight: 60 }} /></Field>
            <Field label="Currency symbol"><input value={f.currency} onChange={set('currency')} placeholder="$, £, €, Rs, AED…" /></Field>
            <Field label="Default tax rate (%)"><input type="number" min="0" step="0.01" value={f.tax_rate} onChange={set('tax_rate')} /></Field>
            <Field label="Invoice footer" className="span2"><textarea value={f.invoice_footer} onChange={set('invoice_footer')} style={{ minHeight: 60 }} placeholder="Bank details, thank-you message, registration number…" /></Field>
          </div>
          <div><button className="btn primary" disabled={!canWrite}>Save profile</button></div>
        </div>
      </form>
      <div className="stack" style={{ gap: 20 }}>
        <div className="card"><div className="card-head"><h2>Subscription</h2></div>
          <div className="card-body stack" style={{ gap: 10 }}>
            <div>{planText}</div>
            {me.ai.enabled && <div className="small muted">AI assistant: {usd(me.ai.used_usd)} of {usd(me.ai.limit_usd)} used this month</div>}
            {(me.product.support_email || me.product.support_phone) && <><div className="small muted">To activate or renew, contact:</div><Contact product={me.product} /></>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Security() {
  const { me, reloadMe } = useApp();
  const toast = useToast();
  const [pw, setPw] = useState({ current: '', password: '' });
  const [error, setError] = useState('');
  return (
    <div className="two-col">
      <div className="stack" style={{ gap: 20 }}>
        <TwoFactorCard base="/api/account" enabled={me.clinic.totp_enabled} recoveryLeft={me.clinic.recovery_codes_left} productName={me.product.name} onChange={reloadMe} />
        <SessionsCard listPath="/api/account/sessions" othersPath="/api/account/sessions/others" onePath="/api/account/sessions" />
      </div>
      <div className="stack" style={{ gap: 20 }}>
        <form className="card" onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          try { await api('/api/clinic/password', { method: 'PUT', body: pw }); setPw({ current: '', password: '' }); toast('Password updated. Other devices were signed out.'); }
          catch (err) { setError(err.message); }
        }}>
          <div className="card-head"><h2><KeyRound />Change password</h2></div>
          <div className="card-body stack">
            {error && <div className="form-error">{error}</div>}
            <Field label="Current password"><input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" /></Field>
            <Field label="New password"><input type="password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} autoComplete="new-password" /></Field>
            <div><button className="btn">Update password</button></div>
          </div>
        </form>
        <div className="card"><div className="card-head"><h2><ShieldCheck />How your data is protected</h2></div>
          <div className="card-body small stack" style={{ gap: 8 }}>
            <div><Lock size={14} style={{ verticalAlign: -2 }} /> Medical details, notes, document text and uploaded photos are <b>encrypted</b> on the server.</div>
            <div><Lock size={14} style={{ verticalAlign: -2 }} /> Every sign-in, record view and change is written to the <b>activity log</b>.</div>
            <div><Lock size={14} style={{ verticalAlign: -2 }} /> After 5 wrong passwords the account is <b>locked for 15 minutes</b>.</div>
            <div><Lock size={14} style={{ verticalAlign: -2 }} /> You're signed out automatically after <b>12 hours</b> without activity.</div>
            <div><Lock size={14} style={{ verticalAlign: -2 }} /> The AI assistant never receives phone numbers, emails or addresses.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActivityLog() {
  const [before, setBefore] = useState('');
  const [rows, setRows] = useState([]);
  const { loading } = useAsync(async () => {
    const page = await api(`/api/audit${qs({ limit: 100, before })}`);
    setRows((r) => (before ? [...r, ...page] : page));
    return page;
  }, [before]);
  return (
    <div className="card">
      <div className="card-head"><h2><Activity />Activity log</h2><span className="faint small">Who did what, and when. Kept for 2 years.</span></div>
      {rows.map((r) => (
        <div className="log-row" key={r.id}>
          <span className="muted">{fmtIsoTime(r.at)}</span>
          <span>{r.action === 'auth.login_failed' ? <b className="err-text">{actionLabel(r.action)}</b> : actionLabel(r.action)}
            {r.detail && <span className="muted"> · {r.detail}</span>}{r.actor === 'owner' && <> <Badge status="trial">support</Badge></>}</span>
          <span className="small faint">{r.ip || ''}</span>
        </div>
      ))}
      {loading && <Loading minHeight={80} />}
      {!loading && rows.length === 0 && <div className="card-body muted">No activity yet.</div>}
      {!loading && rows.length > 0 && rows.length % 100 === 0 && (
        <div className="card-body"><button className="btn sm" onClick={() => setBefore(rows[rows.length - 1].at)}>Load older</button></div>
      )}
    </div>
  );
}

function Data() {
  const { canWrite } = useApp();
  const open = useModal();
  const items = [['patients', 'Patients'], ['appointments', 'Appointments'], ['notes', 'Clinical notes'], ['invoices', 'Invoices'], ['payments', 'Payments'], ['expenses', 'Expenses'], ['documents', 'Documents (text)']];
  return (
    <div className="halves">
      <div className="card"><div className="card-head"><h2><FileSpreadsheet />Export to Excel</h2></div>
        <div className="card-body stack">
          <p className="small muted" style={{ margin: 0 }}>Download formatted Excel workbooks. The full export contains every sheet in one file.</p>
          <div><a className="btn primary" href="/api/export/all.xlsx" download><Download /><span>Everything (one workbook)</span></a></div>
          <div className="row wrap">{items.map(([k, l]) => <a key={k} className="btn sm" href={`/api/export/${k}.xlsx`} download><Download /><span>{l}</span></a>)}</div>
          <p className="small faint" style={{ margin: 0 }}>Prefer CSV? {items.map(([k, l], i) => <span key={k}>{i > 0 && ' · '}<a href={`/api/export/${k}.csv`} download>{l}</a></span>)}</p>
        </div>
      </div>
      <div className="card"><div className="card-head"><h2><Database />Import from Excel</h2></div>
        <div className="card-body stack">
          <p className="small muted" style={{ margin: 0 }}>Moving from another system or a spreadsheet? Import your patient list. Columns are matched automatically and duplicates are skipped.</p>
          <div className="row wrap">
            <button className="btn primary" disabled={!canWrite} onClick={() => open((c) => <ImportModal close={c} />)}><FileSpreadsheet /><span>Import patients</span></button>
            <a className="btn" href="/api/import/patients/template.xlsx" download><Download /><span>Template</span></a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { me } = useApp();
  const [tab, setTab] = useState('profile');
  return (
    <>
      <PageHead title="Settings" sub="Clinic profile, security, activity and data" />
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="pill-tabs" style={{ borderBottom: 0 }}>
          {[['profile', 'Clinic profile'], ['security', `Security${me.clinic.totp_enabled ? '' : ' ⚠'}`], ['activity', 'Activity log'], ['data', 'Import & export']].map(([k, l]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
      </div>
      {tab === 'profile' && <Profile />}
      {tab === 'security' && <Security />}
      {tab === 'activity' && <ActivityLog />}
      {tab === 'data' && <Data />}
    </>
  );
}
