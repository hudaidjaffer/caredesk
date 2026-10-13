import { useRef, useState } from 'react';
import { api, uploadFile, qs } from '../../../shared/api';
import { fullName } from '../../../shared/format';
import OCR from '../../../shared/ocr';
import { Field, Modal, useToast } from '../../../shared/ui';
import { go, useApp } from '../context';
import ScanBar, { fillEmpty } from './ScanBar';

const FIELDS = ['first_name', 'last_name', 'dob', 'gender', 'phone', 'email', 'address', 'emergency_contact', 'insurance', 'allergies', 'medications', 'medical_history', 'notes'];
const LABELS = { first_name: 'first name', last_name: 'last name', dob: 'date of birth', gender: 'gender', phone: 'phone', email: 'email', address: 'address',
  allergies: 'allergies', medications: 'medications', emergency_contact: 'emergency contact', insurance: 'insurance' };

// Upload a scanned picture to a patient and save the text that was read from it.
export async function saveScannedDoc(patientId, blob, text, meta) {
  const doc = await uploadFile(`/api/patients/${encodeURIComponent(patientId)}/documents${qs({ title: meta.title, category: meta.category, filename: meta.filename })}`, blob);
  if (text) await api(`/api/documents/${doc.id}`, { method: 'PUT', body: { ocr_text: text, ocr_lang: meta.lang || OCR.lang() } });
  return doc;
}

export default function PatientModal({ close, patient = null, onSaved }) {
  const { canWrite, refresh } = useApp();
  const toast = useToast();
  const [f, setF] = useState(() => Object.fromEntries(FIELDS.map((k) => [k, (patient && patient[k]) || ''])));
  const latest = useRef(f);          // the scan finishes asynchronously; always merge into the newest form values
  latest.current = f;
  const [auto, setAuto] = useState(new Set());
  const [scan, setScan] = useState(null);
  const [keepScan, setKeepScan] = useState(true);
  const ro = !canWrite;
  const bind = (k) => ({
    value: f[k], className: auto.has(k) ? 'autofilled' : undefined,
    onChange: (e) => { setF({ ...f, [k]: e.target.value }); if (auto.has(k)) setAuto((s) => { const n = new Set(s); n.delete(k); return n; }); },
  });
  const save = async () => {
    const saved = patient
      ? await api(`/api/patients/${patient.id}`, { method: 'PUT', body: f })
      : await api('/api/patients', { method: 'POST', body: f });
    if (scan && keepScan) {
      try { await saveScannedDoc(saved.id, scan.blob, scan.text, { title: 'Registration form / ID', category: 'Registration form', filename: scan.filename, lang: scan.lang }); }
      catch (err) { toast(`Patient saved, but the photo could not be stored: ${err.message}`, true); }
    }
    toast(patient ? 'Patient updated' : 'Patient added');
    if (onSaved) onSaved(saved);
    else if (!patient) go(`#/patients/${saved.id}`);
    refresh();
  };
  return (
    <Modal title={patient ? `Edit ${fullName(patient)}` : 'New patient'} wide onClose={close} onSubmit={save} hideSubmit={ro}
      submitLabel={patient ? 'Save changes' : 'Add patient'}>
      <div className="stack">
        {!ro && (
          <>
            <ScanBar title="Scan a registration form or ID card" hint="Take a photo and the details are filled in for you to check."
              onText={(text, meta) => {
                const [next, filled, keys] = fillEmpty(latest.current, OCR.parsePatient(text), LABELS);
                setF(next);
                setAuto((s) => new Set([...s, ...keys]));
                setScan({ ...meta, text });
                return filled;
              }} />
            {scan && <label className="row small" style={{ gap: 8 }}><input type="checkbox" checked={keepScan} onChange={(e) => setKeepScan(e.target.checked)} /> Save the scanned photo to this patient's documents</label>}
          </>
        )}
        <h3>Personal details</h3>
        <div className="grid3">
          <Field label="First name"><input {...bind('first_name')} /></Field>
          <Field label="Last name"><input {...bind('last_name')} /></Field>
          <Field label="Date of birth"><input type="date" {...bind('dob')} /></Field>
          <Field label="Gender"><select {...bind('gender')}>{['', 'Female', 'Male', 'Other', 'Prefer not to say'].map((g) => <option key={g} value={g}>{g}</option>)}</select></Field>
          <Field label="Phone"><input type="tel" {...bind('phone')} /></Field>
          <Field label="Email"><input type="email" {...bind('email')} /></Field>
          <Field label="Address" className="span3"><input {...bind('address')} /></Field>
          <Field label="Emergency contact"><input {...bind('emergency_contact')} placeholder="Name & phone" /></Field>
          <Field label="Insurance / payer" className="span2"><input {...bind('insurance')} placeholder="Provider & policy number" /></Field>
        </div>
        <h3 style={{ marginTop: 6 }}>Medical information</h3>
        <div className="grid2">
          <Field label="Allergies"><textarea {...bind('allergies')} placeholder="e.g. Penicillin, latex" /></Field>
          <Field label="Current medications"><textarea {...bind('medications')} /></Field>
          <Field label="Medical history"><textarea {...bind('medical_history')} placeholder="Conditions, surgeries, relevant history" /></Field>
          <Field label="Other notes"><textarea {...bind('notes')} /></Field>
        </div>
        <p className="small faint" style={{ margin: 0 }}>Medical details, address, insurance and notes are stored encrypted.</p>
      </div>
    </Modal>
  );
}
