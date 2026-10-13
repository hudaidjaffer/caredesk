import { useState } from 'react';
import { AlertTriangle, ArrowLeft, CalendarDays, Camera, ClipboardList, FileText, Pencil, Receipt, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { api } from '../../../shared/api';
import { age, fmtDate, fmtIso, fullName, initials } from '../../../shared/format';
import Markdown from '../../../shared/Markdown';
import { Badge, Empty, ErrorCard, Loading, useAsync, useConfirm, useModal, useToast } from '../../../shared/ui';
import { INV_STATUS, go, useApp } from '../context';
import { ApptList, NoteItem } from '../components/common';
import AppointmentModal, { openAppointment } from '../components/AppointmentModal';
import PatientModal from '../components/PatientModal';
import NoteModal from '../components/NoteModal';
import InvoiceModal from '../components/InvoiceModal';
import { DocCards, UploadModal } from '../components/Documents';

function AiSummary({ patientId }) {
  const [state, setState] = useState({});
  const run = async () => {
    setState({ busy: true });
    try { setState({ text: (await api('/api/ai/patient-summary', { method: 'POST', body: { patient_id: patientId } })).summary }); }
    catch (err) { setState({ error: err.message }); }
  };
  return (
    <div className="ai-box" style={{ margin: '18px 22px 0' }}>
      <div className="ai-head"><Sparkles size={18} />AI pre-visit summary<span className="spacer" />
        {state.text && <button className="btn sm ghost" onClick={run}><RefreshCw /><span>Refresh</span></button>}</div>
      {state.text ? <Markdown text={state.text} />
        : state.busy ? <div className="row muted"><span className="typing"><i /><i /><i /></span> Reading the record…</div>
          : <div className="row wrap"><span className="muted" style={{ flex: 1 }}>Get a short summary of this patient's history, alerts, recent visits and results.</span>
            <button className="btn sm primary" onClick={run}><Sparkles /><span>Summarise</span></button></div>}
      {state.error && <div className="form-error" style={{ marginTop: 8 }}>{state.error}</div>}
      {state.text && <div className="ai-note">Contact details are never sent to the AI. Always check against the record.</div>}
    </div>
  );
}

export default function PatientProfile({ id }) {
  const { money, canWrite, aiOn, version, refresh } = useApp();
  const open = useModal();
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState('overview');
  const { data: d, error, loading, reload } = useAsync(() => api(`/api/patients/${encodeURIComponent(id)}/summary`), [id, version]);
  if (error) return <ErrorCard error={error} onRetry={reload} />;
  if (loading && !d) return <Loading />;
  const p = d.patient;
  const name = fullName(p);
  const balance = d.invoices.reduce((s, i) => s + i.total - i.paid, 0);
  const meta = [age(p.dob), p.gender, p.phone, p.email].filter(Boolean).join(' · ');
  const preset = { patient_id: p.id, patient_name: name };
  const kv = (rows) => <dl className="kv">{rows.map(([k, v]) => <FragmentKV key={k} k={k} v={v} />)}</dl>;

  return (
    <>
      <div className="no-print" style={{ marginBottom: 12 }}><a href="#/patients" className="btn ghost sm"><ArrowLeft /><span>All patients</span></a></div>
      <div className="card">
        <div className="profile-head">
          <div className="avatar">{initials(name)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1>{name}</h1>
            <div className="muted">{meta || 'No contact details yet'}</div>
            {p.allergies && <div style={{ marginTop: 8 }}><span className="alert-chip"><AlertTriangle size={15} /> Allergies: {p.allergies}</span></div>}
          </div>
          <div className="row wrap" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" disabled={!canWrite} onClick={() => open((c) => <PatientModal close={c} patient={p} onSaved={() => {}} />)}><Pencil /><span>Edit</span></button>
            <button className="btn" disabled={!canWrite} onClick={() => open((c) => <NoteModal close={c} preset={preset} />)}><ClipboardList /><span>Note</span></button>
            <button className="btn" disabled={!canWrite} onClick={() => open((c) => <UploadModal close={c} preset={preset} />)}><Camera /><span>Upload</span></button>
            <button className="btn" disabled={!canWrite} onClick={() => open((c) => <InvoiceModal close={c} preset={preset} />)}><Receipt /><span>Invoice</span></button>
            <button className="btn primary" disabled={!canWrite} onClick={() => open((c) => <AppointmentModal close={c} preset={preset} />)}><CalendarDays /><span>Book</span></button>
          </div>
        </div>
        <div className="pill-tabs">
          {[['overview', 'Overview'], ['appointments', `Appointments (${d.appointments.length})`], ['notes', `Clinical notes (${d.notes.length})`],
            ['invoices', `Invoices (${d.invoices.length})`], ['documents', `Documents (${d.documents.length})`]].map(([k, l]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
        {tab === 'overview' && (
          <>
            {aiOn && <AiSummary patientId={p.id} />}
            <div className="halves card-body" style={{ padding: 22 }}>
              <div className="stack"><h3>Personal details</h3>{kv([['Date of birth', p.dob ? `${fmtDate(p.dob)} (${age(p.dob)})` : ''], ['Gender', p.gender],
                ['Phone', p.phone], ['Email', p.email], ['Address', p.address], ['Emergency contact', p.emergency_contact], ['Insurance', p.insurance]])}</div>
              <div className="stack"><h3>Medical information</h3>{kv([['Allergies', p.allergies], ['Medications', p.medications], ['Medical history', p.medical_history], ['Notes', p.notes]])}
                <h3 style={{ marginTop: 8 }}>Account</h3>{kv([['Balance due', money(balance)], ['Registered', fmtIso(p.created_at)]])}
                {canWrite && <div><button className="btn danger sm" onClick={async () => {
                  if (!(await confirm(`${name} and all their appointments, clinical notes and documents will be permanently deleted.`))) return;
                  try { await api(`/api/patients/${p.id}`, { method: 'DELETE' }); toast('Patient deleted'); go('#/patients'); refresh(); } catch (err) { toast(err.message, true); }
                }}><Trash2 /><span>Delete patient</span></button></div>}
              </div>
            </div>
          </>
        )}
        {tab === 'appointments' && (d.appointments.length
          ? <ApptList list={d.appointments} showDate onOpen={(a) => openAppointment(open, toast, a.id)} />
          : <Empty icon={CalendarDays} title="No appointments yet" />)}
        {tab === 'notes' && (d.notes.length
          ? d.notes.map((n) => <NoteItem key={n.id} n={n} onOpen={(note) => open((c) => <NoteModal close={c} note={note} />)} />)
          : <Empty icon={ClipboardList} title="No clinical notes yet" />)}
        {tab === 'invoices' && (d.invoices.length ? (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Invoice</th><th>Date</th><th className="right">Total</th><th className="right">Balance</th><th>Status</th></tr></thead>
            <tbody>{d.invoices.map((i) => (
              <tr key={i.id} className="click" onClick={() => go(`#/invoice/${i.id}`)}><td><b>{i.number}</b></td><td>{fmtDate(i.date)}</td>
                <td className="right mono">{money(i.total)}</td><td className="right mono">{money(i.total - i.paid)}</td><td><Badge status={i.status}>{INV_STATUS[i.status]}</Badge></td></tr>
            ))}</tbody>
          </table></div>
        ) : <Empty icon={Receipt} title="No invoices yet" />)}
        {tab === 'documents' && (d.documents.length
          ? <div className="card-body"><DocCards list={d.documents} /></div>
          : <Empty icon={FileText} title="No documents yet" text={canWrite ? 'Use “Upload” to add photos of reports, prescriptions, X-rays or forms.' : ''} />)}
      </div>
    </>
  );
}

const FragmentKV = ({ k, v }) => <><dt>{k}</dt><dd>{v || <span className="faint">—</span>}</dd></>;
