// Reusable UI building blocks: modals, confirm dialogs, toasts, badges, forms.
import { createContext, Fragment, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, Check, X } from 'lucide-react';

// ---------------------------------------------------------------- toasts

const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const toast = useCallback((message, isError = false) => {
    const id = Math.random();
    setItems((s) => [...s, { id, message, isError }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), isError ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast${t.isError ? ' err' : ''}`}>{t.isError ? <AlertTriangle /> : <Check />}<span>{t.message}</span></div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------------------------------------------------------------- modals

const ModalCtx = createContext(() => () => {});
let modalSeq = 0;
const openStack = [];   // ids of open modals; only the top one reacts to Escape

export function ModalProvider({ children }) {
  const [stack, setStack] = useState([]);
  const open = useCallback((render) => {
    const id = ++modalSeq;
    const close = () => setStack((s) => s.filter((m) => m.id !== id));
    setStack((s) => [...s, { id, render, close }]);
    return close;
  }, []);
  return (
    <ModalCtx.Provider value={open}>
      {children}
      {stack.map((m) => <Fragment key={m.id}>{m.render(m.close)}</Fragment>)}
    </ModalCtx.Provider>
  );
}
export const useModal = () => useContext(ModalCtx);

export function Modal({ title, wide, onClose, onSubmit, submitLabel = 'Save', hideSubmit, footLeft, children, maxWidth, submitDisabled }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bodyRef = useRef(null);
  const idRef = useRef(++modalSeq);
  useEffect(() => {
    const id = idRef.current;
    openStack.push(id);
    const onKey = (e) => { if (e.key === 'Escape' && openStack[openStack.length - 1] === id && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); openStack.splice(openStack.indexOf(id), 1); };
  }, [onClose, busy]);
  useEffect(() => {
    const first = bodyRef.current && bodyRef.current.querySelector('input:not([type=hidden]):not([readonly]):not([type=checkbox]), select, textarea');
    if (first) setTimeout(() => first.focus(), 30);
  }, []);
  const submit = async (e) => {
    e.preventDefault();
    if (!onSubmit) return onClose();
    setBusy(true);
    setError('');
    try {
      const keepOpen = await onSubmit();
      if (keepOpen !== true) onClose();
    } catch (err) {
      setError(err.message);
      if (bodyRef.current) bodyRef.current.scrollTop = 0;
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-back">
      <form className={`modal${wide ? ' wide' : ''}`} style={maxWidth ? { maxWidth } : undefined} onSubmit={submit} noValidate>
        <div className="modal-head"><h2>{title}</h2><span className="spacer" />
          <button type="button" className="btn ghost icon" onClick={onClose} aria-label="Close"><X /></button></div>
        <div className="modal-body" ref={bodyRef}>
          {error && <div className="form-error" style={{ marginBottom: 14 }}>{error}</div>}
          {children}
        </div>
        <div className="modal-foot">
          {footLeft}<span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>{hideSubmit ? 'Close' : 'Cancel'}</button>
          {!hideSubmit && <button type="submit" className="btn primary" disabled={busy || submitDisabled}>{busy ? 'Please wait…' : submitLabel}</button>}
        </div>
      </form>
    </div>
  );
}

export function useConfirm() {
  const open = useModal();
  return useCallback((message, { okLabel = 'Delete', danger = true, title = 'Are you sure?' } = {}) => new Promise((resolve) => {
    open((close) => {
      const done = (v) => { close(); resolve(v); };
      return (
        <Modal title={title} onClose={() => done(false)} onSubmit={() => done(true) || true} submitLabel={okLabel} maxWidth={440}>
          <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
            <span className={`stat`} style={{ padding: 0 }}><span className={`ico ${danger ? 'tone-red' : 'tone-teal'}`}>{danger ? <AlertTriangle /> : <Check />}</span></span>
            <p className="muted" style={{ margin: '8px 0 0' }}>{message}</p>
          </div>
        </Modal>
      );
    });
  }), [open]);
}

// ---------------------------------------------------------------- data loading

export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ loading: true, data: undefined, error: null });
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve().then(fn).then(
      (data) => alive && setState({ data, loading: false, error: null }),
      (error) => alive && setState((s) => ({ ...s, loading: false, error })),
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { ...state, reload: () => setN((x) => x + 1), setData: (data) => setState((s) => ({ ...s, data })) };
}

export function useForm(initial) {
  const [f, setF] = useState(initial);
  const bind = (k) => ({ name: k, value: f[k] ?? '', onChange: (e) => setF((s) => ({ ...s, [k]: e.target.value })) });
  const check = (k) => ({ name: k, checked: !!f[k], onChange: (e) => setF((s) => ({ ...s, [k]: e.target.checked })) });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  return { f, setF, bind, check, set };
}

export function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

// ---------------------------------------------------------------- small components

export const Brand = ({ name }) => (
  <div className="brand"><span className="brand-mark"><Activity /></span><span>{name}</span></div>
);

export const Spinner = () => <div className="spinner" aria-label="Loading" />;
export const Loading = ({ minHeight }) => <div className="loading" style={minHeight ? { minHeight } : undefined}><Spinner /></div>;

export function Empty({ icon: Icon, title, text, children }) {
  return <div className="empty">{Icon && <Icon />}<b>{title}</b>{text}{children}</div>;
}

export function ErrorCard({ error, onRetry }) {
  return (
    <div className="card card-pad">
      <Empty icon={AlertTriangle} title="Could not load this page" text={error && error.message}>
        {onRetry && <div style={{ marginTop: 12 }}><button className="btn" onClick={onRetry}>Try again</button></div>}
      </Empty>
    </div>
  );
}

export const Badge = ({ status, children }) => <span className={`badge b-${status}`}>{children}</span>;

export function Stat({ icon: Icon, tone, label, value, hint }) {
  return (
    <div className="card stat">
      <span className={`ico tone-${tone}`}><Icon /></span>
      <div><div className="lbl">{label}</div><div className="val">{value}</div>{hint && <div className="hint">{hint}</div>}</div>
    </div>
  );
}

export function PageHead({ title, sub, children }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{sub && <div className="sub">{sub}</div>}</div>
      <span className="spacer" />
      {children && <div className="row wrap">{children}</div>}
    </div>
  );
}

export function Seg({ options, value, onChange }) {
  return (
    <div className="seg">
      {options.map(([k, l]) => <button type="button" key={k} className={k === value ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>)}
    </div>
  );
}

export const Field = ({ label, className = '', children }) => <label className={`f ${className}`}>{label}{children}</label>;

export const Switch = ({ checked, onChange, children, disabled }) => (
  <label className="switch"><input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />{children}</label>
);

export function Progress({ pct, label }) {
  return (
    <div className="ocr-prog">
      <div className="row small"><span>{label}</span><span className="spacer" /><b>{pct}%</b></div>
      <div className="track"><div className="fill" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
