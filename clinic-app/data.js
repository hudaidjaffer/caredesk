// Clinic data: patients, appointments, notes, billing, documents, dashboard, reports and exports.
// Every query is scoped by clinic_id. Medical/personal fields are encrypted at rest (see security.js).
const { db, tx, now } = require('./db');
const { HttpError, uid, str, sniffFile, readRaw } = require('./core');
const { encryptFields, decryptRow, decryptRows, decrypt, encryptBuffer, decryptBuffer } = require('./security');
const storage = require('./storage');

const MAX_UPLOAD = 15_000_000;
const DOC_CATEGORIES = ['Lab report', 'Prescription', 'X-ray / scan', 'ID / insurance card', 'Referral letter',
  'Consent form', 'Registration form', 'Invoice / receipt', 'Other'];
const APPT_STATUSES = ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'];

const toCents = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : 0; };
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const isDateTime = (s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(s || ''));
const fullNameSql = (alias) => `${alias}.first_name || ' ' || COALESCE(${alias}.last_name,'')`;
const contains = (hay, needle) => String(hay || '').toLowerCase().includes(needle);
const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`);

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- default data per clinic type

const STARTER_SERVICES = {
  dental: [
    ['Dental check-up & exam', 'Preventive', 30, 5000], ['Scale & polish (cleaning)', 'Preventive', 45, 8000],
    ['Dental X-ray', 'Diagnostics', 15, 3000], ['Composite filling', 'Restorative', 45, 12000],
    ['Tooth extraction', 'Surgery', 45, 15000], ['Root canal treatment', 'Endodontics', 90, 60000],
    ['Teeth whitening', 'Cosmetic', 60, 25000],
  ],
  therapy: [
    ['Initial assessment', 'Assessment', 60, 9000], ['Individual session (50 min)', 'Session', 50, 8000],
    ['Couples session', 'Session', 75, 12000], ['Follow-up session (30 min)', 'Session', 30, 5000],
  ],
  physio: [
    ['Initial physio assessment', 'Assessment', 60, 9000], ['Follow-up treatment', 'Treatment', 45, 7000],
    ['Sports massage', 'Treatment', 45, 6000], ['Dry needling', 'Treatment', 30, 5000],
  ],
  general: [
    ['General consultation', 'Consultation', 15, 4000], ['Extended consultation', 'Consultation', 30, 7000],
    ['Vaccination', 'Procedure', 15, 3000], ['Blood test', 'Diagnostics', 15, 3500],
  ],
  other: [['Consultation', 'Consultation', 30, 5000], ['Follow-up', 'Consultation', 20, 3000]],
};

// ---------------------------------------------------------------- generic resources

// Field types: str, text, date, datetime, int, money (cents), bool, ref:<table>.  Trailing ! = required.
const RESOURCES = {
  patients: {
    table: 'patients',
    fields: {
      first_name: 'str!', last_name: 'str', dob: 'date', gender: 'str', phone: 'str', email: 'str',
      address: 'text', emergency_contact: 'str', insurance: 'str', allergies: 'text',
      medical_history: 'text', medications: 'text', notes: 'text',
    },
  },
  practitioners: { table: 'practitioners', fields: { name: 'str!', role: 'str', phone: 'str', email: 'str', color: 'str', active: 'bool' } },
  services: { table: 'services', fields: { name: 'str!', category: 'str', duration_min: 'int', price: 'money', active: 'bool' } },
  appointments: {
    table: 'appointments',
    fields: {
      patient_id: 'ref:patients!', practitioner_id: 'ref:practitioners', service_id: 'ref:services',
      starts_at: 'datetime!', duration_min: 'int', status: 'str', notes: 'text',
    },
  },
  notes: {
    table: 'clinical_notes',
    fields: {
      patient_id: 'ref:patients!', practitioner_id: 'ref:practitioners', date: 'date!', area: 'str',
      subjective: 'text', objective: 'text', assessment: 'text', plan: 'text',
    },
  },
  expenses: { table: 'expenses', fields: { date: 'date!', category: 'str!', description: 'str', amount: 'money!', method: 'str' } },
};

async function assertOwned(table, id, clinicId, label, runner = db) {
  const row = await runner.get(`SELECT id FROM ${table} WHERE id = ? AND clinic_id = ?`, id, clinicId);
  if (!row) throw new HttpError(400, `Selected ${label} was not found.`);
}

async function cleanFields(res, body, clinicId, partial) {
  const out = {};
  for (const [name, spec] of Object.entries(res.fields)) {
    const required = spec.endsWith('!');
    const type = spec.replace('!', '');
    const label = name.replace(/_id$/, '').replace(/_/g, ' ');
    if (!(name in body)) {
      if (required && !partial) throw new HttpError(400, `Please fill in ${label}.`);
      continue;
    }
    let v = body[name];
    if (v === '' || v === undefined) v = null;
    if (v === null) {
      if (required) throw new HttpError(400, `Please fill in ${label}.`);
      out[name] = null;
      continue;
    }
    if (typeof v === 'object') throw new HttpError(400, `Invalid ${label}.`);
    if (type === 'str') v = str(v, 300);
    else if (type === 'text') v = str(v, 20000);
    else if (type === 'date') { if (!isDate(v)) throw new HttpError(400, `Invalid ${label}.`); }
    else if (type === 'datetime') { if (!isDateTime(v)) throw new HttpError(400, `Invalid ${label}.`); }
    else if (type === 'int') v = Math.max(0, Math.min(100000, Math.round(Number(v) || 0)));
    else if (type === 'money') v = Math.max(-1e12, Math.min(1e12, toCents(v)));
    else if (type === 'bool') v = v ? 1 : 0;
    else if (type.startsWith('ref:')) { v = String(v); await assertOwned(type.slice(4), v, clinicId, label); }
    if (required && v === null) throw new HttpError(400, `Please fill in ${label}.`);
    out[name] = v;
  }
  if (res.table === 'appointments' && out.status && !APPT_STATUSES.includes(out.status))
    throw new HttpError(400, 'Invalid appointment status.');
  return out;
}

async function getOne(table, id, clinicId) {
  const row = await db.get(`SELECT * FROM ${table} WHERE id = ? AND clinic_id = ?`, String(id), clinicId);
  if (!row) throw new HttpError(404, 'Record not found.');
  return decryptRow(table, row);
}

const APPT_SELECT = `SELECT a.*, ${fullNameSql('p')} AS patient_name, p.phone AS patient_phone,
    pr.name AS practitioner_name, pr.color AS practitioner_color, s.name AS service_name
  FROM appointments a
  JOIN patients p ON p.id = a.patient_id
  LEFT JOIN practitioners pr ON pr.id = a.practitioner_id
  LEFT JOIN services s ON s.id = a.service_id`;

async function listResource(name, clinicId, q) {
  const p = [clinicId];
  let sql;
  const limit = Math.min(Number(q.get('limit')) || 1000, 5000);
  const search = String(q.get('q') || '').trim().toLowerCase();
  if (name === 'patients') {
    sql = `SELECT p.*,
             (SELECT MAX(starts_at) FROM appointments a WHERE a.patient_id = p.id AND a.status != 'cancelled') AS last_visit,
             (SELECT COALESCE(SUM(total - paid), 0) FROM invoices i WHERE i.patient_id = p.id) AS balance
           FROM patients p WHERE p.clinic_id = ?`;
    if (search) {
      const like = `%${likeEscape(search)}%`;
      sql += ` AND (${fullNameSql('p')} ILIKE ? OR p.phone ILIKE ? OR p.email ILIKE ?)`;
      p.push(like, like, like);
    }
    sql += ` ORDER BY lower(p.first_name), lower(COALESCE(p.last_name, '')) LIMIT ${limit}`;
    return decryptRows('patients', await db.all(sql, ...p));
  }
  if (name === 'appointments') {
    sql = `${APPT_SELECT} WHERE a.clinic_id = ?`;
    if (q.get('from')) { sql += ' AND a.starts_at >= ?'; p.push(q.get('from')); }
    if (q.get('to')) { sql += ' AND a.starts_at < ?'; p.push(q.get('to')); }
    if (q.get('patient_id')) { sql += ' AND a.patient_id = ?'; p.push(q.get('patient_id')); }
    if (q.get('practitioner_id')) { sql += ' AND a.practitioner_id = ?'; p.push(q.get('practitioner_id')); }
    sql += q.get('order') === 'desc' ? ' ORDER BY a.starts_at DESC' : ' ORDER BY a.starts_at';
    return decryptRows('appointments', await db.all(`${sql} LIMIT ${limit}`, ...p));
  }
  if (name === 'notes') {
    sql = `SELECT n.*, ${fullNameSql('p')} AS patient_name, pr.name AS practitioner_name
           FROM clinical_notes n JOIN patients p ON p.id = n.patient_id
           LEFT JOIN practitioners pr ON pr.id = n.practitioner_id WHERE n.clinic_id = ?`;
    if (q.get('patient_id')) { sql += ' AND n.patient_id = ?'; p.push(q.get('patient_id')); }
    sql += ' ORDER BY n.date DESC, n.created_at DESC';
    let rows = decryptRows('clinical_notes', await db.all(sql, ...p));
    // note text is encrypted, so searching happens after decryption
    if (search) rows = rows.filter((n) => ['patient_name', 'area', 'subjective', 'objective', 'assessment', 'plan'].some((k) => contains(n[k], search)));
    return rows.slice(0, limit);
  }
  if (name === 'expenses') {
    sql = 'SELECT * FROM expenses WHERE clinic_id = ?';
    if (q.get('from')) { sql += ' AND date >= ?'; p.push(q.get('from')); }
    if (q.get('to')) { sql += ' AND date <= ?'; p.push(q.get('to')); }
    sql += ' ORDER BY date DESC, created_at DESC';
    return db.all(`${sql} LIMIT ${limit}`, ...p);
  }
  return db.all(`SELECT * FROM ${RESOURCES[name].table} WHERE clinic_id = ? ORDER BY active DESC, lower(name) LIMIT ${limit}`, ...p);
}

async function createResource(name, clinicId, body) {
  const res = RESOURCES[name];
  const data = await cleanFields(res, body, clinicId, false);
  if (name === 'appointments' && !data.status) data.status = 'scheduled';
  if ((name === 'practitioners' || name === 'services') && !('active' in data)) data.active = 1;
  const row = encryptFields(res.table, { id: uid(), clinic_id: clinicId, ...data, created_at: now() });
  const cols = Object.keys(row);
  await db.run(`INSERT INTO ${res.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...Object.values(row));
  return getOne(res.table, row.id, clinicId);
}

