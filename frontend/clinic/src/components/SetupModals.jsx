import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api } from '../../../shared/api';
import { fromCents, safeColor, toCents } from '../../../shared/format';
import { Field, Modal, useConfirm, useToast } from '../../../shared/ui';
import { useApp } from '../context';

const COLORS = ['#0e7c86', '#3b82f6', '#8b5cf6', '#e11d74', '#f59e0b', '#10b981', '#ef4444', '#64748b'];
const ROLES = ['Dentist', 'Dental hygienist', 'Orthodontist', 'Therapist', 'Psychologist', 'Counsellor', 'Physiotherapist', 'Doctor', 'Nurse', 'Receptionist'];

export function PractitionerModal({ close, item = null }) {
  const { refs, loadRefs, refresh } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const [f, setF] = useState(item ? { ...item, active: !!item.active } : { name: '', role: '', phone: '', email: '', active: true, color: COLORS[refs.practitioners.length % COLORS.length] });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={item ? 'Edit team member' : 'Add team member'} onClose={close} submitLabel={item ? 'Save changes' : 'Add'}
      footLeft={item && <button type="button" className="btn danger" onClick={async () => {
        if (!(await confirm(`${item.name} will be removed. Their past appointments and notes are kept but become unassigned.`))) return;
        await api(`/api/practitioners/${item.id}`, { method: 'DELETE' }); await loadRefs(); toast('Removed'); close(); refresh();
      }}><Trash2 /><span>Delete</span></button>}
      onSubmit={async () => {
        const body = { name: f.name, role: f.role, phone: f.phone, email: f.email, color: f.color, active: f.active };
        if (item) await api(`/api/practitioners/${item.id}`, { method: 'PUT', body });
        else await api('/api/practitioners', { method: 'POST', body });
        await loadRefs();
        toast('Team updated');
        refresh();
      }}>
      <div className="grid2">
        <Field label="Name"><input value={f.name || ''} onChange={set('name')} placeholder="Dr. Ali Raza" /></Field>
        <Field label="Role"><input value={f.role || ''} onChange={set('role')} list="roles" placeholder="Dentist, Therapist, Hygienist…" />
          <datalist id="roles">{ROLES.map((r) => <option key={r} value={r} />)}</datalist></Field>
        <Field label="Phone"><input value={f.phone || ''} onChange={set('phone')} /></Field>
        <Field label="Email"><input value={f.email || ''} onChange={set('email')} /></Field>
        <Field label="Calendar colour"><input type="color" value={safeColor(f.color)} onChange={set('color')} /></Field>
        <label className="row" style={{ gap: 8, marginTop: 26 }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active (shown when booking)</label>
      </div>
    </Modal>
  );
}

export function ServiceModal({ close, item = null }) {
  const { me, loadRefs, refresh } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const [f, setF] = useState(item ? { ...item, price: fromCents(item.price), active: !!item.active } : { name: '', category: '', price: '', duration_min: 30, active: true });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={item ? 'Edit service' : 'Add service'} onClose={close} submitLabel={item ? 'Save changes' : 'Add service'}
      footLeft={item && <button type="button" className="btn danger" onClick={async () => {
        if (!(await confirm(`${item.name} will be removed. Existing invoices are not affected.`))) return;
        await api(`/api/services/${item.id}`, { method: 'DELETE' }); await loadRefs(); toast('Service removed'); close(); refresh();
      }}><Trash2 /><span>Delete</span></button>}
      onSubmit={async () => {
        const body = { name: f.name, category: f.category, duration_min: f.duration_min, price: toCents(f.price), active: f.active };
        if (item) await api(`/api/services/${item.id}`, { method: 'PUT', body });
        else await api('/api/services', { method: 'POST', body });
        await loadRefs();
        toast('Services updated');
        refresh();
      }}>
      <div className="grid2">
        <Field label="Service name" className="span2"><input value={f.name || ''} onChange={set('name')} placeholder="e.g. Scale & polish" /></Field>
        <Field label="Category"><input value={f.category || ''} onChange={set('category')} placeholder="Preventive, Session, Assessment…" /></Field>
        <Field label={`Price (${me.clinic.currency})`}><input type="number" min="0" step="0.01" value={f.price} onChange={set('price')} placeholder="0.00" /></Field>
        <Field label="Duration (minutes)"><input type="number" min="5" step="5" value={f.duration_min} onChange={set('duration_min')} /></Field>
        <label className="row" style={{ gap: 8, marginTop: 26 }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>
      </div>
    </Modal>
  );
}
