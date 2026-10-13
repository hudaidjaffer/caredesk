import { useState } from 'react';
import { ClipboardList, Receipt, Trash2, User } from 'lucide-react';
import { api } from '../../../shared/api';
import { fromCents, fullName, localDate } from '../../../shared/format';
import { Field, Modal, useConfirm, useModal, useToast } from '../../../shared/ui';
import { STATUS, go, useApp } from '../context';
import { PatientPicker, practitionerOptions, serviceOptions } from './common';
import NoteModal from './NoteModal';
import InvoiceModal from './InvoiceModal';

export async function openAppointment(open, toast, id) {
  try {
    const a = await api(`/api/appointments/${id}`);
    const p = await api(`/api/patients/${a.patient_id}`);
    open((close) => <AppointmentModal close={close} appt={a} patientName={fullName(p)} />);
  } catch (err) {
    toast(err.message, true);
  }
}

export default function AppointmentModal({ close, appt = null, preset = {}, patientName = '' }) {
  const { refs, canWrite, money, refresh } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const open = useModal();
  const firstPrac = refs.practitioners.find((p) => p.active);
  const base = appt || { starts_at: preset.starts_at || `${localDate()}T09:00`, duration_min: 30, status: 'scheduled',
    patient_id: preset.patient_id || '', practitioner_id: preset.practitioner_id || (firstPrac ? firstPrac.id : '') };
  const [f, setF] = useState({
    patient_id: base.patient_id, patient_name: patientName || preset.patient_name || '', service_id: base.service_id || '',
    practitioner_id: base.practitioner_id || '', date: base.starts_at.slice(0, 10), time: base.starts_at.slice(11, 16),
    duration_min: base.duration_min || 30, status: base.status, notes: base.notes || '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const ro = !canWrite;
  const save = async () => {
    if (!f.patient_id) throw new Error('Please choose a patient (or type a new name and pick “Add new patient”).');
    if (!f.date || !f.time) throw new Error('Please choose a date and time.');
    const body = { patient_id: f.patient_id, service_id: f.service_id, practitioner_id: f.practitioner_id,
      starts_at: `${f.date}T${f.time.slice(0, 5)}`, duration_min: f.duration_min, status: f.status, notes: f.notes };
    if (appt) await api(`/api/appointments/${appt.id}`, { method: 'PUT', body });
    else await api('/api/appointments', { method: 'POST', body });
    toast(appt ? 'Appointment updated' : 'Appointment booked');
    refresh();
  };
  const service = refs.services.find((s) => s.id === f.service_id);
  const foot = appt && (
    <>
      {!ro && <button type="button" className="btn danger icon" title="Delete" onClick={async () => {
        if (!(await confirm('This appointment will be permanently deleted.'))) return;
        await api(`/api/appointments/${appt.id}`, { method: 'DELETE' }); toast('Appointment deleted'); close(); refresh();
      }}><Trash2 /></button>}
      <button type="button" className="btn sm" onClick={() => { close(); go(`#/patients/${appt.patient_id}`); }}><User /><span>Patient</span></button>
      {!ro && <>
        <button type="button" className="btn sm" onClick={() => { close(); open((c) => <NoteModal close={c} preset={{ patient_id: appt.patient_id, patient_name: f.patient_name, practitioner_id: appt.practitioner_id, date: f.date }} />); }}>
          <ClipboardList /><span>Note</span></button>
        <button type="button" className="btn sm" onClick={() => {
          close();
          open((c) => <InvoiceModal close={c} preset={{ patient_id: appt.patient_id, patient_name: f.patient_name,
            items: service ? [{ service_id: service.id, description: service.name, qty: 1, unit_price: fromCents(service.price) }] : undefined }} />);
        }}><Receipt /><span>Invoice</span></button>
      </>}
    </>
  );
  return (
    <Modal title={appt ? 'Appointment' : 'Book appointment'} onClose={close} onSubmit={save} hideSubmit={ro}
      submitLabel={appt ? 'Save changes' : 'Book appointment'} footLeft={foot}>
      <div className="grid2">
        <div className="span2"><PatientPicker value={f.patient_id} name={f.patient_name} onChange={(id, name) => setF((s) => ({ ...s, patient_id: id, patient_name: name }))} /></div>
        <Field label="Service"><select value={f.service_id} onChange={(e) => {
          const s = refs.services.find((x) => x.id === e.target.value);
          setF({ ...f, service_id: e.target.value, duration_min: s && s.duration_min ? s.duration_min : f.duration_min });
        }}>{serviceOptions(refs.services, f.service_id, money)}</select></Field>
        <Field label="Practitioner"><select value={f.practitioner_id} onChange={set('practitioner_id')}>{practitionerOptions(refs.practitioners, f.practitioner_id)}</select></Field>
        <Field label="Date"><input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Time"><input type="time" step="300" value={f.time} onChange={set('time')} /></Field>
        <Field label="Duration (minutes)"><input type="number" min="5" step="5" value={f.duration_min} onChange={set('duration_min')} /></Field>
        <Field label="Status"><select value={f.status} onChange={set('status')}>{Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Notes" className="span2"><textarea value={f.notes} onChange={set('notes')} placeholder="Reason for visit, reminders…" /></Field>
      </div>
    </Modal>
  );
}