async function updateResource(name, clinicId, id, body) {
  const res = RESOURCES[name];
  await getOne(res.table, id, clinicId);
  const data = encryptFields(res.table, await cleanFields(res, body, clinicId, true));
  const cols = Object.keys(data);
  if (cols.length) {
    await db.run(`UPDATE ${res.table} SET ${cols.map((c) => `${c} = ?`).join(',')} WHERE id = ? AND clinic_id = ?`,
      ...Object.values(data), id, clinicId);
  }
  return getOne(res.table, id, clinicId);
}

async function deleteResource(name, clinicId, id) {
  const res = RESOURCES[name];
  await getOne(res.table, id, clinicId);
  const docs = await tx(async (t) => {
    let removed = [];
    if (name === 'patients') {
      const inv = await t.get('SELECT COUNT(*) AS n FROM invoices WHERE patient_id = ? AND clinic_id = ?', id, clinicId);
      if (inv.n) throw new HttpError(409, 'This patient has invoices. Delete their invoices first.');
      await t.run('DELETE FROM appointments WHERE patient_id = ? AND clinic_id = ?', id, clinicId);
      await t.run('DELETE FROM clinical_notes WHERE patient_id = ? AND clinic_id = ?', id, clinicId);
      removed = await t.all('SELECT id, ext FROM documents WHERE patient_id = ? AND clinic_id = ?', id, clinicId);
      await t.run('DELETE FROM documents WHERE patient_id = ? AND clinic_id = ?', id, clinicId);
    }
    if (name === 'practitioners') {
      await t.run('UPDATE appointments SET practitioner_id = NULL WHERE practitioner_id = ? AND clinic_id = ?', id, clinicId);
      await t.run('UPDATE clinical_notes SET practitioner_id = NULL WHERE practitioner_id = ? AND clinic_id = ?', id, clinicId);
    }
    if (name === 'services') {
      await t.run('UPDATE appointments SET service_id = NULL WHERE service_id = ? AND clinic_id = ?', id, clinicId);
    }
    await t.run(`DELETE FROM ${res.table} WHERE id = ? AND clinic_id = ?`, id, clinicId);
    return removed;
  });
  // files are removed only after the database delete succeeded
  if (docs.length) await storage.remove(docs.map((d) => docKey(clinicId, d))).catch((e) => console.error(e.message));
  return { ok: true };
}

