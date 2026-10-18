// CareDesk clinic server (Node 22.13+). Serves the React app from ./dist and the JSON API.
// Data lives in Supabase (Postgres); the owner panel lives in ../owner-panel and uses the same database.
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, tx, init, now, getSettings } = require('./db');
const { startTwoFactor, enableTwoFactor, requirePasswordAndCode, disableTwoFactor, renewRecoveryCodes } = require('./twofactor');
const sec = require('./security');
const core = require('./core');
const data = require('./data');
const ai = require('./ai');
const excel = require('./excel');
const storage = require('./storage');
const mailer = require('./mailer');
const { scheduleBackups } = require('./backup');

const {
  TRIAL_DAYS, DAY_MS, HttpError, uid, hashPassword, verifyPassword, burnPasswordCheck, normEmail, checkPassword,
  send, readBody, readRaw, checkSameOrigin, createSession, getSession, endSession, endAllSessions, listSessions,
  endSessionById, purgeExpiredSessions, rateLimit, recordAttempt, limit, str, accessFor, staticServer, SECURITY_HEADERS,
} = core;
const { audit } = sec;

const PORT = Number(process.env.PORT) || 3000;
// The public website (site.js) owns "/" and the topic pages; the clinic app itself opens at /app.
const serveStatic = staticServer(path.join(__dirname, 'dist'), { spa: false, appPaths: ['/app', '/app/'] });
const site = require('./site');
const RAW_UPLOAD = [/^\/api\/patients\/[\w-]+\/documents$/, /^\/api\/import\/patients\/preview$/];

const today = () => new Date().toISOString().slice(0, 10);
const fileHeaders = (mime, filename) => ({ 'Content-Type': mime, 'Content-Disposition': `attachment; filename="${filename}"` });
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// ---------------------------------------------------------------- audit naming for writes

function describeWrite(method, p) {
  const parts = p.replace(/^\/api\//, '').split('/');
  const isId = (s) => /^[0-9a-f-]{20,}$/i.test(s || '');
  const verb = { POST: 'create', PUT: 'update', DELETE: 'delete' }[method] || method.toLowerCase();
  if (parts[0] === 'patients' && parts[2] === 'documents') return { action: 'documents.upload', entity: 'patient', entityId: parts[1] };
  if (parts[0] === 'ai' || parts[0] === 'import' || parts[0] === 'account' || parts[0] === 'auth') return null;   // logged explicitly
  return { action: `${parts[0]}.${verb}`, entity: parts[0], entityId: isId(parts[1]) ? parts[1] : null };
}

// ---------------------------------------------------------------- sign-up

const VERIFY_MINUTES = 30;
const MAX_CODE_ATTEMPTS = 5;      // wrong codes allowed per emailed code
const MAX_SENDS = 5;              // emails per sign-up
const RESEND_WAIT_MS = 60000;

const safeEqual = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function createClinic(email, d) {
  const id = uid();
  const t = now();
  try {
    await tx(async (q) => {
      await q.run(`INSERT INTO clinics (id, name, owner_name, email, password_hash, phone, clinic_type, plan, trial_ends_at, created_at, last_login_at, password_changed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'trial', ?, ?, ?, ?)`,
      id, d.name, d.owner_name, email, d.password_hash, d.phone, d.type,
      new Date(Date.now() + TRIAL_DAYS * DAY_MS).toISOString(), t, t, t);
      if (d.owner_name) {
        await q.run('INSERT INTO practitioners (id, clinic_id, name, role, color, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)',
          uid(), id, d.owner_name, d.type === 'dental' ? 'Dentist' : d.type === 'therapy' ? 'Therapist' : 'Practitioner', '#0e7c86', t);
      }
      for (const [n, c, dur, pr] of data.STARTER_SERVICES[d.type] || data.STARTER_SERVICES.other) {
        await q.run('INSERT INTO services (id, clinic_id, name, category, duration_min, price, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
          uid(), id, n, c, dur, pr, t);
      }
    });
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'An account with this email already exists. Please sign in.');   // unique violation
    throw err;
  }
  return id;
}

