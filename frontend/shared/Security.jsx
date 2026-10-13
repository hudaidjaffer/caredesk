// Security UI shared by the clinic app and the owner panel:
// two-step sign-in (authenticator app) setup, recovery codes, signed-in devices, and the 2FA login step.
import { useState } from 'react';
import { Copy, Download, KeyRound, LogOut, Monitor, ShieldCheck, Smartphone } from 'lucide-react';
import { api } from './api';
import { downloadText, timeAgo } from './format';
import { Badge, Field, Loading, Modal, useAsync, useConfirm, useModal, useToast } from './ui';

function RecoveryCodes({ codes, productName }) {
  const toast = useToast();
  const text = `${productName} recovery codes\nEach code can be used once if you lose your phone.\n\n${codes.join('\n')}\n`;
  return (
    <div className="stack">
      <div className="banner trial" style={{ margin: 0 }}><KeyRound /><span><b>Save these recovery codes now.</b> Each one lets you sign in once without your phone. They won't be shown again.</span></div>
      <div className="codes">{codes.map((c) => <span key={c}>{c}</span>)}</div>
      <div className="row wrap">
        <button type="button" className="btn sm" onClick={() => downloadText('recovery-codes.txt', text)}><Download /><span>Download</span></button>
        <button type="button" className="btn sm" onClick={async () => { try { await navigator.clipboard.writeText(codes.join('\n')); toast('Codes copied'); } catch { toast('Copy failed. Please download instead.', true); } }}><Copy /><span>Copy</span></button>
      </div>
    </div>
  );
}

function SetupModal({ base, productName, close, onDone }) {
  const [step, setStep] = useState('password');
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);
  const submit = async () => {
    if (step === 'password') {
      setSetup(await api(`${base}/2fa/setup`, { method: 'POST', body: { password } }));
      setStep('scan');
      return true;
    }
    if (step === 'scan') {
      const r = await api(`${base}/2fa/enable`, { method: 'POST', body: { code } });
      setCodes(r.recovery_codes);
      setStep('codes');
      onDone();
      return true;
    }
    return false;
  };
  return (
    <Modal title="Turn on two-step sign-in" onClose={close} onSubmit={submit} wide={step !== 'password'}
      submitLabel={step === 'password' ? 'Continue' : step === 'scan' ? 'Turn on' : "I've saved my codes"}>
      {step === 'password' && (
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>After this, signing in needs your password <b>and</b> a 6-digit code from an authenticator app on your phone
            (Google Authenticator, Microsoft Authenticator, Authy, 1Password…). This stops anyone who learns your password from getting in.</p>
          <Field label="Confirm your password"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
        </div>
      )}
      {step === 'scan' && setup && (
        <div className="stack">
          <div className="qr-box">
            <img src={setup.qr} alt="QR code for your authenticator app" />
            <div className="stack" style={{ flex: 1, minWidth: 220, gap: 10 }}>
              <div><b>1.</b> Open your authenticator app and scan this QR code.</div>
              <div className="small muted">Can't scan? Add the account manually with this key:</div>
              <div className="secret-code">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</div>
              <div><b>2.</b> Type the 6-digit code the app shows:</div>
              <input className="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="000000" />
            </div>
          </div>
        </div>
      )}
      {step === 'codes' && codes && <RecoveryCodes codes={codes} productName={productName} />}
    </Modal>
  );
}

function PasswordCodeModal({ title, intro, base, path, close, onDone, submitLabel, productName }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);
  return (
    <Modal title={title} onClose={close} submitLabel={codes ? 'Done' : submitLabel} onSubmit={async () => {
      if (codes) return false;
      const r = await api(`${base}${path}`, { method: 'POST', body: { password, code } });
      onDone();
      if (r.recovery_codes) { setCodes(r.recovery_codes); return true; }
      return false;
    }}>
      {codes ? <RecoveryCodes codes={codes} productName={productName} /> : (
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>{intro}</p>
          <Field label="Password"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
          <Field label="6-digit code from your app (or a recovery code)"><input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" /></Field>
        </div>
      )}
    </Modal>
  );
}

