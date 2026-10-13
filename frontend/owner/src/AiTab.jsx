import { useMemo, useState } from 'react';
import { Bot, Check, Cpu, KeyRound, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { api } from '../../shared/api';
import { usd } from '../../shared/format';
import { Badge, Field, Loading, Switch, useAsync, useToast } from '../../shared/ui';

export default function AiTab({ me, reload }) {
  const toast = useToast();
  const s = me.settings;
  const [key, setKey] = useState('');
  const [f, setF] = useState({ ai_model: s.ai_model, ai_zdr: s.ai_zdr !== '0', ai_hide_names: s.ai_hide_names !== '0',
    ai_default_enabled: s.ai_default_enabled !== '0', ai_default_limit: s.ai_default_limit });
  const [test, setTest] = useState(null);
  const [showModels, setShowModels] = useState(false);
  const [mq, setMq] = useState('');
  const models = useAsync(() => (showModels ? api('/api/admin/ai/models') : Promise.resolve(null)), [showModels]);
  const clinics = useAsync(() => api('/api/admin/clinics'), []);
  const save = async (extra = {}) => {
    try {
      await api('/api/admin/ai', { method: 'PUT', body: { ...f, ...extra } });
      setKey('');
      await reload();
      toast('AI settings saved');
    } catch (err) { toast(err.message, true); }
  };
  const filtered = useMemo(() => (models.data || []).filter((m) => !mq || `${m.id} ${m.name}`.toLowerCase().includes(mq.toLowerCase())).slice(0, 80), [models.data, mq]);
  const usage = (clinics.data || []).filter((c) => c.ai.requests > 0).sort((a, b) => b.ai.used_usd - a.ai.used_usd);
  const total = usage.reduce((t, c) => t + c.ai.used_usd, 0);

  return (
    <>
      <div className="page-head"><div><h1>AI assistant</h1><div className="sub">Clinics use your OpenRouter key. You control which clinics get AI and how much they can spend.</div></div></div>
      <div className="two-col">
        <div className="stack" style={{ gap: 20 }}>
          <div className="card">
            <div className="card-head"><h2><KeyRound />OpenRouter API key</h2><span className="spacer" />
              {s.ai_key_set ? <Badge status="active">Connected {s.ai_key_hint}</Badge> : <Badge status="unpaid">Not set</Badge>}</div>
            <div className="card-body stack">
              <p className="small muted" style={{ margin: 0 }}>Create a key at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">openrouter.ai/keys</a> and add credit there.
                The key is stored encrypted and is never shown to clinics or sent to browsers.</p>
              <div className="row wrap">
                <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={s.ai_key_set ? 'Paste a new key to replace it' : 'sk-or-v1-…'} style={{ flex: 1, minWidth: 220 }} autoComplete="off" />
                <button className="btn primary" disabled={!key.trim()} onClick={() => save({ ai_key: key.trim() })}>Save key</button>
              </div>
              <div className="row wrap">
                <button className="btn sm" disabled={!s.ai_key_set} onClick={async () => {
                  setTest({ busy: true });
                  try { setTest(await api('/api/admin/ai/test', { method: 'POST' })); } catch (err) { setTest({ error: err.message }); }
                }}><Bot /><span>Test connection</span></button>
                {s.ai_key_set && <button className="btn sm danger" onClick={() => save({ clear_key: true })}>Remove key</button>}
                {test && (test.busy ? <span className="small muted">Testing…</span>
                  : test.error ? <span className="small err-text">{test.error}</span>
                    : <span className="small ok-text"><Check size={14} style={{ verticalAlign: -2 }} /> Working: {test.model} replied in {(test.ms / 1000).toFixed(1)}s</span>)}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2><Cpu />Model</h2></div>
            <div className="card-body stack">
              <Field label="Model used for all clinics"><input value={f.ai_model} onChange={(e) => setF({ ...f, ai_model: e.target.value })} /></Field>
              <p className="small muted" style={{ margin: 0 }}>The default, <b>anthropic/claude-sonnet-5.5</b>, is careful with medical text and good at answering data questions.
                Cheaper models work too but may make more mistakes.</p>
              <div><button className="btn sm" onClick={() => setShowModels(!showModels)}><Search /><span>{showModels ? 'Hide models' : 'Browse models & prices'}</span></button></div>
              {showModels && (models.loading ? <Loading minHeight={80} /> : models.error ? <div className="form-error">{models.error.message}</div> : (
                <>
                  <input value={mq} onChange={(e) => setMq(e.target.value)} placeholder="Filter, e.g. claude, gemini, gpt, deepseek" />
                  <div className="model-list">{filtered.map((m) => (
                    <button type="button" key={m.id} className={m.id === f.ai_model ? 'on' : ''} onClick={() => setF({ ...f, ai_model: m.id })}>
                      <span style={{ flex: 1 }}><b>{m.name}</b><div className="small muted">{m.id}</div></span>
                      <span className="small muted nowrap">${m.input_per_m} in / ${m.output_per_m} out<br />per 1M tokens</span>
                    </button>
                  ))}</div>
                </>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2><ShieldCheck />Privacy & limits</h2></div>
            <div className="card-body stack">
              <Switch checked={f.ai_hide_names} onChange={(v) => setF({ ...f, ai_hide_names: v })}>Hide patient names from the AI (replace them with codes)</Switch>
              <Switch checked={f.ai_zdr} onChange={(v) => setF({ ...f, ai_zdr: v })}>Only use providers with zero data retention</Switch>
              <p className="small muted" style={{ margin: '-6px 0 0 48px' }}>Phone numbers, emails, addresses and insurance details are never sent. Requests always go only to providers that don't train on or store prompts.
                Turn off zero data retention only if your chosen model isn't available with it.</p>
              <Switch checked={f.ai_default_enabled} onChange={(v) => setF({ ...f, ai_default_enabled: v })}>Give new and existing clinics AI by default</Switch>
              <Field label="Default monthly limit per clinic (USD)"><input type="number" min="0" step="0.5" value={f.ai_default_limit} style={{ maxWidth: 180 }}
                onChange={(e) => setF({ ...f, ai_default_limit: e.target.value })} /></Field>
              <div><button className="btn primary" onClick={() => save()}>Save settings</button></div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2><Sparkles />Usage this month</h2><span className="spacer" /><b>{usd(total)}</b></div>
          {clinics.loading && !clinics.data ? <Loading minHeight={100} /> : usage.length ? (
            <table className="t"><thead><tr><th>Clinic</th><th className="right">Requests</th><th className="right">Cost</th></tr></thead>
              <tbody>{usage.map((c) => (
                <tr key={c.id}><td><b>{c.name}</b><div className="small muted">limit {usd(c.ai.limit_usd)}{!c.ai.enabled && ' · off'}</div></td>
                  <td className="right">{c.ai.requests}</td><td className="right mono">{usd(c.ai.used_usd)}</td></tr>
              ))}</tbody></table>
          ) : <div className="card-body muted">No AI use yet this month.</div>}
        </div>
      </div>
    </>
  );
}
