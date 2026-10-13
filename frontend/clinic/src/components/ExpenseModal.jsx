import { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api } from '../../../shared/api';
import { fromCents, localDate, toCents } from '../../../shared/format';
import OCR from '../../../shared/ocr';
import { Field, Modal, useConfirm, useToast } from '../../../shared/ui';
import { EXPENSE_CATS, PAY_METHODS, useApp } from '../context';
import ScanBar from './ScanBar';

export default function ExpenseModal({ close, expense = null }) {
  const { me, refresh } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const [f, setF] = useState({
    date: expense ? expense.date : localDate(), amount: expense ? fromCents(expense.amount) : '', category: expense ? expense.category : '',
    method: expense ? expense.method || 'Cash' : 'Cash', description: expense ? expense.description || '' : '',
  });
  const latest = useRef(f);
  latest.current = f;
  const [auto, setAuto] = useState(new Set());
  const bind = (k) => ({ value: f[k], className: auto.has(k) ? 'autofilled' : undefined, onChange: (e) => { setF({ ...f, [k]: e.target.value }); setAuto((s) => { const n = new Set(s); n.delete(k); return n; }); } });
  return (
    <Modal title={expense ? 'Edit expense' : 'New expense'} onClose={close} submitLabel={expense ? 'Save changes' : 'Add expense'}
      footLeft={expense && <button type="button" className="btn danger" onClick={async () => {
        if (!(await confirm('This expense will be permanently deleted.'))) return;
        await api(`/api/expenses/${expense.id}`, { method: 'DELETE' }); toast('Expense deleted'); close(); refresh();
      }}><Trash2 /><span>Delete</span></button>}
      onSubmit={async () => {
        const body = { ...f, amount: toCents(f.amount) };
        if (body.amount <= 0) throw new Error('Please enter the amount.');
        if (expense) await api(`/api/expenses/${expense.id}`, { method: 'PUT', body });
        else await api('/api/expenses', { method: 'POST', body });
        toast('Expense saved');
        refresh();
      }}>
      {!expense && (
        <div style={{ marginBottom: 16 }}>
          <ScanBar title="Scan a receipt" hint="Take a photo of the bill and the amount and date are filled in." onText={(text) => {
            const r = OCR.parseReceipt(text);
            const cur = latest.current;
            const next = { ...cur };
            const filled = [];
            const keys = [];
            if (r.amount && !cur.amount) { next.amount = r.amount.toFixed(2); filled.push('amount'); keys.push('amount'); }
            if (r.description && !cur.description) { next.description = r.description; filled.push('description'); keys.push('description'); }
            if (r.date) { next.date = r.date; filled.push('date'); keys.push('date'); }   // replaces the default "today"
            setF(next);
            setAuto(new Set(keys));
            return filled;
          }} />
        </div>
      )}
      <div className="grid2">
        <Field label="Date"><input type="date" {...bind('date')} /></Field>
        <Field label={`Amount (${me.clinic.currency})`}><input type="number" min="0" step="0.01" {...bind('amount')} placeholder="0.00" /></Field>
        <Field label="Category"><input list="expCats" {...bind('category')} placeholder="e.g. Medical supplies" />
          <datalist id="expCats">{EXPENSE_CATS.map((c) => <option key={c} value={c} />)}</datalist></Field>
        <Field label="Paid by"><select {...bind('method')}>{PAY_METHODS.map((m) => <option key={m}>{m}</option>)}</select></Field>
        <Field label="Description" className="span2"><input {...bind('description')} placeholder="Supplier, item, invoice number…" /></Field>
      </div>
    </Modal>
  );
}
