// Excel (.xlsx) export and patient import, using ExcelJS.
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const ExcelJS = require('exceljs');
const { db, now, tx } = require('./db');
const { HttpError, uid, str } = require('./core');
const { encryptFields } = require('./security');
const { exportTable, reports } = require('./data');

const MAX_IMPORT_BYTES = 10_000_000;
const MAX_IMPORT_ROWS = 20000;
const BRAND = 'FF0E7C86';

// ---------------------------------------------------------------- export

function moneyFormat(currency) {
  const sym = String(currency || '$').replace(/"/g, '');
  return `"${sym}${/[a-z]$/i.test(sym) ? ' ' : ''}"#,##0.00;[Red]-"${sym}${/[a-z]$/i.test(sym) ? ' ' : ''}"#,##0.00`;
}

function toExcelDate(v, withTime) {
  if (!v) return null;
  const s = String(v);
  const d = withTime
    ? new Date(s.length === 16 ? `${s}:00Z` : s)            // appointment local time "YYYY-MM-DDTHH:MM" shown as written
    : new Date(`${s.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? s : d;
}

function addTableSheet(wb, { title, columns, rows }, currency) {
  const ws = wb.addWorksheet(title.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => ({
    header: c.header, key: c.key,
    width: Math.min(60, Math.max(c.header.length + 2, c.type === 'money' ? 14 : c.type === 'date' ? 13 : c.type === 'datetime' ? 18 : 16)),
    style: c.type === 'money' ? { numFmt: moneyFormat(currency) }
      : c.type === 'date' ? { numFmt: 'dd mmm yyyy' }
        : c.type === 'datetime' ? { numFmt: 'dd mmm yyyy hh:mm' } : {},
  }));
  for (const r of rows) {
    const out = {};
    for (const c of columns) {
      const v = r[c.key];
      // values are written as plain values, never as formulas, so "=..." text can't execute in Excel
      out[c.key] = c.type === 'money' ? (v == null ? null : v / 100)
        : c.type === 'date' ? toExcelDate(v, false)
          : c.type === 'datetime' ? toExcelDate(v, true)
            : c.type === 'number' ? (v == null ? null : Number(v)) : (v == null ? null : String(v));
    }
    ws.addRow(out);
  }
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
  header.alignment = { vertical: 'middle' };
  header.height = 22;
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  // widen text columns to fit their content (capped)
  columns.forEach((c, i) => {
    if (c.type !== 'text') return;
    const longest = rows.reduce((m, r) => Math.max(m, Math.min(60, String(r[c.key] ?? '').split('\n')[0].length)), 0);
    ws.getColumn(i + 1).width = Math.max(ws.getColumn(i + 1).width, Math.min(60, longest + 2));
  });
  return ws;
}

function newWorkbook(productName) {
  const wb = new ExcelJS.Workbook();
  wb.creator = productName || 'CareDesk';
  wb.created = new Date();
  return wb;
}

async function exportXlsx(what, clinic, productName) {
  const wb = newWorkbook(productName);
  const all = ['patients', 'appointments', 'notes', 'invoices', 'payments', 'expenses', 'documents'];
  for (const w of what === 'all' ? all : [what]) addTableSheet(wb, await exportTable(w, clinic.id), clinic.currency);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function reportXlsx(clinic, from, to, productName) {
  const r = await reports(clinic.id, from, to);
  const wb = newWorkbook(productName);
  const cur = moneyFormat(clinic.currency);
  const s = wb.addWorksheet('Summary');
  s.columns = [{ width: 32 }, { width: 20 }];
  s.addRow([`${clinic.name}: report`]).font = { bold: true, size: 14, color: { argb: BRAND } };
  s.addRow([`Period: ${from} to ${to}`]);
  s.addRow([]);
  const kpis = [['Income received', r.income / 100, cur], ['Expenses', r.expenses / 100, cur], ['Net profit', r.net / 100, cur],
    ['Invoiced', r.invoiced / 100, cur], ['Invoices', r.invoice_count], ['New patients', r.new_patients]];
  for (const [label, value, fmt] of kpis) {
    const row = s.addRow([label, value]);
    row.getCell(1).font = { bold: true };
    if (fmt) row.getCell(2).numFmt = fmt;
  }
  const table = (title, columns, rows) => addTableSheet(wb, { title, columns, rows }, clinic.currency);
  table('By month', [{ key: 'm', header: 'Month' }, { key: 'income', header: 'Income', type: 'money' }, { key: 'expenses', header: 'Expenses', type: 'money' },
    { key: 'net', header: 'Net', type: 'money' }], r.by_month.map((x) => ({ ...x, net: x.income - x.expenses })));
  table('By service', [{ key: 'name', header: 'Service' }, { key: 'qty', header: 'Qty', type: 'number' }, { key: 'amount', header: 'Invoiced', type: 'money' }], r.by_service);
  table('Expenses by category', [{ key: 'category', header: 'Category' }, { key: 'amount', header: 'Amount', type: 'money' }], r.expenses_by_category);
  table('Payment methods', [{ key: 'method', header: 'Method' }, { key: 'count', header: 'Payments', type: 'number' }, { key: 'amount', header: 'Amount', type: 'money' }], r.by_payment_method);
  table('Appointments', [{ key: 'name', header: 'Practitioner' }, { key: 'count', header: 'Booked', type: 'number' }, { key: 'completed', header: 'Completed', type: 'number' }], r.appointments_by_practitioner);
  table('Outstanding', [{ key: 'name', header: 'Patient' }, { key: 'phone', header: 'Phone' }, { key: 'invoices', header: 'Invoices', type: 'number' }, { key: 'balance', header: 'Balance', type: 'money' }], r.outstanding);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------- patient import

const IMPORT_FIELDS = {
  full_name: { label: 'Full name (split into first/last)', synonyms: ['name', 'full name', 'patient', 'patient name', 'patient full name', 'client', 'client name'] },
  first_name: { label: 'First name', synonyms: ['first name', 'firstname', 'first', 'given name', 'given names', 'forename', 'fname'] },
  last_name: { label: 'Last name', synonyms: ['last name', 'lastname', 'surname', 'family name', 'last', 'lname'] },
  dob: { label: 'Date of birth', synonyms: ['dob', 'date of birth', 'birth date', 'birthdate', 'birthday', 'd.o.b'] },
  gender: { label: 'Gender', synonyms: ['gender', 'sex'] },
  phone: { label: 'Phone', synonyms: ['phone', 'mobile', 'cell', 'telephone', 'tel', 'contact', 'contact number', 'phone number', 'mobile number', 'whatsapp'] },
  email: { label: 'Email', synonyms: ['email', 'e-mail', 'email address', 'mail'] },
  address: { label: 'Address', synonyms: ['address', 'home address', 'street', 'residence'] },
  emergency_contact: { label: 'Emergency contact', synonyms: ['emergency contact', 'emergency', 'next of kin', 'kin'] },
  insurance: { label: 'Insurance', synonyms: ['insurance', 'insurer', 'policy', 'policy number', 'insurance number', 'payer'] },
  allergies: { label: 'Allergies', synonyms: ['allergies', 'allergy', 'allergic to'] },
  medical_history: { label: 'Medical history', synonyms: ['medical history', 'history', 'conditions', 'medical conditions', 'diagnosis'] },
  medications: { label: 'Medications', synonyms: ['medications', 'medication', 'medicines', 'drugs', 'current medications'] },
  notes: { label: 'Notes', synonyms: ['notes', 'note', 'comments', 'remarks'] },
};

const pending = new Map();   // token -> { clinicId, headers, rows, expires }
setInterval(() => { for (const [k, v] of pending) if (v.expires < Date.now()) pending.delete(k); }, 60000).unref();

const norm = (s) => String(s || '').toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();

function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.text) return String(v.text);                     // hyperlink
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return cellText(v.result);          // formula: use its value, never the formula
    return '';
  }
  return String(v).trim();
}

async function readSheet(buf, filename) {
  const isZip = buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  const wb = new ExcelJS.Workbook();
  if (isZip) {
    try { await wb.xlsx.load(buf); } catch { throw new HttpError(400, 'This Excel file could not be read. Open it in Excel, choose "Save As" .xlsx, and try again.'); }
  } else if (/\.csv$/i.test(filename || '') || !buf.includes(0)) {
    await wb.csv.read(Readable.from(buf.toString('utf8').replace(/^ï»¿/, '')));
  } else {
    throw new HttpError(400, 'Please upload an Excel (.xlsx) or CSV file.');
  }
  const ws = wb.worksheets.find((w) => w.actualRowCount > 0);
  if (!ws) throw new HttpError(400, 'The file has no data.');
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    if (rows.length > MAX_IMPORT_ROWS) return;
    const vals = [];
    for (let c = 1; c <= Math.min(row.cellCount, 60); c++) vals.push(cellText(row.getCell(c).value));
    if (vals.some((v) => v)) rows.push(vals);
  });
  if (rows.length < 2) throw new HttpError(400, 'The file needs a header row and at least one patient.');
  if (rows.length > MAX_IMPORT_ROWS + 1) throw new HttpError(400, `Too many rows (max ${MAX_IMPORT_ROWS}).`);
  const headers = rows[0].map((h, i) => h || `Column ${i + 1}`);
  return { headers, rows: rows.slice(1) };
}

// "D.O.B", "d o b" and "DOB" all compare equal
const compact = (s) => norm(s).replace(/\s+/g, '');

function suggestMapping(headers) {
  const mapping = {};
  const used = new Set();
  for (const [field, def] of Object.entries(IMPORT_FIELDS)) {
    const wanted = new Set(def.synonyms.map(compact));
    const idx = headers.findIndex((h, i) => !used.has(i) && wanted.has(compact(h)));
    if (idx >= 0) { mapping[field] = idx; used.add(idx); }
  }
  // a single "Name" column means full name unless first/last columns exist
  if (mapping.first_name != null && mapping.full_name != null) delete mapping.full_name;
  return mapping;
}

async function importPreview(clinicId, buf, filename) {
  if (buf.length > MAX_IMPORT_BYTES) throw new HttpError(413, 'File is too large (max 10 MB).');
  const { headers, rows } = await readSheet(buf, filename);
  const token = crypto.randomBytes(16).toString('hex');
  pending.set(token, { clinicId, headers, rows, expires: Date.now() + 20 * 60000 });
  return {
    token, headers, total: rows.length, sample: rows.slice(0, 8), mapping: suggestMapping(headers),
    fields: Object.fromEntries(Object.entries(IMPORT_FIELDS).map(([k, v]) => [k, v.label])),
  };
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function parseDate(s) {
  s = String(s || '').trim();
  if (!s) return null;
  let m;
  const ok = (y, mo, d) => {
    y = Number(y); mo = Number(mo); d = Number(d);
    if (y < 100) y += y > (new Date().getFullYear() % 100) ? 1900 : 2000;
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2100)) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return ok(m[1], m[2], m[3]);
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) {
    const a = Number(m[1]); const b = Number(m[2]);
    return b > 12 && a <= 12 ? ok(m[3], a, b) : ok(m[3], b, a);              // day-first unless impossible
  }
  if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{2,4})$/)) && MONTHS[m[2].slice(0, 3).toLowerCase()]) return ok(m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], m[1]);
  if ((m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/)) && MONTHS[m[1].slice(0, 3).toLowerCase()]) return ok(m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], m[2]);
  if (/^\d{5}$/.test(s)) {                                                    // Excel serial date stored as text
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

function normGender(g) {
  const s = norm(g);
  if (!s) return null;
  if (['f', 'female', 'woman', 'w'].includes(s)) return 'Female';
  if (['m', 'male', 'man'].includes(s)) return 'Male';
  return 'Other';
}

const digits = (s) => String(s || '').replace(/\D/g, '');

const PATIENT_COLS = ['id', 'clinic_id', 'first_name', 'last_name', 'dob', 'gender', 'phone', 'email', 'address',
  'emergency_contact', 'insurance', 'allergies', 'medical_history', 'medications', 'notes', 'created_at'];

async function importCommit(clinicId, token, mapping) {
  const job = pending.get(String(token || ''));
  if (!job || job.clinicId !== clinicId) throw new HttpError(410, 'This import has expired. Please upload the file again.');
  pending.delete(token);                          // one use only, even if two requests arrive together
  const map = {};
  for (const [field, idx] of Object.entries(mapping || {})) {
    if (IMPORT_FIELDS[field] && Number.isInteger(idx) && idx >= 0 && idx < job.headers.length) map[field] = idx;
  }
  if (map.first_name == null && map.full_name == null) {
    pending.set(token, job);                      // let them fix the mapping and try again
    throw new HttpError(400, 'Choose which column holds the patient name.');
  }

  const existing = await db.all("SELECT lower(first_name || ' ' || COALESCE(last_name,'')) AS n, phone, dob FROM patients WHERE clinic_id = ?", clinicId);
  const seen = new Set(existing.map((p) => `${p.n.trim()}|${digits(p.phone)}|${p.dob || ''}`));
  const byName = new Map();
  for (const p of existing) {
    const k = p.n.trim();
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(p);
  }

  const result = { created: 0, duplicates: 0, errors: [] };
  const get = (row, f) => (map[f] == null ? '' : String(row[map[f]] ?? '').trim());
  const rows = [];
  job.rows.forEach((row, i) => {
    const line = i + 2;   // spreadsheet row number (header is row 1)
    let first = get(row, 'first_name');
    let last = get(row, 'last_name');
    if (!first && map.full_name != null) {
      const parts = get(row, 'full_name').replace(/^(mr|mrs|ms|miss|dr)\.?\s+/i, '').split(/\s+/).filter(Boolean);
      first = parts.shift() || '';
      if (!last) last = parts.join(' ');
    }
    if (!first) { if (result.errors.length < 50) result.errors.push({ row: line, message: 'No name' }); return; }
    const dobRaw = get(row, 'dob');
    const dob = parseDate(dobRaw);
    if (dobRaw && !dob && result.errors.length < 50) result.errors.push({ row: line, message: `Date of birth "${dobRaw.slice(0, 20)}" not understood (left blank)` });
    const phone = str(get(row, 'phone'), 50);
    const nameKey = `${first} ${last}`.toLowerCase().replace(/\s+/g, ' ').trim();
    // duplicate = same name and (same phone or same date of birth, or neither recorded)
    const twins = byName.get(nameKey) || [];
    const dup = seen.has(`${nameKey}|${digits(phone)}|${dob || ''}`)
      || twins.some((t) => (phone && digits(t.phone) === digits(phone)) || (dob && t.dob === dob) || (!phone && !dob && !t.phone && !t.dob));
    if (dup) { result.duplicates++; return; }
    const email = get(row, 'email').toLowerCase();
    const rec = encryptFields('patients', {
      address: str(get(row, 'address'), 2000), emergency_contact: str(get(row, 'emergency_contact'), 300),
      insurance: str(get(row, 'insurance'), 300), allergies: str(get(row, 'allergies'), 5000),
      medical_history: str(get(row, 'medical_history'), 20000), medications: str(get(row, 'medications'), 5000),
      notes: str(get(row, 'notes'), 20000),
    });
    rows.push([uid(), clinicId, str(first, 150), str(last, 150), dob, normGender(get(row, 'gender')), phone,
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.slice(0, 200) : null,
      rec.address, rec.emergency_contact, rec.insurance, rec.allergies, rec.medical_history, rec.medications, rec.notes, now()]);
    seen.add(`${nameKey}|${digits(phone)}|${dob || ''}`);
    if (!byName.has(nameKey)) byName.set(nameKey, []);
    byName.get(nameKey).push({ n: nameKey, phone, dob });
  });

  // insert in batches of 500 rows inside one transaction (all or nothing; fast even over the internet)
  await tx(async (t) => {
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const values = batch.map(() => `(${PATIENT_COLS.map(() => '?').join(',')})`).join(',');
      await t.run(`INSERT INTO patients (${PATIENT_COLS.join(',')}) VALUES ${values}`, ...batch.flat());
    }
  });
  result.created = rows.length;
  return result;
}
async function importTemplate(productName) {
  const wb = newWorkbook(productName);
  const columns = ['first_name', 'last_name', 'dob', 'gender', 'phone', 'email', 'address', 'emergency_contact', 'insurance',
    'allergies', 'medical_history', 'medications', 'notes'].map((k) => ({ key: k, header: IMPORT_FIELDS[k].label, type: k === 'dob' ? 'date' : 'text' }));
  addTableSheet(wb, { title: 'Patients', columns, rows: [
    { first_name: 'Ahmed', last_name: 'Khan', dob: '1985-03-12', gender: 'Male', phone: '+92 300 1234567', email: 'ahmed@example.com',
      address: '12 Garden Road, Lahore', allergies: 'Penicillin' },
  ] }, '$');
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { exportXlsx, reportXlsx, importPreview, importCommit, importTemplate, parseDate };