async function patientSummary(clinicId, patientId) {
  const patient = await getOne('patients', patientId, clinicId);
  const qp = new URLSearchParams({ patient_id: patient.id, order: 'desc' });
  const [appointments, notes, invoices, documents] = await Promise.all([
    listResource('appointments', clinicId, qp),
    listResource('notes', clinicId, qp),
    db.all('SELECT * FROM invoices WHERE patient_id = ? AND clinic_id = ? ORDER BY date DESC', patient.id, clinicId),
    listDocuments(clinicId, new URLSearchParams({ patient_id: patient.id })),
  ]);
  return { patient, appointments, notes, invoices, documents };
}

// ---------------------------------------------------------------- documents (encrypted files + OCR text)

const docKey = (clinicId, doc) => `${clinicId}/${doc.id}.${doc.ext}`;

async function listDocuments(clinicId, q) {
  let sql = `SELECT d.id, d.patient_id, d.title, d.category, d.filename, d.mime, d.size, d.ocr_lang, d.created_at, d.ocr_text,
      ${fullNameSql('p')} AS patient_name
    FROM documents d JOIN patients p ON p.id = d.patient_id WHERE d.clinic_id = ?`;
  const params = [clinicId];
  if (q.get('patient_id')) { sql += ' AND d.patient_id = ?'; params.push(q.get('patient_id')); }
  if (q.get('category')) { sql += ' AND d.category = ?'; params.push(q.get('category')); }
  sql += ' ORDER BY d.created_at DESC';
  const search = String(q.get('q') || '').trim().toLowerCase();
  let rows = decryptRows('documents', await db.all(sql, ...params));
  if (search) rows = rows.filter((d) => contains(d.ocr_text, search) || contains(d.title, search) || contains(d.patient_name, search));
  return rows.slice(0, Math.min(Number(q.get('limit')) || 500, 2000)).map(({ ocr_text, ...d }) => ({
    ...d, snippet: (ocr_text || '').slice(0, 240), text_length: (ocr_text || '').length,
  }));
}

