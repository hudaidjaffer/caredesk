import { useState } from 'react';
import { Download, FileSpreadsheet, Plus, Search, Users } from 'lucide-react';
import { api, qs } from '../../../shared/api';
import { age, fmtDate, fullName, initials } from '../../../shared/format';
import { Empty, ErrorCard, Loading, PageHead, useAsync, useDebounced, useModal } from '../../../shared/ui';
import { go, useApp } from '../context';
import PatientModal from '../components/PatientModal';
import ImportModal from '../components/ImportModal';

export default function Patients() {
  const { money, canWrite, version } = useApp();
  const open = useModal();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 200);
  const { data: list, error, loading, reload } = useAsync(() => api(`/api/patients${qs({ q: dq })}`), [dq, version]);
  if (error) return <ErrorCard error={error} onRetry={reload} />;
  return (
    <>
      <PageHead title="Patients" sub="Everyone registered with your clinic">
        <a className="btn" href="/api/export/patients.xlsx" download><Download /><span>Excel</span></a>
        <button className="btn" disabled={!canWrite} onClick={() => open((c) => <ImportModal close={c} />)}><FileSpreadsheet /><span>Import</span></button>
        <button className="btn primary" disabled={!canWrite} onClick={() => open((c) => <PatientModal close={c} />)}><Plus /><span>New patient</span></button>
      </PageHead>
      <div className="card">
        <div className="toolbar">
          <div className="search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, phone or email…" /></div>
          <span className="spacer" /><span className="muted small">{list ? `${list.length} patient${list.length === 1 ? '' : 's'}` : ''}</span>
        </div>
        {loading && !list ? <Loading minHeight={200} /> : list.length ? (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Patient</th><th>Phone</th><th>Age</th><th>Last visit</th><th className="right">Balance</th></tr></thead>
            <tbody>{list.map((p) => (
              <tr key={p.id} className="click" onClick={() => go(`#/patients/${p.id}`)}>
                <td><div className="row"><div className="avatar">{initials(fullName(p))}</div><div><b>{fullName(p)}</b>
                  {p.allergies && <span className="alert-chip" style={{ padding: '1px 7px', fontSize: 11, marginLeft: 6 }} title={p.allergies}>Allergy</span>}
                  <div className="small muted">{p.email || ''}</div></div></div></td>
                <td className="nowrap">{p.phone || '—'}</td>
                <td>{age(p.dob) || '—'}</td>
                <td className="nowrap">{p.last_visit ? fmtDate(p.last_visit) : <span className="faint">Never</span>}</td>
                <td className="right mono">{p.balance > 0 ? <b style={{ color: 'var(--danger)' }}>{money(p.balance)}</b> : <span className="faint">—</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : dq ? <Empty icon={Search} title="No matches" text="Try a different name or phone number." />
          : <Empty icon={Users} title="No patients yet" text="Add your first patient, or import your list from Excel." />}
      </div>
    </>
  );
}
