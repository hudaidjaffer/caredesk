import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3, CalendarDays, Check, ClipboardList, Clock, FileText, LayoutDashboard, Lock, LogOut, Mail, Menu,
  Plus, Receipt, Settings, ShieldCheck, Sparkles, Star, Stethoscope, Users, Wallet,
} from 'lucide-react';
import { api } from '../../shared/api';
import { initials, moneyFormatter } from '../../shared/format';
import { Badge, Brand, ErrorCard, Field, Loading, ModalProvider, ToastProvider, useModal, useToast } from '../../shared/ui';
import { SecondStepForm } from '../../shared/Security';
import useHashRoute from '../../shared/useHashRoute';
import { AppCtx, CLINIC_TYPES, go, useApp } from './context';
import Dashboard from './pages/Dashboard';
import Appointments from './pages/Appointments';
import Patients from './pages/Patients';
import PatientProfile from './pages/PatientProfile';
import Notes from './pages/Notes';
import Documents from './pages/Documents';
import Assistant from './pages/Assistant';
import Billing from './pages/Billing';
import InvoiceView from './pages/InvoiceView';
import Expenses from './pages/Expenses';
import Reports from './pages/Reports';
import Setup from './pages/Setup';
import SettingsPage from './pages/Settings';
import AppointmentModal from './components/AppointmentModal';
import Contact from './components/Contact';

