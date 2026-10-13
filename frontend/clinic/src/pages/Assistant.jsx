import { useEffect, useRef, useState } from 'react';
import { Bot, Lock, Send, ShieldCheck, Sparkles, Trash2, User } from 'lucide-react';
import { api } from '../../../shared/api';
import { usd } from '../../../shared/format';
import Markdown from '../../../shared/Markdown';
import { Empty, PageHead } from '../../../shared/ui';
import { useApp } from '../context';
import Contact from '../components/Contact';

// Kept in memory only (not saved anywhere): cleared when the page is reloaded.
let memory = [];

const SUGGESTIONS = [
  'How many appointments did we have this month, and how many were no-shows?',
  'Which patients owe us money? Show a table with balances.',
  'What was our income and profit last month compared to the month before?',
  'Which patients are allergic to penicillin?',
  'Who are our top 10 patients by number of visits this year?',
  'Which services earned the most this year?',
];

export default function Assistant() {
  const { me, aiOn } = useApp();
  const [msgs, setMsgs] = useState(memory);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState(me.ai);
  const log = useRef(null);
  useEffect(() => { memory = msgs; if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [msgs, busy]);

  if (!me.ai.enabled) {
    return (
      <>
        <PageHead title="AI assistant" />
        <div className="card card-pad"><Empty icon={Lock} title="The AI assistant isn't switched on for your account" text="Please contact support to enable it."><div style={{ marginTop: 14 }}><Contact product={me.product} center /></div></Empty></div>
      </>
    );
  }

  const ask = async (q) => {
    const question = (q ?? text).trim();
    if (!question || busy) return;
    const history = [...msgs.filter((m) => !m.error), { role: 'user', content: question }];
    setMsgs([...msgs, { role: 'user', content: question }]);
    setText('');
    setBusy(true);
    try {
      const r = await api('/api/ai/chat', { method: 'POST', body: { messages: history.map(({ role, content }) => ({ role, content })) } });
      setMsgs((m) => [...m, { role: 'assistant', content: r.answer, queries: r.queries }]);
      if (r.usage) setUsage(r.usage);
    } catch (err) {
      setMsgs((m) => [...m, { role: 'assistant', content: err.message, error: true }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead title="AI assistant" sub={<>Ask anything about your clinic's own data · <span className="small">{usd(usage.used_usd)} of {usd(usage.limit_usd)} used this month</span></>}>
        {msgs.length > 0 && <button className="btn" onClick={() => setMsgs([])}><Trash2 /><span>New chat</span></button>}
      </PageHead>
      <div className="card chat">
        <div className="chat-log" ref={log}>
          {msgs.length === 0 && (
            <div className="chat-empty">
              <span className="big"><Sparkles /></span>
              <h2 style={{ color: 'var(--text)' }}>What would you like to know?</h2>
              <div>I can look up appointments, patients, clinical notes, documents, invoices, payments and expenses for <b>{me.clinic.name}</b>, and answer in plain English.</div>
              <div className="suggestions">{SUGGESTIONS.map((s) => <button key={s} onClick={() => ask(s)} disabled={!aiOn}>{s}</button>)}</div>
              <div className="small faint" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><ShieldCheck size={15} />
                Read-only. {usage.hide_names ? 'Patient names are replaced by codes and ' : ''}contact details are never sent to the AI.</div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <span className="who-ico">{m.role === 'user' ? <User /> : <Bot />}</span>
              <div className={`bubble${m.error ? ' error' : ''}`}>
                {m.role === 'user' || m.error ? m.content : <Markdown text={m.content} />}
                {m.queries && m.queries.length > 0 && (
                  <details className="query-list"><summary>How I found this ({m.queries.length} lookup{m.queries.length === 1 ? '' : 's'})</summary>
                    {m.queries.map((qq, j) => <pre key={j}>{qq.query}{qq.error ? `\n→ ${qq.error}` : `\n→ ${qq.rows} row${qq.rows === 1 ? '' : 's'}`}</pre>)}
                  </details>
                )}
              </div>
            </div>
          ))}
          {busy && <div className="msg assistant"><span className="who-ico"><Bot /></span><div className="bubble"><span className="typing"><i /><i /><i /></span></div></div>}
        </div>
        <form className="chat-input" onSubmit={(e) => { e.preventDefault(); ask(); }}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={aiOn ? 'Ask a question… (Enter to send, Shift+Enter for a new line)' : 'AI is available during your trial or subscription'}
            disabled={!aiOn} rows={1} maxLength={4000}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }} />
          <button className="btn primary" disabled={!aiOn || busy || !text.trim()} style={{ height: 46 }}><Send /><span>Send</span></button>
        </form>
      </div>
      <p className="small faint">AI answers can be wrong. Check important figures in the app, and use clinical judgement for any medical information.</p>
    </>
  );
}
