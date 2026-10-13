import { useState } from 'react';
import { Activity } from 'lucide-react';
import { api, qs } from '../../shared/api';
import { fmtIsoTime } from '../../shared/format';
import { Badge, Loading, Seg, useAsync, useDebounced } from '../../shared/ui';

export default function AuditTab() {
  const [clinic, setClinic] = useState('');
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const da = useDebounced(action, 300);
  const clinics = useAsync(() => api('/api/admin/clinics'), []);
  const { data, loading } = useAsync(() => api(`/api/admin/audit${qs({ clinic_id: clinic, actor, action: da, limit: 300 })}`), [clinic, actor, da]);
  return (
    <>
      <div className="page-head"><div><h1>Activity log</h1><div className="sub">Sign-ins, record views, changes, exports and AI use across all clinics, plus your own owner actions. Kept for 2 years.</div></div></div>
      <div className="card">
        <div className="toolbar">
          <select value={clinic} onChange={(e) => setClinic(e.target.value)} style={{ width: 'auto', maxWidth: 260 }}>
            <option value="">All clinics</option>{(clinics.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <Seg options={[['', 'Everyone'], ['clinic', 'Clinics'], ['owner', 'Owner']]} value={actor} onChange={setActor} />
          <input value={action} onChange={(e) => setAction(e.target.value)} placeholder="Filter action, e.g. login_failed, export, ai" style={{ maxWidth: 280 }} />
        </div>
        {loading && !data ? <Loading minHeight={160} /> : (data || []).length ? data.map((r) => (
          <div className="log-row" key={r.id} style={{ gridTemplateColumns: '150px 1fr auto' }}>
            <span className="muted">{fmtIsoTime(r.at)}</span>
            <span>
              <Badge status={r.actor === 'owner' ? 'trial' : /failed/.test(r.action) ? 'unpaid' : 'scheduled'}>{r.actor}</Badge>{' '}
              <b className={/failed/.test(r.action) ? 'err-text' : ''}>{r.action}</b>
              {r.clinic_name && <span className="muted"> · {r.clinic_name}</span>}
              {r.detail && <span className="muted"> · {r.detail}</span>}
            </span>
            <span className="small faint" title={r.user_agent || ''}>{r.ip || ''}</span>
          </div>
        )) : <div className="card-body"><div className="empty"><Activity /><b>No activity found</b></div></div>}
      </div>
    </>
  );
}
