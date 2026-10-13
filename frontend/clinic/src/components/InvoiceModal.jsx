import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { api } from '../../../shared/api';
import { fromCents, localDate, toCents } from '../../../shared/format';
import { Field, Modal, useToast } from '../../../shared/ui';
import { PAY_METHODS, go, useApp } from '../context';
import { PatientPicker, serviceOptions } from './common';

const blank = () => ({ service_id: '', description: '', qty: 1, unit_price: '' });

export default function InvoiceModal({ close, inv = null, preset = {} }) {
  const { me, refs, money, refresh } = useApp();
  const toast = useToast();
  const c = me.clinic;
  const due = new Date();
  due.setDate(due.getDate() + 14);
  const [f, setF] = useState({
    patient_id: inv ? inv.patient_id : preset.patient_id || '', patient_name: inv ? inv.patient_name : preset.patient_name || '',
    date: inv ? inv.date : localDate(), due_date: inv ? inv.due_date || '' : localDate(due),
    discount: inv ? fromCents(inv.discount) : '', tax_rate: inv ? inv.tax_rate : c.tax_rate || 0, notes: inv ? inv.notes || '' : '',
  });
  const [items, setItems] = useState(inv ? inv.items.map((it) => ({ ...it, unit_price: fromCents(it.unit_price) })) : preset.items || [blank()]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setItem = (i, k, v) => setItems((list) => list.map((it, j) => {
    if (j !== i) return it;
    if (k === 'service_id') {
      const s = refs.services.find((x) => x.id === v);
      return s ? { ...it, service_id: v, description: s.name, unit_price: fromCents(s.price) } : { ...it, service_id: v };
    }
    return { ...it, [k]: v };
  }));
  const lineAmount = (it) => Math.round((Number(it.qty) || 0) * toCents(it.unit_price));
  const sub = items.reduce((s, it) => s + lineAmount(it), 0);
  const disc = Math.min(toCents(f.discount), sub);
  const tax = Math.round(((sub - disc) * (Number(f.tax_rate) || 0)) / 100);

  const save = async () => {
    if (!f.patient_id) throw new Error('Please choose a patient.');
    const body = { patient_id: f.patient_id, date: f.date, due_date: f.due_date, discount: toCents(f.discount), tax_rate: f.tax_rate, notes: f.notes,
      items: items.map((it) => ({ service_id: it.service_id || null, description: it.description, qty: it.qty, unit_price: toCents(it.unit_price) })) };
    const saved = inv ? await api(`/api/invoices/${inv.id}`, { method: 'PUT', body }) : await api('/api/invoices', { method: 'POST', body });
    toast(inv ? 'Invoice updated' : `Invoice ${saved.number} created`);
    go(`#/invoice/${saved.id}`);
    refresh();
  };

  return (
    <Modal title={inv ? `Edit ${inv.number}` : 'New invoice'} wide onClose={close} onSubmit={save} submitLabel={inv ? 'Save invoice' : 'Create invoice'}>
      <div className="stack">
        <div className="grid3">
          <PatientPicker value={f.patient_id} name={f.patient_name} onChange={(id, name) => setF((s) => ({ ...s, patient_id: id, patient_name: name }))} />
          <Field label="Invoice date"><input type="date" value={f.date} onChange={set('date')} /></Field>
          <Field label="Due date"><input type="date" value={f.due_date} onChange={set('due_date')} /></Field>
        </div>
        <div className="table-wrap"><table className="t items-table">
          <thead><tr><th style={{ width: '26%' }}>Service</th><th>Description</th><th style={{ width: 80 }}>Qty</th><th style={{ width: 120 }}>Price</th><th className="right" style={{ width: 110 }}>Amount</th><th style={{ width: 40 }} /></tr></thead>
          <tbody>{items.map((it, i) => (
            <tr key={i}>
              <td><select value={it.service_id || ''} onChange={(e) => setItem(i, 'service_id', e.target.value)}>{serviceOptions(refs.services, it.service_id, money)}</select></td>
              <td><input value={it.description} onChange={(e) => setItem(i, 'description', e.target.value)} placeholder="Treatment or item" /></td>
              <td><input type="number" min="0" step="1" value={it.qty} onChange={(e) => setItem(i, 'qty', e.target.value)} /></td>
              <td><input type="number" min="0" step="0.01" value={it.unit_price} onChange={(e) => setItem(i, 'unit_price', e.target.value)} placeholder="0.00" /></td>
              <td className="right mono">{money(lineAmount(it))}</td>
              <td><button type="button" className="btn ghost icon sm" title="Remove" onClick={() => setItems((l) => (l.length > 1 ? l.filter((_, j) => j !== i) : [blank()]))}><X /></button></td>
            </tr>
          ))}</tbody>
        </table></div>
        <div><button type="button" className="btn sm" onClick={() => setItems([...items, blank()])}><Plus /><span>Add line</span></button></div>
        <div className="row wrap" style={{ alignItems: 'flex-start', gap: 20 }}>
          <div className="grid2" style={{ flex: 1, minWidth: 260 }}>
            <Field label={`Discount (${c.currency})`}><input type="number" step="0.01" min="0" value={f.discount} onChange={set('discount')} placeholder="0.00" /></Field>
            <Field label="Tax rate (%)"><input type="number" step="0.01" min="0" value={f.tax_rate} onChange={set('tax_rate')} /></Field>
            <Field label="Notes on invoice" className="span2"><textarea value={f.notes} onChange={set('notes')} style={{ minHeight: 60 }} /></Field>
          </div>
          <div className="totals">
            <div><span className="muted">Subtotal</span><span className="mono">{money(sub)}</span></div>
            {disc > 0 && <div><span className="muted">Discount</span><span className="mono">−{money(disc)}</span></div>}
            {tax > 0 && <div><span className="muted">Tax</span><span className="mono">{money(tax)}</span></div>}
            <div className="grand"><span>Total</span><span className="mono">{money(sub - disc + tax)}</span></div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function PaymentModal({ close, inv }) {
  const { me, money, refresh } = useApp();
  const toast = useToast();
  const bal = inv.total - inv.paid;
  const [f, setF] = useState({ amount: fromCents(bal), date: localDate(), method: 'Cash', reference: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={`Record payment · ${inv.number}`} onClose={close} submitLabel="Record payment" onSubmit={async () => {
      await api('/api/payments', { method: 'POST', body: { invoice_id: inv.id, amount: toCents(f.amount), date: f.date, method: f.method, reference: f.reference } });
      toast('Payment recorded');
      refresh();
    }}>
      <div className="grid2">
        <Field label={`Amount (${me.clinic.currency})`}><input type="number" step="0.01" min="0" value={f.amount} onChange={set('amount')} /></Field>
        <Field label="Date"><input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Method"><select value={f.method} onChange={set('method')}>{PAY_METHODS.map((m) => <option key={m}>{m}</option>)}</select></Field>
        <Field label="Reference"><input value={f.reference} onChange={set('reference')} placeholder="Receipt / transaction no." /></Field>
        <p className="small muted span2" style={{ margin: 0 }}>Balance due: <b>{money(bal)}</b></p>
      </div>
    </Modal>
  );
}