async function getDocument(id, clinicId) {
  const d = await db.get(`SELECT d.*, ${fullNameSql('p')} AS patient_name
    FROM documents d JOIN patients p ON p.id = d.patient_id WHERE d.id = ? AND d.clinic_id = ?`, String(id), clinicId);
  if (!d) throw new HttpError(404, 'Document not found.');
  return decryptRow('documents', d);
}

async function readDocumentFile(clinicId, doc) {
  const raw = await storage.get(docKey(clinicId, doc));
  if (!raw) throw new HttpError(404, 'The file is missing from storage.');
  return decryptBuffer(raw);
}

function cleanDocFields(body, partial) {
  const out = {};
  if (!partial || 'title' in body) out.title = str(body.title, 200);
  if (!partial || 'category' in body) out.category = DOC_CATEGORIES.includes(body.category) ? body.category : 'Other';
  if ('ocr_text' in body) out.ocr_text = str(body.ocr_text, 200000);
  if ('ocr_lang' in body) out.ocr_lang = str(body.ocr_lang, 40);
  return out;
}

async function uploadDocument(req, clinicId, patientId, q) {
  await getOne('patients', patientId, clinicId);
  const buf = await readRaw(req, MAX_UPLOAD);
  const kind = sniffFile(buf);
  if (!kind) throw new HttpError(400, 'Only photos (JPG, PNG, WEBP) and PDF files can be uploaded.');
  const meta = cleanDocFields({ title: q.get('title'), category: q.get('category') }, false);
  const doc = {
    id: uid(), clinic_id: clinicId, patient_id: patientId, title: meta.title, category: meta.category,
    filename: str(q.get('filename'), 200), mime: kind.mime, ext: kind.ext, size: buf.length, created_at: now(),
  };
  await storage.put(docKey(clinicId, doc), encryptBuffer(buf));     // stored encrypted
  try {
    const cols = Object.keys(doc);
    await db.run(`INSERT INTO documents (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...Object.values(doc));
  } catch (err) {
    await storage.remove(docKey(clinicId, doc)).catch(() => {});
    throw err;
  }
  return getDocument(doc.id, clinicId);
}

async function updateDocument(clinicId, id, body) {
  const d = await getDocument(id, clinicId);
  const data = encryptFields('documents', cleanDocFields(body, true));
  const cols = Object.keys(data);
  if (cols.length) {
    await db.run(`UPDATE documents SET ${cols.map((c) => `${c} = ?`).join(',')} WHERE id = ? AND clinic_id = ?`, ...Object.values(data), d.id, clinicId);
  }
  return getDocument(d.id, clinicId);
}

async function deleteDocument(clinicId, id) {
  const d = await getDocument(id, clinicId);
  await db.run('DELETE FROM documents WHERE id = ? AND clinic_id = ?', d.id, clinicId);
  await storage.remove(docKey(clinicId, d)).catch((e) => console.error(e.message));
  return { ok: true };
}

// ---------------------------------------------------------------- invoices & payments

function invoiceStatus(total, paid) {
  if (paid >= total && total > 0) return 'paid';
  if (paid > 0) return 'partial';
  return total === 0 ? 'paid' : 'unpaid';
}

async function buildInvoice(body, clinicId) {
  if (!body.patient_id) throw new HttpError(400, 'Please choose a patient.');
  await assertOwned('patients', String(body.patient_id), clinicId, 'patient');
  if (!isDate(body.date)) throw new HttpError(400, 'Invalid invoice date.');
  if (body.due_date && !isDate(body.due_date)) throw new HttpError(400, 'Invalid due date.');
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 200)
    .map((it) => ({
      service_id: it && it.service_id ? String(it.service_id) : null,
      description: str(it && it.description, 300) || '',
      qty: Math.max(0, Math.min(100000, Number(it && it.qty) || 0)),
      unit_price: Math.max(0, Math.min(1e12, toCents(it && it.unit_price))),
    }))
    .filter((it) => it.description && it.qty > 0);
  if (!items.length) throw new HttpError(400, 'Add at least one line item.');
  const subtotal = items.reduce((s, it) => s + Math.round(it.qty * it.unit_price), 0);
  const discount = Math.min(Math.max(0, toCents(body.discount)), subtotal);
  const taxRate = Math.max(0, Math.min(100, Number(body.tax_rate) || 0));
  const tax = Math.round(((subtotal - discount) * taxRate) / 100);
  return {
    patient_id: String(body.patient_id), date: body.date, due_date: body.due_date || null,
    items: JSON.stringify(items), subtotal, discount, tax_rate: taxRate, tax,
    total: subtotal - discount + tax, notes: str(body.notes, 5000),
  };
}

async function listInvoices(clinicId, q) {
  let sql = `SELECT i.id, i.number, i.date, i.due_date, i.total, i.paid, i.status, i.patient_id, ${fullNameSql('p')} AS patient_name
    FROM invoices i JOIN patients p ON p.id = i.patient_id WHERE i.clinic_id = ?`;
  const params = [clinicId];
  if (q.get('status')) { sql += ' AND i.status = ?'; params.push(q.get('status')); }
  if (q.get('q')) {
    const like = `%${likeEscape(q.get('q'))}%`;
    sql += ` AND (i.number ILIKE ? OR ${fullNameSql('p')} ILIKE ?)`;
    params.push(like, like);
  }
  return db.all(`${sql} ORDER BY i.date DESC, i.number DESC LIMIT 2000`, ...params);
}

async function invoiceWithDetails(id, clinicId, runner = db) {
  const inv = await runner.get(`SELECT i.*, ${fullNameSql('p')} AS patient_name,
      p.phone AS patient_phone, p.email AS patient_email, p.address AS patient_address
    FROM invoices i JOIN patients p ON p.id = i.patient_id WHERE i.id = ? AND i.clinic_id = ?`, String(id), clinicId);
  if (!inv) throw new HttpError(404, 'Invoice not found.');
  inv.patient_address = decrypt(inv.patient_address);
  inv.items = JSON.parse(inv.items);
  inv.payments = await runner.all('SELECT * FROM payments WHERE invoice_id = ? AND clinic_id = ? ORDER BY date, created_at', inv.id, clinicId);
  return inv;
}

async function createInvoice(clinicId, body) {
  const data = await buildInvoice(body, clinicId);
  const id = uid();
  await tx(async (t) => {
    // the counter is incremented and read in one statement, so two invoices can never get the same number
    const { invoice_seq: seq } = await t.get('UPDATE clinics SET invoice_seq = invoice_seq + 1 WHERE id = ? RETURNING invoice_seq', clinicId);
    await t.run(`INSERT INTO invoices (id, clinic_id, number, patient_id, date, due_date, items, subtotal, discount, tax_rate, tax, total, paid, status, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    id, clinicId, `INV-${String(seq).padStart(4, '0')}`, data.patient_id, data.date, data.due_date, data.items,
    data.subtotal, data.discount, data.tax_rate, data.tax, data.total, invoiceStatus(data.total, 0), data.notes, now());
  });
  return invoiceWithDetails(id, clinicId);
}