// Saves (or renews) a pending sign-up and emails a 6-digit code plus a one-click link.
async function startSignupVerification(req, email, details, settings, existing) {
  if (!mailer.emailReady(settings)) {
    throw new HttpError(503, 'New sign-ups are paused for a moment while email is being set up. Please try again later or contact support.');
  }
  const prev = existing || await db.get('SELECT * FROM signup_verifications WHERE email = ?', email);
  const fresh = !prev || prev.expires_at < new Date(Date.now() - DAY_MS).toISOString();   // old leftovers start over
  if (!fresh) {
    const wait = Math.ceil((Date.parse(prev.last_sent_at) + RESEND_WAIT_MS - Date.now()) / 1000);
    if (wait > 0) throw new HttpError(429, `We just sent a code. Please wait ${wait} seconds before asking for another one.`);
    if (prev.sends >= MAX_SENDS) throw new HttpError(429, 'Too many codes were sent to this email. Please try again tomorrow or contact support.');
  }
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const token = crypto.randomBytes(32).toString('base64url');
  const t = now();
  await db.run(`INSERT INTO signup_verifications (email, details, code_hash, token_hash, attempts, sends, last_sent_at, expires_at, created_at, ip)
      VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
    ON CONFLICT (email) DO UPDATE SET details = excluded.details, code_hash = excluded.code_hash, token_hash = excluded.token_hash,
      attempts = 0, sends = excluded.sends, last_sent_at = excluded.last_sent_at, expires_at = excluded.expires_at, ip = excluded.ip`,
  email, JSON.stringify(details), sec.sha256(`${email}:${code}`), sec.sha256(token), fresh ? 1 : prev.sends + 1,
  t, new Date(Date.now() + VERIFY_MINUTES * 60000).toISOString(), t, sec.clientIp(req));
  // The link uses the website address set by the owner (never the request's Host header, which a sender can fake).
  // The token sits after "#", so it is never sent to the server or to ngrok's logs when the link is opened.
  const base = String(settings.public_url || process.env.PUBLIC_URL || '').replace(/\/+$/, '');
  const link = base ? `${base}/app#/verify-email/${token}` : null;
  try {
    await mailer.sendSignupCode(email, code, link, settings);
  } catch (err) {
    if (fresh) await db.run('DELETE FROM signup_verifications WHERE email = ?', email);
    throw err;
  }
}

async function purgeOldSignups() {
  await db.run('DELETE FROM signup_verifications WHERE expires_at < ?', new Date(Date.now() - DAY_MS).toISOString());
}

// ---------------------------------------------------------------- routes