export default function App() {
  const [pub, setPub] = useState(null);
  const [me, setMe] = useState(undefined);         // undefined = loading, null = signed out
  const [refs, setRefs] = useState({ practitioners: [], services: [] });
  const [error, setError] = useState(null);
  const [linkError, setLinkError] = useState('');

  const loadRefs = useCallback(async () => {
    const [practitioners, services] = await Promise.all([api('/api/practitioners'), api('/api/services')]);
    setRefs({ practitioners, services });
  }, []);

  const boot = useCallback(async () => {
    setError(null);
    try {
      const p = await api('/api/public-settings').catch(() => ({ product_name: 'CareDesk', trial_days: 7 }));
      setPub(p);
      document.title = `${p.product_name} · Clinic Management`;
      // opened from the "Confirm my email" link in the sign-up email
      const link = window.location.hash.match(/^#\/verify-email\/([\w-]{20,})$/);
      if (link) {
        window.history.replaceState(null, '', '#/dashboard');   // the link works only once; don't keep it in the address bar
        try {
          await api('/api/auth/register/verify', { method: 'POST', body: { token: link[1] } });
          sessionStorage.setItem('cd_welcome', '1');
        } catch (e) {
          setLinkError(e.message);
        }
      }
      let m;
      try { m = await api('/api/me'); } catch (e) { if (e.status === 401) { setMe(null); return; } throw e; }
      if (m.access.can_read) {
        try { await loadRefs(); } catch (e) { if (e.status !== 403) throw e; }
      }
      setMe(m);
    } catch (e) {
      setError(e);
    }
  }, [loadRefs]);

  useEffect(() => { boot(); }, [boot]);

  if (error) return <div className="lock-screen"><ErrorCard error={error} onRetry={boot} /></div>;
  if (me === undefined || !pub) return <Loading />;
  return (
    <ToastProvider>
      {me === null ? <Auth pub={pub} onSignedIn={boot} linkError={linkError} />
        : !me.access.can_read ? <Locked me={me} />
          : <Main me={me} setMe={setMe} refs={refs} loadRefs={loadRefs} boot={boot} />}
    </ToastProvider>
  );
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  window.location.hash = '';
  window.location.reload();
}

// ---------------------------------------------------------------- sign in / register

function Auth({ pub, onSignedIn, linkError }) {
  const toast = useToast();
  const [mode, setMode] = useState(linkError ? 'login' : 'register');
  const [f, setF] = useState({ clinic_type: 'dental' });
  const [error, setError] = useState(linkError || '');
  const [busy, setBusy] = useState(false);
  const bind = (k) => ({ value: f[k] || '', onChange: (e) => setF({ ...f, [k]: e.target.value }) });
  const submit = async (e) => {
    e.preventDefault();
    if (mode === 'register' && (f.password || '').length < 8) { setError('Password must be at least 8 characters.'); return; }
    setBusy(true);
    setError('');
    try {
      const r = await api(mode === 'register' ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body: f });
      if (r.mfa_required) { setMode('2fa'); setBusy(false); return; }
      if (r.verify) { setMode('verify'); setBusy(false); return; }
      window.location.hash = '#/dashboard';
      await onSignedIn();
      if (mode === 'register') toast('Welcome! Your free trial has started.');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  const features = ['Smart appointment calendar for your whole team', 'Patient records with medical history and allergy alerts',
    'Structured SOAP notes, with an AI writing assistant', 'Photo uploads with automatic text reading',
    'Invoices, payments, expenses and Excel reports'];
  return (
    <div className="auth">
      <section className="auth-hero">
        <Brand name={pub.product_name} />
        <h1>The calm, organised way to run your clinic.</h1>
        <p className="lead">Appointments, patient records, clinical notes and billing in one secure place, built for dental, therapy and medical practices.</p>
        <ul>{features.map((t) => <li key={t}><span className="tick"><Check /></span>{t}</li>)}</ul>
        <div className="foot"><ShieldCheck style={{ verticalAlign: -4, marginRight: 6 }} />Medical records are encrypted, every access is logged, and two-step sign-in is available.</div>
      </section>
      <section className="auth-panel"><div className="auth-card">
        {mode === 'verify' ? (
          <VerifyEmail email={f.email.trim().toLowerCase()} onBack={() => { setMode('register'); setError(''); }} onDone={async () => {
            window.location.hash = '#/dashboard';
            await onSignedIn();
            toast('Email confirmed. Welcome! Your free trial has started.');
          }} />
        ) : mode === '2fa' ? (
          <>
            <h2><Lock style={{ verticalAlign: -3, marginRight: 8, color: 'var(--primary)' }} />Two-step sign-in</h2>
            <div style={{ height: 14 }} />
            <SecondStepForm path="/api/auth/login/2fa" onBack={() => setMode('login')} onDone={async (r) => {
              window.location.hash = '#/dashboard';
              await onSignedIn();
              if (r.recovery_codes_left !== undefined) toast(`Recovery code used. ${r.recovery_codes_left} left. Create new ones in Settings.`, r.recovery_codes_left < 3);
            }} />
          </>
        ) : (
          <>
            <span className="trial-pill"><Star size={15} /> {pub.trial_days}-day free trial · unlimited use</span>
            <h2 style={{ marginTop: 16 }}>{mode === 'register' ? 'Start your free trial' : 'Welcome back'}</h2>
            <p className="muted" style={{ margin: 0 }}>{mode === 'register' ? `Full access to every feature for ${pub.trial_days} days.` : 'Sign in to your clinic account.'}</p>
            <div className="tabs">
              <button type="button" className={mode === 'register' ? 'on' : ''} onClick={() => { setMode('register'); setError(''); }}>Create account</button>
              <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => { setMode('login'); setError(''); }}>Sign in</button>
            </div>
            <form className="stack" onSubmit={submit} noValidate>
              {error && <div className="form-error">{error}</div>}
              {mode === 'register' && (
                <>
                  <Field label="Clinic name"><input {...bind('clinic_name')} placeholder="e.g. Bright Smile Dental" autoComplete="organization" /></Field>
                  <Field label="Type of practice"><select {...bind('clinic_type')}>{Object.entries(CLINIC_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                  <div className="grid2">
                    <Field label="Your name"><input {...bind('owner_name')} placeholder="Dr. Sarah Khan" autoComplete="name" /></Field>
                    <Field label="Phone"><input {...bind('phone')} type="tel" autoComplete="tel" /></Field>
                  </div>
                </>
              )}
              <Field label="Email"><input {...bind('email')} type="email" autoComplete="email" placeholder={mode === 'register' ? 'you@clinic.com' : ''} /></Field>
              <Field label="Password"><input {...bind('password')} type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                placeholder={mode === 'register' ? 'At least 8 characters' : ''} /></Field>
              <button className="btn primary block" style={{ height: 44 }} disabled={busy}>{busy ? 'Please wait…' : mode === 'register' ? 'Start free trial' : 'Sign in'}</button>
              {mode === 'register'
                ? <p className="small faint" style={{ margin: 0, textAlign: 'center' }}>No credit card needed. Unlimited patients and records.</p>
                : (pub.support_email || pub.support_phone) && <p className="small muted" style={{ margin: 0 }}>Forgot your password? Contact {pub.support_email || pub.support_phone}.</p>}
            </form>
          </>
        )}
      </div></section>
    </div>
  );
}

// Step 2 of sign-up: type the 6-digit code from the email (or click the link in it).
function VerifyEmail({ email, onBack, onDone }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(60);
  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setInfo('');
    try {
      await api('/api/auth/register/verify', { method: 'POST', body: { email, code } });
      await onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  const resend = async () => {
    setError('');
    setInfo('');
    try {
      await api('/api/auth/register/resend', { method: 'POST', body: { email } });
      setInfo('A new code is on its way. Older codes no longer work.');
      setCode('');
      setWait(60);
    } catch (err) { setError(err.message); }
  };
  return (
    <>
      <h2><Mail style={{ verticalAlign: -3, marginRight: 8, color: 'var(--primary)' }} />Check your email</h2>
      <p className="muted">We sent a 6-digit code to <b>{email}</b>. Type it below, or click the <b>Confirm my email</b> button in the email.
        It can take a minute; check your spam folder too.</p>
      <form className="stack" onSubmit={submit} noValidate>
        {error && <div className="form-error">{error}</div>}
        {info && <div className="banner trial" style={{ margin: 0 }}><span>{info}</span></div>}
        <input className="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} autoFocus
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="000000" />
        <button className="btn primary block" style={{ height: 44 }} disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Confirm & start free trial'}</button>
        <div className="row small" style={{ justifyContent: 'space-between' }}>
          <button type="button" className="link-btn" disabled={wait > 0} onClick={resend}>{wait > 0 ? `Send a new code (${wait}s)` : 'Send a new code'}</button>
          <button type="button" className="link-btn" onClick={onBack}>Wrong email? Go back</button>
        </div>
      </form>
    </>
  );
}

function Locked({ me }) {
  const suspended = me.access.status === 'suspended';
  return (
    <div className="lock-screen">
      <div className="card card-pad" style={{ maxWidth: 480, textAlign: 'center', padding: 36 }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}><Brand name={me.product.name} /></div>
        <div className="stat" style={{ justifyContent: 'center', padding: 0 }}><span className="ico tone-red"><Lock /></span></div>
        <h1 style={{ margin: '14px 0 8px' }}>{suspended ? 'Account suspended' : 'Your free trial has ended'}</h1>
        <p className="muted">Your records for <b>{me.clinic.name}</b> are stored safely. Please contact us to activate your account and continue.</p>
        <Contact product={me.product} center />
        <button className="btn" style={{ marginTop: 22 }} onClick={logout}><LogOut /><span>Sign out</span></button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- signed-in shell

const NAV = [
  ['Clinic', [['dashboard', 'Dashboard', LayoutDashboard], ['appointments', 'Appointments', CalendarDays], ['patients', 'Patients', Users],
    ['notes', 'Clinical notes', ClipboardList], ['documents', 'Documents', FileText], ['assistant', 'AI assistant', Sparkles]]],
  ['Finance', [['billing', 'Billing', Receipt], ['expenses', 'Expenses', Wallet], ['reports', 'Reports', BarChart3]]],
  ['Manage', [['setup', 'Services & team', Stethoscope], ['settings', 'Settings', Settings]]],
];

const PAGES = {
  dashboard: Dashboard, appointments: Appointments, patients: Patients, notes: Notes, documents: Documents, assistant: Assistant,
  billing: Billing, invoice: InvoiceView, expenses: Expenses, reports: Reports, setup: Setup, settings: SettingsPage,
};

function Main({ me, setMe, refs, loadRefs, boot }) {
  const [version, setVersion] = useState(0);
  const value = useMemo(() => ({
    me, refs, loadRefs,
    canWrite: me.access.can_write,
    aiOn: me.ai.enabled && me.access.can_write,
    money: moneyFormatter(me.clinic.currency),
    refresh: () => setVersion((v) => v + 1),
    version,
    reloadMe: async () => setMe(await api('/api/me')),
    boot,
  }), [me, refs, loadRefs, version, setMe, boot]);
  return (
    <AppCtx.Provider value={value}>
      <ModalProvider><Shell /></ModalProvider>
    </AppCtx.Provider>
  );
}

function Banner() {
  const { me } = useApp();
  const a = me.access;
  const p = me.product;
  const contact = [p.support_email, p.support_phone].filter(Boolean).join(' · ');
  if (a.status === 'trial') {
    return <div className="banner trial"><Star /><span><b>Free trial: {a.days_left} day{a.days_left === 1 ? '' : 's'} left.</b> Enjoy unlimited access to every feature.{contact && ` To activate, contact ${contact}.`}</span></div>;
  }
  if (a.status === 'expired') {
    return <div className="banner expired"><Lock /><span><b>Your access has ended.</b> Your records are safe and you can still view and export them. To add or edit records again, please contact {contact || 'support'} to activate.</span></div>;
  }
  if (a.status === 'active' && !a.lifetime && a.days_left <= 7) {
    return <div className="banner trial"><Clock /><span>Your subscription ends in <b>{a.days_left} day{a.days_left === 1 ? '' : 's'}</b>.{contact && ` Contact ${contact} to renew.`}</span></div>;
  }
  return null;
}

function StatusChip() {
  const { me } = useApp();
  const a = me.access;
  if (a.status === 'trial') return <Badge status="trial">Trial · {a.days_left}d left</Badge>;
  if (a.status === 'active') return <Badge status="active">{a.lifetime ? 'Active' : `Active · ${a.days_left}d`}</Badge>;
  return <Badge status="expired">Read-only</Badge>;
}

function Shell() {
  const { me, canWrite, aiOn } = useApp();
  const open = useModal();
  const route = useHashRoute();
  const [menuOpen, setMenuOpen] = useState(false);
  const toast = useToast();
  useEffect(() => {
    try {
      if (sessionStorage.getItem('cd_welcome')) { sessionStorage.removeItem('cd_welcome'); toast('Email confirmed. Welcome! Your free trial has started.'); }
    } catch { /* storage blocked */ }
  }, [toast]);
  const page = PAGES[route.page] ? route.page : 'dashboard';
  const navKey = page === 'invoice' ? 'billing' : page;
  const Page = page === 'patients' && route.id ? PatientProfile : PAGES[page];
  useEffect(() => { setMenuOpen(false); }, [route.page, route.id]);
  const c = me.clinic;
  return (
    <div className="shell">
      <aside className={`sidebar${menuOpen ? ' open' : ''}`}>
        <Brand name={me.product.name} />
        <nav className="nav">
          {NAV.map(([label, items]) => (
            <div key={label}>
              <div className="nav-label">{label}</div>
              {items.filter(([k]) => k !== 'assistant' || me.ai.enabled).map(([k, l, Icon]) => (
                <a key={k} href={`#/${k}`} className={navKey === k ? 'on' : ''}><Icon /><span>{l}</span>{k === 'assistant' && <span className="pill ai">AI</span>}</a>
              ))}
            </div>
          ))}
        </nav>
        <div className="me">
          <div className="avatar">{initials(c.name)}</div>
          <div className="who"><b>{c.name}</b><span>{c.email}</span></div>
          <button className="btn ghost icon" title="Sign out" onClick={logout}><LogOut /></button>
        </div>
      </aside>
      {menuOpen && <div style={{ position: 'fixed', inset: 0, zIndex: 25 }} onClick={() => setMenuOpen(false)} />}
      <div className="main">
        <header className="topbar">
          <button className="btn ghost icon menu-btn" aria-label="Menu" onClick={() => setMenuOpen(!menuOpen)}><Menu /></button>
          <span className="spacer" />
          {aiOn && page !== 'assistant' && <button className="btn sm ghost" onClick={() => go('#/assistant')}><Sparkles /><span>Ask AI</span></button>}
          <StatusChip />
          {canWrite && <button className="btn primary sm" onClick={() => open((close) => <AppointmentModal close={close} />)}><Plus /><span>Appointment</span></button>}
        </header>
        <main className="content">
          <Banner />
          <Page key={`${page}:${route.id || ''}`} id={route.id} />
        </main>
      </div>
    </div>
  );
}