async function updateInvoice(clinicId, id, body) {
  const existing = await getOne('invoices', id, clinicId);
  const data = await buildInvoice(body, clinicId);
  if (data.total < existing.paid) throw new HttpError(400, 'New total is less than the amount already paid.');
  await db.run(`UPDATE invoices SET patient_id = ?, date = ?, due_date = ?, items = ?, subtotal = ?, discount = ?, tax_rate = ?, tax = ?, total = ?, status = ?, notes = ? WHERE id = ?`,
    data.patient_id, data.date, data.due_date, data.items, data.subtotal, data.discount, data.tax_rate,
    data.tax, data.total, invoiceStatus(data.total, existing.paid), data.notes, existing.id);
  return invoiceWithDetails(existing.id, clinicId);
}

async function deleteInvoice(clinicId, id) {
  const inv = await getOne('invoices', id, clinicId);
  await tx(async (t) => {
    await t.run('DELETE FROM payments WHERE invoice_id = ? AND clinic_id = ?', inv.id, clinicId);
    await t.run('DELETE FROM invoices WHERE id = ? AND clinic_id = ?', inv.id, clinicId);
  });
  return { ok: true };
}

async function refreshInvoicePaid(t, invoiceId, clinicId) {
  const { s } = await t.get('SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE invoice_id = ? AND clinic_id = ?', invoiceId, clinicId);
  const inv = await t.get('SELECT total FROM invoices WHERE id = ?', invoiceId);
  await t.run('UPDATE invoices SET paid = ?, status = ? WHERE id = ?', s, invoiceStatus(inv.total, s), invoiceId);
}

async function listPayments(clinicId, q) {
  const params = [clinicId];
  let sql = `SELECT pay.*, i.number AS invoice_number, ${fullNameSql('p')} AS patient_name
    FROM payments pay JOIN invoices i ON i.id = pay.invoice_id JOIN patients p ON p.id = pay.patient_id WHERE pay.clinic_id = ?`;
  if (q.get('from')) { sql += ' AND pay.date >= ?'; params.push(q.get('from')); }
  if (q.get('to')) { sql += ' AND pay.date <= ?'; params.push(q.get('to')); }
  return db.all(`${sql} ORDER BY pay.date DESC, pay.created_at DESC LIMIT 2000`, ...params);
}