async function handleApi(req, res, url, ctx) {
  const p = url.pathname;
  const m = req.method;
  const q = url.searchParams;

  limit(`api:${sec.clientIp(req)}`, 900, 60000);
  if (m !== 'GET') checkSameOrigin(req);
  // Writes must be JSON (forms from other sites can't send that); file uploads use a custom header instead.
  const isRaw = m === 'POST' && RAW_UPLOAD.some((re) => re.test(p));
  if (isRaw && req.headers['x-caredesk-upload'] !== '1') throw new HttpError(415, 'Invalid upload.');
  if (m !== 'GET' && !isRaw && !String(req.headers['content-type'] || '').includes('application/json')) throw new HttpError(415, 'Expected JSON.');
  const body = m === 'GET' || isRaw ? {} : await readBody(req);

  // ---- public
  if (p === '/api/public-settings' && m === 'GET') {
    const s = await getSettings();
    return send(res, 200, { product_name: s.product_name, support_name: s.support_name,
      support_email: s.support_email, support_phone: s.support_phone, trial_days: TRIAL_DAYS });
  }

  if (p === '/api/auth/register' && m === 'POST') {
    rateLimit(req, 'register');
    recordAttempt(req, 'register');
    checkPassword(body.password);
    const name = str(body.clinic_name, 200);
    if (!name) throw new HttpError(400, 'Please enter your clinic name.');
    const email = await core.checkRealEmail(body.email);
    if (await db.get('SELECT 1 AS x FROM clinics WHERE email = ?', email)) throw new HttpError(409, 'An account with this email already exists. Please sign in.');
    const details = { name, owner_name: str(body.owner_name, 200), phone: str(body.phone, 50),
      type: data.STARTER_SERVICES[body.clinic_type] ? body.clinic_type : 'other', password_hash: hashPassword(body.password) };
    const settings = await getSettings();
    if (settings.signup_verify !== '1') {             // email confirmation is on hold (off) for now
      const id = await createClinic(email, details);
      await audit(req, { clinicId: id, actorId: id, action: 'auth.register' });
      return send(res, 201, { ok: true }, { 'Set-Cookie': await createSession('clinic', id, req) });
    }
    await startSignupVerification(req, email, details, settings);
    return send(res, 202, { verify: true, email, expires_minutes: VERIFY_MINUTES });
  }

  if (p === '/api/auth/register/resend' && m === 'POST') {
    rateLimit(req, 'register');
    recordAttempt(req, 'register');
    const email = normEmail(body.email);
    const row = await db.get('SELECT * FROM signup_verifications WHERE email = ?', email);
    if (!row) throw new HttpError(404, 'We could not find this sign-up. Please fill in the sign-up form again.');
    await startSignupVerification(req, email, JSON.parse(row.details), await getSettings(), row);
    return send(res, 200, { ok: true, expires_minutes: VERIFY_MINUTES });
  }

  if (p === '/api/auth/register/verify' && m === 'POST') {
    rateLimit(req, 'verify');
    let row;
    let how;
    if (body.token) {
      how = 'link';
      row = await db.get('SELECT * FROM signup_verifications WHERE token_hash = ?', sec.sha256(String(body.token)));
      if (!row) { recordAttempt(req, 'verify'); throw new HttpError(400, 'This confirmation link is not valid or was already used. Please sign up again, or sign in if you already confirmed.'); }
    } else {
      how = 'code';
      const email = normEmail(body.email);
      const code = String(body.code || '').replace(/\D/g, '');
      // count the attempt first (atomically), so guessing is limited to MAX_CODE_ATTEMPTS per code
      row = (await db.run(`UPDATE signup_verifications SET attempts = attempts + 1
        WHERE email = ? AND attempts < ? RETURNING *`, email, MAX_CODE_ATTEMPTS)).rows[0];
      if (!row) {
        recordAttempt(req, 'verify');
        const exists = await db.get('SELECT 1 AS x FROM signup_verifications WHERE email = ?', email);
        throw new HttpError(exists ? 429 : 400, exists ? 'Too many wrong codes. Please click "Send a new code".' : 'We could not find this sign-up. Please fill in the sign-up form again.');
      }
      if (code.length !== 6 || !safeEqual(row.code_hash, sec.sha256(`${email}:${code}`))) {
        recordAttempt(req, 'verify');
        throw new HttpError(400, `That code is not correct. ${Math.max(0, MAX_CODE_ATTEMPTS - row.attempts)} tries left.`);
      }
    }
    if (row.expires_at < now()) throw new HttpError(410, 'This code has expired. Please click "Send a new code".');
    // delete first, so a code or link can only ever be used once
    const claimed = (await db.run('DELETE FROM signup_verifications WHERE email = ? AND token_hash = ? RETURNING email', row.email, row.token_hash)).rows[0];
    if (!claimed) throw new HttpError(400, 'This code was already used. Please sign in.');
    const id = await createClinic(row.email, JSON.parse(row.details));
    await audit(req, { clinicId: id, actorId: id, action: 'auth.register', detail: `email confirmed by ${how}` });
    return send(res, 201, { ok: true }, { 'Set-Cookie': await createSession('clinic', id, req) });
  }

  if (p === '/api/auth/login' && m === 'POST') {
    rateLimit(req);
    const c = await db.get('SELECT * FROM clinics WHERE email = ?', String(body.email || '').trim().toLowerCase());
    const locked = sec.lockMessage(c);
    if (locked) throw new HttpError(429, locked);
    if (!c) burnPasswordCheck(body.password);
    if (!c || !verifyPassword(body.password || '', c.password_hash)) {
      recordAttempt(req);
      await sec.registerFailure('clinics', c);
      if (c) await audit(req, { clinicId: c.id, action: 'auth.login_failed', detail: 'wrong password' });
      throw new HttpError(401, 'Incorrect email or password.');
    }
    if (c.totp_enabled) {
      return send(res, 200, { mfa_required: true }, { 'Set-Cookie': await createSession('clinic_mfa', c.id, req) });
    }
    await sec.clearFailures('clinics', c.id);
    await db.run('UPDATE clinics SET last_login_at = ? WHERE id = ?', now(), c.id);
    await audit(req, { clinicId: c.id, actorId: c.id, action: 'auth.login' });
    return send(res, 200, { ok: true }, { 'Set-Cookie': await createSession('clinic', c.id, req) });
  }

  if (p === '/api/auth/login/2fa' && m === 'POST') {
    rateLimit(req);
    const pend = await getSession(req, 'clinic_mfa');
    if (!pend) throw new HttpError(401, 'Your sign-in expired. Please enter your password again.');
    const c = await db.get('SELECT * FROM clinics WHERE id = ?', pend.subject_id);
    const locked = sec.lockMessage(c);
    if (locked) throw new HttpError(429, locked);
    const r = await sec.checkSecondFactor('clinics', c, body.code);
    if (!r.ok) {
      recordAttempt(req);
      await sec.registerFailure('clinics', c);
      await audit(req, { clinicId: c.id, action: 'auth.login_failed', detail: 'wrong 2FA code' });
      throw new HttpError(401, 'That code is not correct.');
    }
    await sec.clearFailures('clinics', c.id);
    await db.run('UPDATE clinics SET last_login_at = ? WHERE id = ?', now(), c.id);
    await audit(req, { clinicId: c.id, actorId: c.id, action: 'auth.login', detail: r.usedRecovery ? `recovery code used (${r.remaining} left)` : '2FA' });
    return send(res, 200, { ok: true, recovery_codes_left: r.usedRecovery ? r.remaining : undefined },
      { 'Set-Cookie': [await endSession(req, 'clinic_mfa'), await createSession('clinic', c.id, req)] });
  }

  if (p === '/api/auth/logout' && m === 'POST') {
    const s = await getSession(req, 'clinic');
    if (s) await audit(req, { clinicId: s.subject_id, actorId: s.subject_id, action: 'auth.logout' });
    return send(res, 200, { ok: true }, { 'Set-Cookie': await endSession(req, 'clinic') });
  }

  // ---- signed-in clinic
  const session = await getSession(req, 'clinic');
  if (!session) throw new HttpError(401, 'Please sign in.');
  const clinic = await data.loadClinic(session.subject_id);
  if (!clinic) throw new HttpError(401, 'Please sign in.');
  const settings = await getSettings();
  const access = accessFor(clinic, settings);
  const cid = clinic.id;
  ctx.clinicId = cid;

  if (p === '/api/me' && m === 'GET') {
    return send(res, 200, {
      clinic: data.publicClinic(clinic), access, ai: await ai.aiStatus(clinic, ai.aiConfig(settings)),
      product: { name: settings.product_name, support_name: settings.support_name, support_email: settings.support_email, support_phone: settings.support_phone },
    });
  }

  if (!access.can_read) {
    throw new HttpError(403, access.status === 'suspended' ? 'This account is suspended. Please contact support.'
      : 'Your free trial has ended. Please contact support to activate your account.');
  }

  // ---- account security (allowed even after the trial ends)
  if (p === '/api/clinic/password' && m === 'PUT') {
    if (!verifyPassword(body.current || '', clinic.password_hash)) throw new HttpError(400, 'Current password is incorrect.');
    checkPassword(body.password);
    await db.run('UPDATE clinics SET password_hash = ?, password_changed_at = ? WHERE id = ?', hashPassword(body.password), now(), cid);
    await endAllSessions('clinic', cid, session.token);          // sign out every other device
    await audit(req, { clinicId: cid, actorId: cid, action: 'account.password_changed' });
    return send(res, 200, { ok: true });
  }
  if (p === '/api/account/sessions' && m === 'GET') return send(res, 200, await listSessions('clinic', cid, session.token));
  if (p === '/api/account/sessions/others' && m === 'DELETE') {
    await endAllSessions('clinic', cid, session.token);
    await audit(req, { clinicId: cid, actorId: cid, action: 'account.signed_out_other_devices' });
    return send(res, 200, { ok: true });
  }
  let mm;
  if ((mm = p.match(/^\/api\/account\/sessions\/(\w+)$/)) && m === 'DELETE') {
    await endSessionById('clinic', cid, mm[1]);
    await audit(req, { clinicId: cid, actorId: cid, action: 'account.signed_out_device' });
    return send(res, 200, { ok: true });
  }
  if (p === '/api/account/2fa/setup' && m === 'POST') {
    if (!verifyPassword(body.password || '', clinic.password_hash)) throw new HttpError(400, 'Password is incorrect.');
    if (clinic.totp_enabled) throw new HttpError(409, 'Two-step sign-in is already on.');
    return send(res, 200, await startTwoFactor('clinics', clinic, settings.product_name || 'CareDesk', clinic.email));
  }
  if (p === '/api/account/2fa/enable' && m === 'POST') {
    const codes = await enableTwoFactor('clinics', clinic, body.code);
    await endAllSessions('clinic', cid, session.token);
    await audit(req, { clinicId: cid, actorId: cid, action: 'account.2fa_enabled' });
    return send(res, 200, { recovery_codes: codes });
  }
  if (p === '/api/account/2fa/disable' && m === 'POST') {
    await requirePasswordAndCode('clinics', clinic, body);
    await disableTwoFactor('clinics', cid);
    await audit(req, { clinicId: cid, actorId: cid, action: 'account.2fa_disabled' });
    return send(res, 200, { ok: true });
  }
  if (p === '/api/account/2fa/recovery-codes' && m === 'POST') {
    if (!clinic.totp_enabled) throw new HttpError(400, 'Turn on two-step sign-in first.');
    await requirePasswordAndCode('clinics', clinic, body);
    const codes = await renewRecoveryCodes('clinics', cid);
    await audit(req, { clinicId: cid, actorId: cid, action: 'account.recovery_codes_renewed' });
    return send(res, 200, { recovery_codes: codes });
  }
  if (p === '/api/audit' && m === 'GET') {
    const lim = Math.min(Number(q.get('limit')) || 100, 500);
    const before = q.get('before') || '9999';
    return send(res, 200, await db.all(`SELECT id, at, actor, action, entity, entity_id, detail, ip, user_agent FROM audit_log
      WHERE clinic_id = ? AND at < ? ORDER BY at DESC, id DESC LIMIT ?`, cid, before, lim));
  }

  // ---- exports (allowed read-only after the trial)
  if ((mm = p.match(/^\/api\/export\/(\w+)\.(csv|xlsx)$/)) && m === 'GET') {
    const [, what, fmt] = mm;
    const name = `${what}-${today()}.${fmt}`;
    await audit(req, { clinicId: cid, actorId: cid, action: 'data.export', entity: what, detail: fmt });
    if (what === 'report' && fmt === 'xlsx') {
      const buf = await excel.reportXlsx(clinic, q.get('from'), q.get('to'), settings.product_name);
      return send(res, 200, buf, fileHeaders(XLSX, `report-${q.get('from')}-to-${q.get('to')}.xlsx`));
    }
    if (fmt === 'xlsx') return send(res, 200, await excel.exportXlsx(what, clinic, settings.product_name), fileHeaders(XLSX, name));
    if (what === 'all') throw new HttpError(400, 'The full export is available as Excel only.');
    return send(res, 200, data.csv(await data.exportTable(what, cid)), fileHeaders('text/csv; charset=utf-8', name));
  }
  if (p === '/api/import/patients/template.xlsx' && m === 'GET') {
    return send(res, 200, await excel.importTemplate(settings.product_name), fileHeaders(XLSX, 'patient-import-template.xlsx'));
  }

  if (m !== 'GET' && !access.can_write) {
    throw new HttpError(402, 'Your free trial has ended. Your data is safe and viewable, but adding or editing requires activation. Please contact support.');
  }

  // ---- Excel import
  if (p === '/api/import/patients/preview' && m === 'POST') {
    const buf = await readRaw(req, 10_000_000);
    return send(res, 200, await excel.importPreview(cid, buf, q.get('filename')));
  }
  if (p === '/api/import/patients/commit' && m === 'POST') {
    const result = await excel.importCommit(cid, body.token, body.mapping);
    await audit(req, { clinicId: cid, actorId: cid, action: 'patients.import', detail: `${result.created} created, ${result.duplicates} duplicates skipped` });
    return send(res, 200, result);
  }

  // ---- AI assistant (OpenRouter)
  if (p.startsWith('/api/ai/')) {
    const cfg = ai.aiConfig(settings);
    if (p === '/api/ai/status' && m === 'GET') return send(res, 200, await ai.aiStatus(clinic, cfg));
    limit(`ai:${cid}`, 20, 60000, 'Too many AI requests. Please wait a minute.');
    let out;
    if (p === '/api/ai/chat' && m === 'POST') out = await ai.chat(clinic, access, body.messages);
    else if (p === '/api/ai/patient-summary' && m === 'POST') out = await ai.summarizePatient(clinic, access, body.patient_id);
    else if (p === '/api/ai/soap' && m === 'POST') out = await ai.draftSoap(clinic, access, body);
    else if (p === '/api/ai/tidy-document' && m === 'POST') out = await ai.tidyDocument(clinic, access, body.document_id);
    else throw new HttpError(404, 'Not found.');
    await audit(req, { clinicId: cid, actorId: cid, action: `ai.${p.slice(8).replace(/-/g, '_')}`,
      entityId: body.patient_id || body.document_id || null });   // the question text itself is not logged
    return send(res, 200, { ...out, usage: await ai.aiStatus(await data.loadClinic(cid), cfg) });
  }

  // ---- dashboard, reports, profile
  if (p === '/api/dashboard' && m === 'GET') return send(res, 200, await data.dashboard(cid, q.get('today')));
  if (p === '/api/reports' && m === 'GET') return send(res, 200, await data.reports(cid, q.get('from'), q.get('to')));

  if (p === '/api/clinic' && m === 'PUT') {
    const name = str(body.name, 200);
    if (!name) throw new HttpError(400, 'Clinic name is required.');
    let email = normEmail(body.email);
    if (email !== clinic.email) email = await core.checkRealEmail(email);
    if (await db.get('SELECT id FROM clinics WHERE email = ? AND id != ?', email, cid)) throw new HttpError(409, 'That email is already used by another account.');
    await db.run('UPDATE clinics SET name = ?, owner_name = ?, email = ?, phone = ?, address = ?, currency = ?, tax_rate = ?, invoice_footer = ? WHERE id = ?',
      name, str(body.owner_name, 200), email, str(body.phone, 50), str(body.address, 500),
      str(body.currency, 8) || '$', Math.max(0, Math.min(100, Number(body.tax_rate) || 0)), str(body.invoice_footer, 1000), cid);
    return send(res, 200, data.publicClinic(await data.loadClinic(cid)));
  }

  if ((mm = p.match(/^\/api\/patients\/([\w-]+)\/summary$/)) && m === 'GET') {
    const out = await data.patientSummary(cid, mm[1]);
    await audit(req, { clinicId: cid, actorId: cid, action: 'patients.view', entity: 'patients', entityId: mm[1] });
    return send(res, 200, out);
  }

  // ---- invoices & payments
  if (p === '/api/invoices' && m === 'GET') return send(res, 200, await data.listInvoices(cid, q));
  if (p === '/api/invoices' && m === 'POST') return send(res, 201, await data.createInvoice(cid, body));
  if ((mm = p.match(/^\/api\/invoices\/([\w-]+)$/))) {
    if (m === 'GET') return send(res, 200, await data.invoiceWithDetails(mm[1], cid));
    if (m === 'PUT') return send(res, 200, await data.updateInvoice(cid, mm[1], body));
    if (m === 'DELETE') return send(res, 200, await data.deleteInvoice(cid, mm[1]));
  }
  if (p === '/api/payments' && m === 'GET') return send(res, 200, await data.listPayments(cid, q));
  if (p === '/api/payments' && m === 'POST') return send(res, 201, await data.addPayment(cid, body));
  if ((mm = p.match(/^\/api\/payments\/([\w-]+)$/)) && m === 'DELETE') return send(res, 200, await data.deletePayment(cid, mm[1]));

  // ---- documents
  if ((mm = p.match(/^\/api\/patients\/([\w-]+)\/documents$/)) && m === 'POST') {
    return send(res, 201, await data.uploadDocument(req, cid, mm[1], q));
  }
  if (p === '/api/documents' && m === 'GET') return send(res, 200, await data.listDocuments(cid, q));
  if ((mm = p.match(/^\/api\/documents\/([\w-]+)\/file$/)) && m === 'GET') {
    const d = await data.getDocument(mm[1], cid);
    const buf = await data.readDocumentFile(cid, d);
    const name = (d.filename || d.title || 'document').replace(/[^\w.\- ]+/g, '_').replace(/\.\w+$/, '');
    const asAttachment = d.mime === 'application/pdf' || q.get('download') === '1';
    if (asAttachment) await audit(req, { clinicId: cid, actorId: cid, action: 'documents.download', entity: 'documents', entityId: d.id });
    return send(res, 200, buf, {
      'Content-Type': d.mime,
      'Cache-Control': 'private, max-age=3600',
      'Content-Disposition': `${asAttachment ? 'attachment' : 'inline'}; filename="${name}.${d.ext}"`,
      // uploaded files can never run scripts; inline styles only for the browser's own image viewer
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    });
  }
  if ((mm = p.match(/^\/api\/documents\/([\w-]+)$/))) {
    if (m === 'GET') return send(res, 200, await data.getDocument(mm[1], cid));
    if (m === 'PUT') return send(res, 200, await data.updateDocument(cid, mm[1], body));
    if (m === 'DELETE') return send(res, 200, await data.deleteDocument(cid, mm[1]));
  }

  // ---- generic records
  if ((mm = p.match(/^\/api\/(\w+)(?:\/([\w-]+))?$/)) && data.RESOURCES[mm[1]]) {
    const [, name, id] = mm;
    if (!id && m === 'GET') return send(res, 200, await data.listResource(name, cid, q));
    if (!id && m === 'POST') return send(res, 201, await data.createResource(name, cid, body));
    if (id && m === 'GET') {
      if (name === 'patients') await audit(req, { clinicId: cid, actorId: cid, action: 'patients.view', entity: 'patients', entityId: id });
      return send(res, 200, await data.getOne(data.RESOURCES[name].table, id, cid));
    }
    if (id && m === 'PUT') return send(res, 200, await data.updateResource(name, cid, id, body));
    if (id && m === 'DELETE') return send(res, 200, await data.deleteResource(name, cid, id));
  }

  throw new HttpError(404, 'Not found.');
}

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { return send(res, 400, { error: 'Bad request' }); }
  const ctx = {};
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url, ctx);
      // every successful change by a clinic is recorded in the activity log
      if (req.method !== 'GET' && ctx.clinicId && res.statusCode < 400) {
        const w = describeWrite(req.method, url.pathname);
        if (w) await audit(req, { clinicId: ctx.clinicId, actorId: ctx.clinicId, ...w });
      }
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      if (await site.handleSite(req, res, url)) return;
      if (!serveStatic(req, res, url.pathname)) await site.notFound(req, res);
    } else {
      send(res, 405, { error: 'Method not allowed' });
    }
  } catch (err) {
    if (res.headersSent) return;
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    console.error(err);
    const dbDown = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|Connection terminated|timeout exceeded/i.test(String(err && err.message));
    send(res, dbDown ? 503 : 500, { error: dbDown ? 'The database is not reachable right now. Please try again in a moment.' : 'Something went wrong on the server.' });
  }
});
server.headersTimeout = 60000;
server.requestTimeout = 180000;   // AI answers can take a while

(async () => {
  try {
    await require('./db').initWithRetry();
    await sec.verifyKey();
    await storage.ensureBucket();
  } catch (err) {
    console.error(`\n  Could not start: ${err.message}\n`);
    process.exit(1);
  }
  await purgeExpiredSessions();
  await purgeOldSignups();
  await sec.purgeOldAudit();
  setInterval(() => { purgeExpiredSessions().catch(() => {}); purgeOldSignups().catch(() => {}); }, 3600000).unref();
  scheduleBackups();
  server.listen(PORT, async () => {
    console.log(`\n  ${(await getSettings()).product_name} clinic app is running`);
    console.log(`  Open: http://localhost:${PORT}`);
    console.log(`  Database: Supabase / PostgreSQL (schema "${require('./db').SCHEMA}")`);
    console.log(`  Files: ${storage.describe()}`);
    console.log('  (The owner panel is separate: run start.bat in the owner-panel folder.)\n');
  });
})();
