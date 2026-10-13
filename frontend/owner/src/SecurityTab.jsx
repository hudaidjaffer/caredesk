import { useState } from 'react';
import { AlertTriangle, Database, Download, Eye, KeyRound, Lock } from 'lucide-react';
import { api } from '../../shared/api';
import { downloadText, fmtIsoTime, fmtSize, timeAgo } from '../../shared/format';
import { SessionsCard, TwoFactorCard } from '../../shared/Security';
import { Field, Loading, Modal, useAsync, useModal, useToast } from '../../shared/ui';

function KeyModal({ close, twoFactor }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [result, setResult] = useState(null);
  return (
    <Modal title="Encryption recovery key" onClose={close} submitLabel={result ? 'Done' : 'Show key'} onSubmit={async () => {
      if (result) return false;
      setResult(await api('/api/admin/encryption-key', { method: 'POST', body: { password, code } }));
      return true;
    }}>
      {result ? (
        <div className="stack">
          <div className="banner expired" style={{ margin: 0 }}><AlertTriangle /><span>Keep this key <b>offline and private</b> (printed, or in a password manager).
            Anyone with this key and a copy of your data can read it. Without it, encrypted data and backups <b>cannot be recovered</b>.</span></div>
          <div className="secret-code">{result.key}</div>
          <div className="small muted">Stored on the server in: {result.file}</div>
          <div><button type="button" className="btn sm" onClick={() => downloadText('caredesk-encryption-key.txt', `CareDesk encryption key\nKeep offline. Needed to restore encrypted data and backups.\n\n${result.key}\n`)}><Download /><span>Download</span></button></div>
        </div>
      ) : (
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>Patient medical data, documents and backups are encrypted with this key. Save a copy somewhere safe, away from the server,
            so you can recover your data if the server is lost.</p>
          <Field label="Your owner password"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
          {twoFactor && <Field label="6-digit code (or recovery code)"><input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" /></Field>}
        </div>
      )}
    </Modal>
  );
}

export default function SecurityTab({ me, reload }) {
  const toast = useToast();
  const open = useModal();
  const backups = useAsync(() => api('/api/admin/backups'), []);
  const [pw, setPw] = useState({ current: '', password: '' });
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div className="page-head"><div><h1>Security & backups</h1><div className="sub">Protect the owner account and your clinics' data.</div></div></div>
      <div className="halves">
        <div className="stack" style={{ gap: 20 }}>
          <TwoFactorCard base="/api/admin/account" enabled={me.admin.totp_enabled} recoveryLeft={me.admin.recovery_codes_left} productName={`${me.settings.product_name} Owner`}
            onChange={reload} canDisable={!me.online} recommendText="Strongly recommended for the owner account: it controls every clinic's access and the encryption key." />
          <form className="card" onSubmit={async (e) => {
            e.preventDefault();
            try { await api('/api/admin/password', { method: 'PUT', body: pw }); setPw({ current: '', password: '' }); toast('Owner password changed'); } catch (err) { toast(err.message, true); }
          }}>
            <div className="card-head"><h2><KeyRound />Owner password</h2></div>
            <div className="card-body stack">
              <Field label="Current password"><input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" /></Field>
              <Field label="New password"><input type="password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} autoComplete="new-password" /></Field>
              <div><button className="btn">Change password</button></div>
            </div>
          </form>
          <SessionsCard listPath="/api/admin/account/sessions" />
        </div>
        <div className="stack" style={{ gap: 20 }}>
          <div className="card">
            <div className="card-head"><h2><Database />Backups</h2><span className="spacer" />
              <button className="btn sm primary" disabled={busy} onClick={async () => {
                setBusy(true);
                try { const r = await api('/api/admin/backups', { method: 'POST' }); toast(`Backup saved: ${r.file}`); backups.reload(); } catch (err) { toast(err.message, true); } finally { setBusy(false); }
              }}>{busy ? 'Backing up…' : 'Back up now'}</button></div>
            <div className="card-body small muted stack" style={{ paddingBottom: 0, gap: 6 }}>
              <div><b>Database:</b> Supabase (schema <code>{me.schema}</code>) · <b>Photos &amp; files:</b> {me.storage}</div>
              {me.online ? (
                <div>A full encrypted copy of the database is made automatically every day and kept in your private Supabase Storage bucket (last 30).
                  Last backup: {me.last_backup_at ? timeAgo(me.last_backup_at) : 'never'}.</div>
              ) : (
                <div>A full encrypted copy of the database is made automatically every day (last 14 kept) in <code>{me.data_dir}\backups</code>
                  {/Supabase/.test(me.storage) ? ' and in your private Supabase Storage bucket' : ''}. Last backup: {me.last_backup_at ? timeAgo(me.last_backup_at) : 'never'}.</div>
              )}
              <div>To restore one: download it, then on your PC in the owner-panel folder run <code>node server.js restore-backup &lt;file&gt; --yes</code>.</div>
            </div>
            {backups.loading && !backups.data ? <Loading minHeight={80} /> : (
              <table className="t" style={{ marginTop: 10 }}><tbody>{(backups.data || []).map((b) => (
                <tr key={b.file}><td><b>{fmtIsoTime(b.created_at)}</b><div className="small muted">{b.file}</div></td><td className="right small muted">{fmtSize(b.size)}</td>
                  <td className="right"><a className="btn sm" href={`/api/admin/backups/${b.file}`} download><Download /><span>Download</span></a></td></tr>
              ))}</tbody></table>
            )}
          </div>
          <div className="card">
            <div className="card-head"><h2><Lock />Encryption key</h2></div>
            <div className="card-body stack">
              <p className="small muted" style={{ margin: 0 }}>Medical details, notes, document text, uploaded photos and backups are encrypted (AES-256-GCM). The key lives in
                <code> secret.key</code> in the data folder on your PC. <b>Save a copy offline</b>: if it is lost, backups can't be restored without it.</p>
              {me.online
                ? <p className="small" style={{ margin: 0 }}><Lock size={14} style={{ verticalAlign: -2 }} /> For safety, the key is never shown in the online owner panel. To view or save it, open the owner panel on your PC.</p>
                : <div><button className="btn" onClick={() => open((close) => <KeyModal close={close} twoFactor={me.admin.totp_enabled} />)}><Eye /><span>Show recovery key</span></button></div>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
