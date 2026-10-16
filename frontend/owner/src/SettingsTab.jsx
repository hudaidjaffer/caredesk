import { useState } from 'react';
import { Building2, Lock, Mail, Send } from 'lucide-react';
import { api } from '../../shared/api';
import { Badge, Field, useToast } from '../../shared/ui';

export default function SettingsTab({ me, reload }) {
  const toast = useToast();
  const s = me.settings;
  const [f, setF] = useState({ product_name: s.product_name, support_name: s.support_name, support_email: s.support_email,
    support_phone: s.support_phone, expired_mode: s.expired_mode || 'readonly' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      <div className="page-head"><div><h1>Settings</h1><div className="sub">Your product name, support contact and what happens when a trial ends.</div></div></div>
      <form className="halves" onSubmit={async (e) => {
        e.preventDefault();
        try { await api('/api/admin/settings', { method: 'PUT', body: f }); await reload(); toast('Settings saved'); } catch (err) { toast(err.message, true); }
      }}>
        <div className="card">
          <div className="card-head"><h2><Building2 />Branding & support contact</h2></div>
          <div className="card-body stack">
            <p className="small muted" style={{ margin: 0 }}>Shown to clinics on the sign-in page, in trial banners, and on the "trial ended" screen so they know how to reach you.</p>
            <Field label="Product name"><input value={f.product_name} onChange={set('product_name')} /></Field>
            <Field label="Your name / company"><input value={f.support_name} onChange={set('support_name')} /></Field>
            <Field label="Support email"><input value={f.support_email} onChange={set('support_email')} /></Field>
            <Field label="Support phone / WhatsApp"><input value={f.support_phone} onChange={set('support_phone')} /></Field>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2><Lock />When a trial or subscription ends</h2></div>
          <div className="card-body stack">
            <label className="row" style={{ alignItems: 'flex-start', gap: 10 }}><input type="radio" name="mode" checked={f.expired_mode === 'readonly'} onChange={() => setF({ ...f, expired_mode: 'readonly' })} style={{ width: 'auto', marginTop: 4 }} />
              <span><b>Read-only</b><br /><span className="small muted">They can sign in, view and export their data, but cannot add or edit anything. (Recommended: fair to clinics, still encourages payment.)</span></span></label>
            <label className="row" style={{ alignItems: 'flex-start', gap: 10 }}><input type="radio" name="mode" checked={f.expired_mode === 'locked'} onChange={() => setF({ ...f, expired_mode: 'locked' })} style={{ width: 'auto', marginTop: 4 }} />
              <span><b>Fully locked</b><br /><span className="small muted">They only see a "contact us to activate" screen.</span></span></label>
            <div><button className="btn primary">Save settings</button></div>
          </div>
        </div>
      </form>
      <EmailCard me={me} reload={reload} />
    </>
  );
}

function EmailCard({ me, reload }) {
  const toast = useToast();
  const s = me.settings;
  const [f, setF] = useState({ smtp_host: s.smtp_host || '', smtp_port: s.smtp_port || '465', smtp_user: s.smtp_user || '',
    smtp_pass: '', smtp_from: s.smtp_from || '', public_url: s.public_url || '', signup_verify: s.signup_verify !== '0' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const body = { ...f };
    if (!body.smtp_pass) delete body.smtp_pass;   // empty = keep the saved password
    await api('/api/admin/email', { method: 'PUT', body });
    setF({ ...f, smtp_pass: '' });
    await reload();
  };
  return (
    <form className="card" style={{ marginTop: 18 }} onSubmit={async (e) => {
      e.preventDefault();
      try { await save(); toast('Email settings saved'); } catch (err) { toast(err.message, true); }
    }}>
      <div className="card-head"><h2><Mail />Email: sign-up verification</h2><span className="spacer" />
        {s.email_ready ? <Badge status="active">Ready</Badge> : <Badge status="expired">Not set up</Badge>}</div>
      <div className="card-body stack">
        <p className="small muted" style={{ margin: 0 }}>
          New clinics get an email with a 6-digit code and a "Confirm my email" link. Their account is only created after they confirm,
          so only real, working email addresses can sign up. The Gmail details are filled in already: just paste the 16-letter
          <b> App password</b> of that Gmail account (Google Account → Security → 2-Step Verification → App passwords) and save.</p>
        {me.online && <p className="small" style={{ margin: 0 }}>Sending needs the <b>clinic app</b> service on a paid Render plan (Starter): Render's free plan blocks email.</p>}
        <label className="row" style={{ gap: 10 }}><input type="checkbox" checked={f.signup_verify} onChange={(e) => setF({ ...f, signup_verify: e.target.checked })} style={{ width: 'auto' }} />
          <span><b>Require email confirmation for new sign-ups</b> <span className="small muted">(recommended; if email is not set up, sign-ups are paused)</span></span></label>
        <div className="grid2">
          <Field label="SMTP server"><input value={f.smtp_host} onChange={set('smtp_host')} placeholder="smtp.gmail.com" /></Field>
          <Field label="Port"><input value={f.smtp_port} onChange={set('smtp_port')} inputMode="numeric" placeholder="465" /></Field>
          <Field label="Username"><input value={f.smtp_user} onChange={set('smtp_user')} placeholder="you@gmail.com" autoComplete="off" /></Field>
          <Field label={s.smtp_pass_set ? 'Password (saved; type to replace)' : 'Password / app password'}>
            <input type="password" value={f.smtp_pass} onChange={set('smtp_pass')} autoComplete="new-password" placeholder={s.smtp_pass_set ? '••••••••' : ''} /></Field>
          <Field label="Send from (email address)"><input value={f.smtp_from} onChange={set('smtp_from')} placeholder="Same as username if empty" /></Field>
          <Field label="Your website address (for the link in emails)"><input value={f.public_url} onChange={set('public_url')} placeholder="Empty = the clinic site address" /></Field>
        </div>
        <div className="row wrap">
          <button className="btn primary" disabled={busy}>Save email settings</button>
          {!me.online && <button type="button" className="btn" disabled={busy} onClick={async () => {
            setBusy(true);
            try { await save(); const r = await api('/api/admin/email/test', { method: 'POST', body: {} }); toast(`Test email sent to ${r.to}. Check the inbox (and spam).`); } catch (err) { toast(err.message, true); }
            setBusy(false);
          }}><Send /><span>{busy ? 'Sending…' : 'Save & send test email to me'}</span></button>}
        </div>
        {me.online && <p className="small muted" style={{ margin: 0 }}>To test: open your clinic site, sign up with another email address of yours, and check that the code arrives (also in spam).</p>}
      </div>
    </form>
  );
}
