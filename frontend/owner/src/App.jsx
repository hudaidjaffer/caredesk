import { useCallback, useEffect, useState } from 'react';
import { Activity, Building2, LogOut, Settings, ShieldCheck, Sparkles } from 'lucide-react';
import { api } from '../../shared/api';
import { SecondStepForm } from '../../shared/Security';
import { Brand, ErrorCard, Field, Loading, ModalProvider, ToastProvider, useToast } from '../../shared/ui';
import Clinics from './Clinics';
import AiTab from './AiTab';
import AuditTab from './AuditTab';
import SecurityTab from './SecurityTab';
import SettingsTab from './SettingsTab';

export default function App() {
  const [state, setState] = useState({ loading: true });
  const boot = useCallback(async () => {
    try {
      const me = await api('/api/admin/me');
      document.title = `${me.settings.product_name} · Owner Panel`;
      setState({ me });
    } catch (e) {
      if (e.status !== 401) return setState({ error: e });
      setState({ status: await api('/api/admin/status') });
    }
  }, []);
  useEffect(() => { boot(); }, [boot]);
  if (state.error) return <div className="lock-screen"><ErrorCard error={state.error} onRetry={boot} /></div>;
  if (state.loading) return <Loading />;
  return (
    <ToastProvider>
      <ModalProvider>
        {state.me ? <Main me={state.me} reload={boot} /> : <SignIn status={state.status} onDone={boot} />}
      </ModalProvider>
    </ToastProvider>
  );
}

function SignIn({ status, onDone }) {
  const toast = useToast();
  const [mode, setMode] = useState(status.needs_setup ? 'setup' : 'login');
  const [f, setF] = useState({ email: '', password: '', password2: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const bind = (k) => ({ value: f[k], onChange: (e) => setF({ ...f, [k]: e.target.value }) });
  if (mode === 'setup' && !status.local) {
    return (
      <div className="lock-screen"><div className="card card-pad stack" style={{ maxWidth: 460, padding: 32 }}>
        <Brand name="Owner Panel" /><h2>Owner account not set up yet</h2>
        <p className="muted" style={{ margin: 0 }}>For security, the first owner account must be created on the server computer itself (open <b>http://localhost:4000</b> there),
          or with the command <code>node server.js create-admin you@email.com password</code> in the owner-panel folder.</p>
      </div></div>
    );
  }
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'setup') {
        if (f.password !== f.password2) throw new Error('The two passwords do not match.');
        await api('/api/admin/setup', { method: 'POST', body: { email: f.email, password: f.password } });
        await onDone();
        toast('Owner account created. Next: turn on two-step sign-in in "Security & backups".');
        return;
      }
      const r = await api('/api/admin/login', { method: 'POST', body: { email: f.email, password: f.password } });
      if (r.mfa_required) { setMode('2fa'); setBusy(false); return; }
      await onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <div className="lock-screen">
      <div className="card card-pad stack" style={{ width: '100%', maxWidth: 420, padding: 32 }}>
        <Brand name="Owner Panel" />
        {mode === '2fa' ? (
          <><h2 style={{ marginTop: 4 }}>Two-step sign-in</h2><SecondStepForm path="/api/admin/login/2fa" onDone={onDone} onBack={() => setMode('login')} /></>
        ) : (
          <form className="stack" onSubmit={submit} noValidate>
            {mode === 'setup' ? (
              <><h2 style={{ marginTop: 4 }}>Welcome! Create your owner account</h2>
                <p className="muted" style={{ margin: 0 }}>This is a one-time step. You'll use this email and password to approve clinics after their free trial.</p></>
            ) : <p className="muted" style={{ margin: 0 }}>Sign in to manage clinic accounts, AI and backups.</p>}
            {error && <div className="form-error">{error}</div>}
            <Field label="Email"><input type="email" {...bind('email')} autoComplete="username" autoFocus /></Field>
            <Field label={mode === 'setup' ? 'Choose a password' : 'Password'}><input type="password" {...bind('password')} autoComplete={mode === 'setup' ? 'new-password' : 'current-password'} /></Field>
            {mode === 'setup' && <Field label="Repeat password"><input type="password" {...bind('password2')} autoComplete="new-password" /></Field>}
            <button className="btn primary block" style={{ height: 44 }} disabled={busy}>{busy ? 'Please wait…' : mode === 'setup' ? 'Create owner account' : 'Sign in'}</button>
            {mode === 'login' && <p className="small faint" style={{ margin: 0 }}>Forgot your owner password? In the owner-panel folder run:<br /><code>node server.js create-admin your@email.com newpassword</code></p>}
          </form>
        )}
      </div>
    </div>
  );
}

const TABS = [['clinics', 'Clinics', Building2], ['ai', 'AI assistant', Sparkles], ['audit', 'Activity log', Activity],
  ['security', 'Security & backups', ShieldCheck], ['settings', 'Settings', Settings]];

function Main({ me, reload }) {
  const [tab, setTab] = useState(() => {
    const h = window.location.hash.replace('#', '');
    return TABS.some(([k]) => k === h) ? h : 'clinics';
  });
  useEffect(() => { window.location.hash = tab; }, [tab]);
  const s = me.settings;
  return (
    <div className="main" style={{ minHeight: '100%' }}>
      <header className="topbar" style={{ background: 'var(--surface)', position: 'static' }}>
        <Brand name={`${s.product_name} · Owner`} />
        <span className="spacer" />
        <span className="small muted">{me.admin.email}</span>
        <button className="btn sm" onClick={async () => { await api('/api/admin/logout', { method: 'POST' }); window.location.reload(); }}><LogOut /><span>Sign out</span></button>
      </header>
      <nav className="owner-tabs">
        {TABS.map(([k, l, Icon]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><Icon />{l}{k === 'security' && !me.admin.totp_enabled && <span className="badge b-unpaid">!</span>}</button>
        ))}
      </nav>
      <div className="content" style={{ margin: '0 auto', paddingTop: 24 }}>
        {tab === 'clinics' && <Clinics me={me} />}
        {tab === 'ai' && <AiTab me={me} reload={reload} />}
        {tab === 'audit' && <AuditTab />}
        {tab === 'security' && <SecurityTab me={me} reload={reload} />}
        {tab === 'settings' && <SettingsTab me={me} reload={reload} />}
      </div>
    </div>
  );
}