// Card shown in Settings. base = '/api/account' (clinic) or '/api/admin/account' (owner).
export function TwoFactorCard({ base, enabled, recoveryLeft, productName, onChange, recommendText }) {
  const open = useModal();
  return (
    <div className="card">
      <div className="card-head"><h2><ShieldCheck />Two-step sign-in</h2><span className="spacer" />
        {enabled ? <Badge status="active">On</Badge> : <Badge status="cancelled">Off</Badge>}</div>
      <div className="card-body stack">
        {enabled ? (
          <>
            <div className="row" style={{ alignItems: 'flex-start' }}><Smartphone className="ok-text" />
              <span>Signing in needs your password and a code from your authenticator app.
                {' '}<span className="muted">{recoveryLeft} recovery code{recoveryLeft === 1 ? '' : 's'} left.</span></span></div>
            <div className="row wrap">
              <button className="btn sm" onClick={() => open((close) => <PasswordCodeModal title="New recovery codes" base={base} path="/2fa/recovery-codes"
                intro="This replaces your old recovery codes with 10 new ones." submitLabel="Create new codes" close={close} onDone={onChange} productName={productName} />)}>
                <KeyRound /><span>New recovery codes</span></button>
              <button className="btn sm danger" onClick={() => open((close) => <PasswordCodeModal title="Turn off two-step sign-in" base={base} path="/2fa/disable"
                intro="Your account will be protected by your password only." submitLabel="Turn off" close={close} onDone={onChange} productName={productName} />)}>
                <span>Turn off</span></button>
            </div>
          </>
        ) : (
          <>
            <p className="muted" style={{ margin: 0 }}>{recommendText || 'Strongly recommended: protects patient records even if your password is guessed or leaked.'}</p>
            <div><button className="btn primary" onClick={() => open((close) => <SetupModal base={base} productName={productName} close={close} onDone={onChange} />)}>
              <ShieldCheck /><span>Turn on two-step sign-in</span></button></div>
          </>
        )}
      </div>
    </div>
  );
}

export function SessionsCard({ listPath, othersPath, onePath }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, reload } = useAsync(() => api(listPath), [listPath]);
  return (
    <div className="card">
      <div className="card-head"><h2><Monitor />Signed-in devices</h2><span className="spacer" />
        {othersPath && data && data.length > 1 && (
          <button className="btn sm" onClick={async () => {
            if (!(await confirm('All other devices will be signed out.', { okLabel: 'Sign them out', danger: false }))) return;
            await api(othersPath, { method: 'DELETE' }); toast('Other devices signed out'); reload();
          }}><LogOut /><span>Sign out others</span></button>
        )}</div>
      {loading && !data ? <Loading minHeight={120} /> : (
        <div>{(data || []).map((s) => (
          <div className="sec-row" key={s.id}>
            <span className="ico tone-teal"><Monitor /></span>
            <div style={{ flex: 1 }}>
              <b>{s.device || 'Browser'}</b> {s.current && <Badge status="active">This device</Badge>}
              <div className="small muted">IP {s.ip || '—'} · active {timeAgo(s.last_seen_at)} · signed in {timeAgo(s.created_at)}</div>
            </div>
            {!s.current && onePath && (
              <button className="btn sm ghost" onClick={async () => { await api(`${onePath}/${s.id}`, { method: 'DELETE' }); toast('Device signed out'); reload(); }}>Sign out</button>
            )}
          </div>
        ))}</div>
      )}
    </div>
  );
}

// The second login step: asks for the 6-digit code (or a recovery code).
export function SecondStepForm({ path, onDone, onBack }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api(path, { method: 'POST', body: { code } });
      onDone(r);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <form className="stack" onSubmit={submit} noValidate>
      {error && <div className="form-error">{error}</div>}
      <p className="muted" style={{ margin: 0 }}>{useRecovery ? 'Enter one of your saved recovery codes.' : 'Open your authenticator app and enter the 6-digit code.'}</p>
      {useRecovery
        ? <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="xxxx-xxxx" autoFocus />
        : <input className="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} autoFocus
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="000000" />}
      <button className="btn primary block" style={{ height: 44 }} disabled={busy}>{busy ? 'Checking…' : 'Verify'}</button>
      <div className="row small" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="link-btn" onClick={() => { setUseRecovery(!useRecovery); setCode(''); }}>
          {useRecovery ? 'Use authenticator code' : 'Lost your phone? Use a recovery code'}</button>
        <button type="button" className="link-btn" onClick={onBack}>Back</button>
      </div>
    </form>
  );
}