async function addPayment(clinicId, body) {
  const amount = toCents(body.amount);
  if (amount <= 0) throw new HttpError(400, 'Payment amount must be more than zero.');
  if (!isDate(body.date)) throw new HttpError(400, 'Invalid payment date.');
  const invoiceId = String(body.invoice_id || '');
  await tx(async (t) => {
    // lock the invoice row so two payments at the same time can't overpay it
    const inv = await t.get('SELECT * FROM invoices WHERE id = ? AND clinic_id = ? FOR UPDATE', invoiceId, clinicId);
    if (!inv) throw new HttpError(404, 'Record not found.');
    if (amount > inv.total - inv.paid) throw new HttpError(400, 'Payment is more than the balance due.');
    await t.run('INSERT INTO payments (id, clinic_id, invoice_id, patient_id, date, amount, method, reference, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      uid(), clinicId, inv.id, inv.patient_id, body.date, amount, str(body.method, 50), str(body.reference, 200), now());
    await refreshInvoicePaid(t, inv.id, clinicId);
  });
  return invoiceWithDetails(invoiceId, clinicId);
}

async function deletePayment(clinicId, id) {
  const pay = await getOne('payments', id, clinicId);
  await tx(async (t) => {
    await t.run('DELETE FROM payments WHERE id = ?', pay.id);
    await refreshInvoicePaid(t, pay.invoice_id, clinicId);
  });
  return invoiceWithDetails(pay.invoice_id, clinicId);
}

// ---------------------------------------------------------------- dashboard & reports

async function dashboard(clinicId, today) {
  if (!isDate(today)) today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const v = async (sql, ...p) => (await db.get(sql, clinicId, ...p)).v;
  const apptQuery = `${APPT_SELECT} WHERE a.clinic_id = ? AND a.starts_at >= ? AND a.starts_at < ? ORDER BY a.starts_at`;
  const monthKeys = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(`${month}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - i);
    monthKeys.push(d.toISOString().slice(0, 7));
  }
  const first = `${monthKeys[0]}-01`;
  const [inc, exp, patients, newPatients, apptToday, apptWeek, incMonth, expMonth, outstanding, todayList, upcoming, overdue] = await Promise.all([
    db.all("SELECT substr(date,1,7) AS m, SUM(amount) AS v FROM payments WHERE clinic_id = ? AND date >= ? GROUP BY 1", clinicId, first),
    db.all("SELECT substr(date,1,7) AS m, SUM(amount) AS v FROM expenses WHERE clinic_id = ? AND date >= ? GROUP BY 1", clinicId, first),
    v('SELECT COUNT(*) AS v FROM patients WHERE clinic_id = ?'),
    v('SELECT COUNT(*) AS v FROM patients WHERE clinic_id = ? AND substr(created_at,1,7) = ?', month),
    v("SELECT COUNT(*) AS v FROM appointments WHERE clinic_id = ? AND substr(starts_at,1,10) = ? AND status != 'cancelled'", today),
    v("SELECT COUNT(*) AS v FROM appointments WHERE clinic_id = ? AND starts_at >= ? AND starts_at < ? AND status != 'cancelled'", today, addDays(today, 7)),
    v('SELECT COALESCE(SUM(amount),0) AS v FROM payments WHERE clinic_id = ? AND substr(date,1,7) = ?', month),
    v('SELECT COALESCE(SUM(amount),0) AS v FROM expenses WHERE clinic_id = ? AND substr(date,1,7) = ?', month),
    v('SELECT COALESCE(SUM(total - paid),0) AS v FROM invoices WHERE clinic_id = ?'),
    db.all(apptQuery, clinicId, today, addDays(today, 1)),
    db.all(`${apptQuery} LIMIT 8`, clinicId, addDays(today, 1), addDays(today, 8)),
    db.all(`SELECT i.id, i.number, i.due_date, i.total - i.paid AS balance, ${fullNameSql('p')} AS patient_name
      FROM invoices i JOIN patients p ON p.id = i.patient_id
      WHERE i.clinic_id = ? AND i.status != 'paid' AND i.due_date IS NOT NULL AND i.due_date < ?
      ORDER BY i.due_date LIMIT 6`, clinicId, today),
  ]);
  const byMonth = (rows) => Object.fromEntries(rows.map((r) => [r.m, r.v]));
  const incM = byMonth(inc);
  const expM = byMonth(exp);
  return {
    today,
    stats: {
      patients, new_patients_month: newPatients, appointments_today: apptToday, appointments_week: apptWeek,
      income_month: incMonth, expenses_month: expMonth, outstanding,
    },
    today_appointments: decryptRows('appointments', todayList),
    upcoming: decryptRows('appointments', upcoming),
    overdue,
    months: monthKeys.map((m) => ({ month: m, income: incM[m] || 0, expenses: expM[m] || 0 })),
  };
}

async function reports(clinicId, from, to) {
  if (!isDate(from) || !isDate(to)) throw new HttpError(400, 'Choose a valid date range.');
  const all = (sql, ...p) => db.all(sql, clinicId, ...p);
  const v = async (sql, ...p) => (await db.get(sql, clinicId, ...p)).v;
  const toTs = addDays(to, 1);
  const [income, expenses, invoices, newPatients, byMonth, byMethod, expByCat, apptByStatus, apptByPrac, outstanding] = await Promise.all([
    v('SELECT COALESCE(SUM(amount),0) AS v FROM payments WHERE clinic_id = ? AND date BETWEEN ? AND ?', from, to),
    v('SELECT COALESCE(SUM(amount),0) AS v FROM expenses WHERE clinic_id = ? AND date BETWEEN ? AND ?', from, to),
    all('SELECT items, discount, total FROM invoices WHERE clinic_id = ? AND date BETWEEN ? AND ?', from, to),
    v('SELECT COUNT(*) AS v FROM patients WHERE clinic_id = ? AND substr(created_at,1,10) BETWEEN ? AND ?', from, to),
    all(`SELECT m, SUM(inc) AS income, SUM(exp) AS expenses FROM (
        SELECT substr(date,1,7) AS m, amount AS inc, 0 AS exp FROM payments WHERE clinic_id = ?1 AND date BETWEEN ?2 AND ?3
        UNION ALL
        SELECT substr(date,1,7), 0, amount FROM expenses WHERE clinic_id = ?1 AND date BETWEEN ?2 AND ?3
      ) x GROUP BY m ORDER BY m`, from, to),
    all(`SELECT COALESCE(method,'Other') AS method, SUM(amount) AS amount, COUNT(*) AS count
      FROM payments WHERE clinic_id = ? AND date BETWEEN ? AND ? GROUP BY 1 ORDER BY 2 DESC`, from, to),
    all(`SELECT category, SUM(amount) AS amount FROM expenses
      WHERE clinic_id = ? AND date BETWEEN ? AND ? GROUP BY category ORDER BY amount DESC`, from, to),
    all(`SELECT status, COUNT(*) AS count FROM appointments
      WHERE clinic_id = ? AND starts_at >= ? AND starts_at < ? GROUP BY status`, from, toTs),
    all(`SELECT COALESCE(pr.name,'Unassigned') AS name, pr.color, COUNT(*) AS count,
        SUM(CASE WHEN a.status = 'completed' THEN 1 ELSE 0 END) AS completed
      FROM appointments a LEFT JOIN practitioners pr ON pr.id = a.practitioner_id
      WHERE a.clinic_id = ? AND a.starts_at >= ? AND a.starts_at < ? AND a.status != 'cancelled'
      GROUP BY 1, 2 ORDER BY 3 DESC`, from, toTs),
    all(`SELECT p.id, ${fullNameSql('p')} AS name, p.phone, SUM(i.total - i.paid) AS balance, COUNT(*) AS invoices
      FROM invoices i JOIN patients p ON p.id = i.patient_id
      WHERE i.clinic_id = ? AND i.status != 'paid' GROUP BY p.id ORDER BY balance DESC LIMIT 50`),
  ]);
  const byService = {};
  for (const inv of invoices) {
    for (const it of JSON.parse(inv.items)) {
      const k = it.description;
      byService[k] = byService[k] || { name: k, qty: 0, amount: 0 };
      byService[k].qty += it.qty;
      byService[k].amount += Math.round(it.qty * it.unit_price);
    }
  }
  return {
    from, to, income, expenses, net: income - expenses,
    invoiced: invoices.reduce((s, i) => s + i.total, 0),
    invoice_count: invoices.length,
    new_patients: newPatients,
    by_month: byMonth,
    by_service: Object.values(byService).sort((a, b) => b.amount - a.amount),
    by_payment_method: byMethod,
    expenses_by_category: expByCat,
    appointments_by_status: apptByStatus,
    appointments_by_practitioner: apptByPrac,
    outstanding,
  };
}

// ---------------------------------------------------------------- exports (shared by CSV and Excel)
// Column types: text | date | datetime | money (cents) | number

const EXPORTS = {
  patients: {
    title: 'Patients',
    columns: [['first_name', 'First name'], ['last_name', 'Last name'], ['dob', 'Date of birth', 'date'], ['gender', 'Gender'],
      ['phone', 'Phone'], ['email', 'Email'], ['address', 'Address'], ['emergency_contact', 'Emergency contact'],
      ['insurance', 'Insurance'], ['allergies', 'Allergies'], ['medical_history', 'Medical history'], ['medications', 'Medications'],
      ['notes', 'Notes'], ['created_at', 'Registered', 'datetime']],
    rows: async (cid) => decryptRows('patients', await db.all('SELECT * FROM patients WHERE clinic_id = ? ORDER BY lower(first_name)', cid)),
  },
  appointments: {
    title: 'Appointments',
    columns: [['starts_at', 'Date & time', 'datetime'], ['duration_min', 'Minutes', 'number'], ['status', 'Status'], ['patient', 'Patient'],
      ['practitioner', 'Practitioner'], ['service', 'Service'], ['notes', 'Notes']],
    rows: async (cid) => decryptRows('appointments', await db.all(`SELECT a.starts_at, a.duration_min, a.status, ${fullNameSql('p')} AS patient,
        pr.name AS practitioner, s.name AS service, a.notes FROM appointments a JOIN patients p ON p.id = a.patient_id
        LEFT JOIN practitioners pr ON pr.id = a.practitioner_id LEFT JOIN services s ON s.id = a.service_id
        WHERE a.clinic_id = ? ORDER BY a.starts_at`, cid)),
  },
  notes: {
    title: 'Clinical notes',
    columns: [['date', 'Date', 'date'], ['patient', 'Patient'], ['practitioner', 'Practitioner'], ['area', 'Area'],
      ['subjective', 'Subjective'], ['objective', 'Objective'], ['assessment', 'Assessment'], ['plan', 'Plan']],
    rows: async (cid) => decryptRows('clinical_notes', await db.all(`SELECT n.date, ${fullNameSql('p')} AS patient, pr.name AS practitioner,
        n.area, n.subjective, n.objective, n.assessment, n.plan FROM clinical_notes n
        JOIN patients p ON p.id = n.patient_id LEFT JOIN practitioners pr ON pr.id = n.practitioner_id
        WHERE n.clinic_id = ? ORDER BY n.date`, cid)),
  },
  invoices: {
    title: 'Invoices',
    columns: [['number', 'Invoice'], ['date', 'Date', 'date'], ['due_date', 'Due', 'date'], ['patient', 'Patient'],
      ['subtotal', 'Subtotal', 'money'], ['discount', 'Discount', 'money'], ['tax', 'Tax', 'money'], ['total', 'Total', 'money'],
      ['paid', 'Paid', 'money'], ['balance', 'Balance', 'money'], ['status', 'Status']],
    rows: (cid) => db.all(`SELECT i.*, ${fullNameSql('p')} AS patient, i.total - i.paid AS balance FROM invoices i
        JOIN patients p ON p.id = i.patient_id WHERE i.clinic_id = ? ORDER BY i.date`, cid),
  },
  payments: {
    title: 'Payments',
    columns: [['date', 'Date', 'date'], ['invoice', 'Invoice'], ['patient', 'Patient'], ['amount', 'Amount', 'money'],
      ['method', 'Method'], ['reference', 'Reference']],
    rows: (cid) => db.all(`SELECT pay.*, i.number AS invoice, ${fullNameSql('p')} AS patient
        FROM payments pay JOIN invoices i ON i.id = pay.invoice_id JOIN patients p ON p.id = pay.patient_id
        WHERE pay.clinic_id = ? ORDER BY pay.date`, cid),
  },
  expenses: {
    title: 'Expenses',
    columns: [['date', 'Date', 'date'], ['category', 'Category'], ['description', 'Description'], ['amount', 'Amount', 'money'], ['method', 'Paid by']],
    rows: (cid) => db.all('SELECT * FROM expenses WHERE clinic_id = ? ORDER BY date', cid),
  },
  documents: {
    title: 'Documents',
    columns: [['created_at', 'Uploaded', 'datetime'], ['patient', 'Patient'], ['title', 'Title'], ['category', 'Category'],
      ['filename', 'File name'], ['ocr_text', 'Text read from picture']],
    rows: async (cid) => decryptRows('documents', await db.all(`SELECT d.created_at, d.title, d.category, d.filename, d.ocr_text,
        ${fullNameSql('p')} AS patient FROM documents d JOIN patients p ON p.id = d.patient_id
        WHERE d.clinic_id = ? ORDER BY d.created_at`, cid)),
  },
};

async function exportTable(what, clinicId) {
  const e = EXPORTS[what];
  if (!e) throw new HttpError(404, 'Unknown export.');
  return { title: e.title, columns: e.columns.map(([key, header, type = 'text']) => ({ key, header, type })), rows: await e.rows(clinicId) };
}

function csv({ columns, rows }) {
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;              // stop spreadsheet formula injection
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const fmt = (v, type) => (type === 'money' && v != null ? (v / 100).toFixed(2) : v);
  return '﻿' + [columns.map((c) => c.header).join(','),
    ...rows.map((r) => columns.map((c) => cell(fmt(r[c.key], c.type))).join(','))].join('\r\n');
}

// ---------------------------------------------------------------- clinic profile

function publicClinic(c) {
  const { password_hash, prev_plan, admin_note, totp_secret, totp_pending, recovery_codes, totp_last_step,
    failed_logins, locked_until, ...rest } = c;
  return { ...rest, totp_enabled: !!c.totp_enabled, recovery_codes_left: JSON.parse(recovery_codes || '[]').length };
}

const loadClinic = (id) => db.get('SELECT * FROM clinics WHERE id = ?', id);

module.exports = {
  RESOURCES, STARTER_SERVICES, DOC_CATEGORIES, APPT_STATUSES, toCents, isDate, isDateTime, addDays, fullNameSql,
  getOne, listResource, createResource, updateResource, deleteResource, patientSummary, assertOwned,
  listDocuments, getDocument, readDocumentFile, uploadDocument, updateDocument, deleteDocument, docKey,
  listInvoices, invoiceWithDetails, createInvoice, updateInvoice, deleteInvoice, listPayments, addPayment, deletePayment,
  dashboard, reports, exportTable, csv, publicClinic, loadClinic,
};
