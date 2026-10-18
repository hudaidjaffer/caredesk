// CareDesk Owner Panel: approve, extend and restrict clinic accounts, manage AI and backups.
// Runs separately from the clinic app but uses the same Supabase database (settings in ../clinic-app/.env).
// By default it only accepts connections from this computer (OWNER_HOST=127.0.0.1).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const CLINIC_DIR = path.join(__dirname, '..', 'clinic-app');
const need = (m) => require(path.join(CLINIC_DIR, m));
const { db, init, close, now, getSettings, setSetting, DATA_DIR, SCHEMA } = need('db');
const sec = need('security');
const core = need('core');
const ai = need('ai');
const backup = need('backup');
const tf = need('twofactor');
const storage = need('storage');
const mailer = need('mailer');

const {
  TRIAL_DAYS, DAY_MS, HttpError, uid, hashPassword, verifyPassword, burnPasswordCheck, normEmail, checkPassword, send,
  readBody, checkSameOrigin, createSession, getSession, endSession, endAllSessions, listSessions, rateLimit, recordAttempt,
  limit, str, accessFor, staticServer, SECURITY_HEADERS,
} = core;

// ONLINE: the owner panel runs on a hosting service (Render) instead of only on the owner's PC.
// Then two-step sign-in is required, the encryption key is never shown, and backups come from Supabase Storage.
const ONLINE = !!process.env.RENDER || process.env.OWNER_PUBLIC === '1';
const PORT = Number(process.env.OWNER_PORT || process.env.PORT) || 4000;
const HOST = process.env.OWNER_HOST || (ONLINE ? '0.0.0.0' : '127.0.0.1');
const serveStatic = staticServer(path.join(__dirname, 'dist'));

const adminCount = async () => (await db.get('SELECT COUNT(*) AS n FROM admins')).n;
const ownerAudit = (req, adminId, action, extra = {}) => sec.audit(req, { actor: 'owner', actorId: adminId, action, ...extra });

// First-time setup is only allowed from this computer, never through a proxy or the internet.
function isLocalRequest(req) {
  const ip = req.socket.remoteAddress || '';
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip) && !req.headers['x-forwarded-for'];
}

async function saveAdmin(email, password) {
  const e = normEmail(email);
  checkPassword(password);
  const existing = await db.get('SELECT id FROM admins WHERE email = ?', e);
  if (existing) {
    await db.run('UPDATE admins SET password_hash = ?, failed_logins = 0, locked_until = NULL, password_changed_at = ? WHERE id = ?',
      hashPassword(password), now(), existing.id);
    await endAllSessions('admin', existing.id);
    return { id: existing.id, created: false, email: e };
  }
  const id = uid();
  await db.run('INSERT INTO admins (id, email, password_hash, created_at, password_changed_at) VALUES (?, ?, ?, ?, ?)', id, e, hashPassword(password), now(), now());
  return { id, created: true, email: e };
}

function clinicRow(c, settings, usage) {
  const { password_hash, totp_secret, totp_pending, recovery_codes, totp_last_step, ...rest } = c;
  const u = usage[c.id] || {};
  return { ...rest, totp_enabled: !!c.totp_enabled, access: accessFor(c, settings),
    ai: { ...ai.statusFrom(c, ai.aiConfig(settings), u.cost_usd || 0), requests: u.requests || 0 } };
}

function publicSettings(s) {
  const { ai_key, smtp_pass, encryption_v1, key_check, ...rest } = s;
  const key = sec.decrypt(ai_key) || '';
  return { ...rest, ai_key_set: !!key, ai_key_hint: key ? `…${key.slice(-4)}` : '', smtp_pass_set: !!smtp_pass, email_ready: mailer.emailReady(s) };
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  const m = req.method;
  const q = url.searchParams;
  limit(`owner:${sec.clientIp(req)}`, 600, 60000);
  if (m !== 'GET') {
    checkSameOrigin(req);
    if (!String(req.headers['content-type'] || '').includes('application/json')) throw new HttpError(415, 'Expected JSON.');
  }
  const body = m === 'GET' ? {} : await readBody(req);

  // ---- sign in
  if (p === '/api/admin/status' && m === 'GET') {
    return send(res, 200, { needs_setup: (await adminCount()) === 0, local: isLocalRequest(req), product_name: (await getSettings()).product_name });
  }
  if (p === '/api/admin/setup' && m === 'POST') {
    if ((await adminCount()) > 0) throw new HttpError(409, 'An owner account already exists. Please sign in.');
    if (!isLocalRequest(req)) throw new HttpError(403, 'First-time setup must be done on the server computer itself.');
    const a = await saveAdmin(body.email, body.password);
    await ownerAudit(req, a.id, 'owner.setup');
    return send(res, 201, { ok: true }, { 'Set-Cookie': await createSession('admin', a.id, req) });
  }
  if (p === '/api/admin/login' && m === 'POST') {
    rateLimit(req);
    const a = await db.get('SELECT * FROM admins WHERE email = ?', String(body.email || '').trim().toLowerCase());
    const locked = sec.lockMessage(a);
    if (locked) throw new HttpError(429, locked);
    if (!a) burnPasswordCheck(body.password);
    if (!a || !verifyPassword(body.password || '', a.password_hash)) {
      recordAttempt(req);
      await sec.registerFailure('admins', a);
      if (a) await ownerAudit(req, a.id, 'owner.login_failed');
      throw new HttpError(401, 'Incorrect email or password.');
    }
    if (ONLINE && !a.totp_enabled) {
      // online, a password alone never opens the owner panel
      await ownerAudit(req, a.id, 'owner.login_blocked', { detail: 'online sign-in needs two-step sign-in' });
      throw new HttpError(403, 'The online owner panel requires two-step sign-in. Turn it on in the owner panel on your PC (Security & backups), then sign in here.');
    }
    if (a.totp_enabled) return send(res, 200, { mfa_required: true }, { 'Set-Cookie': await createSession('admin_mfa', a.id, req) });
    await sec.clearFailures('admins', a.id);
    await ownerAudit(req, a.id, 'owner.login');
    return send(res, 200, { ok: true }, { 'Set-Cookie': await createSession('admin', a.id, req) });
  }
  if (p === '/api/admin/login/2fa' && m === 'POST') {
    rateLimit(req);
    const pend = await getSession(req, 'admin_mfa');
    if (!pend) throw new HttpError(401, 'Your sign-in expired. Please enter your password again.');
    const a = await db.get('SELECT * FROM admins WHERE id = ?', pend.subject_id);
    const locked = sec.lockMessage(a);
    if (locked) throw new HttpError(429, locked);
    const r = await sec.checkSecondFactor('admins', a, body.code);
    if (!r.ok) {
      recordAttempt(req);
      await sec.registerFailure('admins', a);
      await ownerAudit(req, a.id, 'owner.login_failed', { detail: 'wrong 2FA code' });
      throw new HttpError(401, 'That code is not correct.');
    }
    await sec.clearFailures('admins', a.id);
    await ownerAudit(req, a.id, 'owner.login', { detail: r.usedRecovery ? `recovery code used (${r.remaining} left)` : '2FA' });
    return send(res, 200, { ok: true }, { 'Set-Cookie': [await endSession(req, 'admin_mfa'), await createSession('admin', a.id, req)] });
  }
  if (p === '/api/admin/logout' && m === 'POST') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': await endSession(req, 'admin') });
  }

  // ---- signed-in owner
  const session = await getSession(req, 'admin');
  if (!session) throw new HttpError(401, 'Please sign in as owner.');
  const admin = await db.get('SELECT * FROM admins WHERE id = ?', session.subject_id);
  if (!admin) throw new HttpError(401, 'Please sign in as owner.');
  const settings = await getSettings();

  if (p === '/api/admin/me' && m === 'GET') {
    return send(res, 200, {
      admin: { id: admin.id, email: admin.email, totp_enabled: !!admin.totp_enabled, recovery_codes_left: JSON.parse(admin.recovery_codes || '[]').length },
      settings: publicSettings(settings), trial_days: TRIAL_DAYS, last_backup_at: settings.last_backup_at || null,
      data_dir: DATA_DIR, storage: storage.describe(), schema: SCHEMA, online: ONLINE,
    });
  }

  // ---- clinics
  if (p === '/api/admin/clinics' && m === 'GET') {
    const usage = await ai.usageByClinic();
    const rows = await db.all(`SELECT c.*,
        (SELECT COUNT(*) FROM patients WHERE clinic_id = c.id) AS patient_count,
        (SELECT COUNT(*) FROM appointments WHERE clinic_id = c.id) AS appointment_count,
        (SELECT COUNT(*) FROM invoices WHERE clinic_id = c.id) AS invoice_count,
        (SELECT COUNT(*) FROM documents WHERE clinic_id = c.id) AS document_count
      FROM clinics c ORDER BY c.created_at DESC`);
    return send(res, 200, rows.map((c) => clinicRow(c, settings, usage)));
  }

  let mm;
  if ((mm = p.match(/^\/api\/admin\/clinics\/([\w-]+)\/action$/)) && m === 'POST') {
    const c = await db.get('SELECT * FROM clinics WHERE id = ?', mm[1]);
    if (!c) throw new HttpError(404, 'Clinic not found.');
    const days = Math.round(Number(body.days) || 0);
    const t = Date.now();
    const plus = (from, d) => new Date(Math.max(t, from ? Date.parse(from) : t) + d * DAY_MS).toISOString();
    let detail = null;
    switch (body.action) {
      case 'activate': {   // days = 0 means lifetime licence
        const until = days > 0 ? plus(c.plan === 'active' ? c.active_until : null, days) : null;
        await db.run("UPDATE clinics SET plan = 'active', active_until = ? WHERE id = ?", until, c.id);
        detail = days > 0 ? `${days} days` : 'lifetime';
        break;
      }
      case 'extend_trial':
        if (days <= 0) throw new HttpError(400, 'Enter the number of days.');
        await db.run("UPDATE clinics SET plan = 'trial', trial_ends_at = ? WHERE id = ?", plus(c.plan === 'trial' ? c.trial_ends_at : null, days), c.id);
        detail = `${days} days`;
        break;
      case 'revoke':
        await db.run("UPDATE clinics SET plan = 'trial', trial_ends_at = ?, active_until = NULL WHERE id = ?", now(), c.id);
        break;
      case 'suspend':
        if (c.plan !== 'suspended') await db.run("UPDATE clinics SET prev_plan = plan, plan = 'suspended' WHERE id = ?", c.id);
        await endAllSessions('clinic', c.id);
        break;
      case 'unsuspend':
        await db.run("UPDATE clinics SET plan = COALESCE(prev_plan, 'trial'), prev_plan = NULL WHERE id = ?", c.id);
        break;
      case 'reset_password':
        checkPassword(body.password);
        await db.run('UPDATE clinics SET password_hash = ?, failed_logins = 0, locked_until = NULL, password_changed_at = ? WHERE id = ?',
          hashPassword(body.password), now(), c.id);
        await endAllSessions('clinic', c.id);
        break;
      case 'reset_2fa':
        await tf.disableTwoFactor('clinics', c.id);
        await db.run('UPDATE clinics SET failed_logins = 0, locked_until = NULL WHERE id = ?', c.id);
        await endAllSessions('clinic', c.id);
        break;
      case 'unlock':
        await sec.clearFailures('clinics', c.id);
        break;
      case 'ai': {
        const enabled = body.enabled === null || body.enabled === undefined ? null : body.enabled ? 1 : 0;
        const lim = body.limit === null || body.limit === '' || body.limit === undefined ? null : Math.max(0, Math.min(10000, Number(body.limit) || 0));
        await db.run('UPDATE clinics SET ai_enabled = ?, ai_monthly_limit = ? WHERE id = ?', enabled, lim, c.id);
        detail = `enabled=${enabled ?? 'default'} limit=${lim ?? 'default'}`;
        break;
      }
      case 'note':
        await db.run('UPDATE clinics SET admin_note = ? WHERE id = ?', str(body.note, 2000), c.id);
        break;
      default:
        throw new HttpError(400, 'Unknown action.');
    }
    if (body.action !== 'note') await ownerAudit(req, admin.id, `owner.clinic_${body.action}`, { clinicId: c.id, entity: 'clinics', entityId: c.id, detail });
    return send(res, 200, clinicRow(await db.get('SELECT * FROM clinics WHERE id = ?', c.id), await getSettings(), await ai.usageByClinic()));
  }

  // ---- settings, AI, password, 2FA
  if (p === '/api/admin/settings' && m === 'PUT') {
    for (const k of ['product_name', 'support_name', 'support_email', 'support_phone']) if (k in body) await setSetting(k, str(body[k], 200) || '');
    if (body.expired_mode) await setSetting('expired_mode', body.expired_mode === 'locked' ? 'locked' : 'readonly');
    await ownerAudit(req, admin.id, 'owner.settings_changed');
    return send(res, 200, publicSettings(await getSettings()));
  }
  if (p === '/api/admin/ai' && m === 'PUT') {
    if (typeof body.ai_key === 'string' && body.ai_key.trim()) {
      const key = body.ai_key.trim();
      if (!/^sk-or-[\w-]{10,}$/.test(key)) throw new HttpError(400, 'That does not look like an OpenRouter key (it starts with "sk-or-").');
      await setSetting('ai_key', sec.encrypt(key));
    }
    if (body.clear_key) await setSetting('ai_key', '');
    if (typeof body.ai_model === 'string' && /^[\w.\-~/:]+$/.test(body.ai_model.trim())) await setSetting('ai_model', body.ai_model.trim().slice(0, 120));
    for (const k of ['ai_zdr', 'ai_hide_names', 'ai_default_enabled']) if (k in body) await setSetting(k, body[k] ? '1' : '0');
    if ('ai_default_limit' in body) await setSetting('ai_default_limit', String(Math.max(0, Math.min(10000, Number(body.ai_default_limit) || 0))));
    await ownerAudit(req, admin.id, 'owner.ai_settings_changed');
    return send(res, 200, publicSettings(await getSettings()));
  }
  if (p === '/api/admin/email' && m === 'PUT') {
    for (const k of ['smtp_host', 'smtp_user', 'smtp_from']) if (k in body) await setSetting(k, str(body[k], 200) || '');
    if ('smtp_port' in body) {
      const port = Math.round(Number(body.smtp_port));
      if (!(port > 0 && port < 65536)) throw new HttpError(400, 'Port must be a number such as 465 or 587.');
      await setSetting('smtp_port', String(port));
    }
    if (typeof body.smtp_pass === 'string' && body.smtp_pass) await setSetting('smtp_pass', sec.encrypt(body.smtp_pass.slice(0, 500)));
    if (body.clear_pass) await setSetting('smtp_pass', '');
    if ('public_url' in body) {
      const u = String(body.public_url || '').trim().replace(/\/+$/, '');
      if (u && !/^https?:\/\/[\w.-]+(:\d+)?$/i.test(u)) throw new HttpError(400, 'Website address should look like https://your-name.ngrok-free.app (no path).');
      await setSetting('public_url', u);
    }
    if ('signup_verify' in body) await setSetting('signup_verify', body.signup_verify ? '1' : '0');
    await ownerAudit(req, admin.id, 'owner.email_settings_changed');
    return send(res, 200, publicSettings(await getSettings()));
  }
  if (p === '/api/admin/email/test' && m === 'POST') {
    limit(`emailtest:${admin.id}`, 10, 3600000, 'Too many test emails. Please wait a while.');
    const to = normEmail(body.to || admin.email);
    await mailer.sendMail({ to, subject: `${settings.product_name} test email`,
      text: `This is a test email from your ${settings.product_name} owner panel. Email sending works.` }, settings);
    await ownerAudit(req, admin.id, 'owner.email_test_sent');
    return send(res, 200, { ok: true, to });
  }
  if (p === '/api/admin/ai/test' && m === 'POST') return send(res, 200, await ai.testConnection());
  if (p === '/api/admin/ai/models' && m === 'GET') return send(res, 200, await ai.listModels());

  if (p === '/api/admin/password' && m === 'PUT') {
    if (!verifyPassword(body.current || '', admin.password_hash)) throw new HttpError(400, 'Current password is incorrect.');
    checkPassword(body.password);
    await db.run('UPDATE admins SET password_hash = ?, password_changed_at = ? WHERE id = ?', hashPassword(body.password), now(), admin.id);
    await endAllSessions('admin', admin.id, session.token);
    await ownerAudit(req, admin.id, 'owner.password_changed');
    return send(res, 200, { ok: true });
  }
  if (p === '/api/admin/account/sessions' && m === 'GET') return send(res, 200, await listSessions('admin', admin.id, session.token));
  if (p === '/api/admin/account/2fa/setup' && m === 'POST') {
    if (!verifyPassword(body.password || '', admin.password_hash)) throw new HttpError(400, 'Password is incorrect.');
    if (admin.totp_enabled) throw new HttpError(409, 'Two-step sign-in is already on.');
    return send(res, 200, await tf.startTwoFactor('admins', admin, `${settings.product_name || 'CareDesk'} Owner`, admin.email));
  }
  if (p === '/api/admin/account/2fa/enable' && m === 'POST') {
    const codes = await tf.enableTwoFactor('admins', admin, body.code);
    await endAllSessions('admin', admin.id, session.token);
    await ownerAudit(req, admin.id, 'owner.2fa_enabled');
    return send(res, 200, { recovery_codes: codes });
  }
  if (p === '/api/admin/account/2fa/disable' && m === 'POST') {
    if (ONLINE) throw new HttpError(403, 'Two-step sign-in cannot be turned off in the online owner panel. Use the owner panel on your PC.');
    await tf.requirePasswordAndCode('admins', admin, body);
    await tf.disableTwoFactor('admins', admin.id);
    await ownerAudit(req, admin.id, 'owner.2fa_disabled');
    return send(res, 200, { ok: true });
  }
  if (p === '/api/admin/account/2fa/recovery-codes' && m === 'POST') {
    if (!admin.totp_enabled) throw new HttpError(400, 'Turn on two-step sign-in first.');
    await tf.requirePasswordAndCode('admins', admin, body);
    await ownerAudit(req, admin.id, 'owner.recovery_codes_renewed');
    return send(res, 200, { recovery_codes: await tf.renewRecoveryCodes('admins', admin.id) });
  }

  // ---- activity log
  if (p === '/api/admin/audit' && m === 'GET') {
    const lim = Math.min(Number(q.get('limit')) || 200, 1000);
    const params = [q.get('before') || '9999'];
    let sql = 'SELECT a.*, c.name AS clinic_name FROM audit_log a LEFT JOIN clinics c ON c.id = a.clinic_id WHERE a.at < ?';
    if (q.get('clinic_id')) { sql += ' AND a.clinic_id = ?'; params.push(q.get('clinic_id')); }
    if (q.get('actor')) { sql += ' AND a.actor = ?'; params.push(q.get('actor')); }
    if (q.get('action')) { sql += ' AND a.action ILIKE ?'; params.push(`%${String(q.get('action')).replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`); }
    sql += ' ORDER BY a.at DESC, a.id DESC LIMIT ?';
    params.push(lim);
    return send(res, 200, await db.all(sql, ...params));
  }

  // ---- backups & encryption key
  if (p === '/api/admin/backups' && m === 'GET') return send(res, 200, await backup.listAllBackups());
  if (p === '/api/admin/backups' && m === 'POST') {
    const file = await backup.createBackup();
    await ownerAudit(req, admin.id, 'owner.backup_created', { detail: file });
    return send(res, 201, { file });
  }
  if ((mm = p.match(/^\/api\/admin\/backups\/([\w.-]+)$/)) && m === 'GET') {
    const buf = await backup.readBackupBuffer(mm[1]);
    if (!buf) throw new HttpError(404, 'Backup not found.');
    await ownerAudit(req, admin.id, 'owner.backup_downloaded', { detail: mm[1] });
    return send(res, 200, buf, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${mm[1]}"` });
  }
  if (p === '/api/admin/encryption-key' && m === 'POST') {
    // the master key never leaves the server over the internet; view it in the owner panel on the PC
    if (ONLINE) throw new HttpError(403, 'For safety, the encryption key is only shown in the owner panel on your PC.');
    await tf.requirePasswordAndCode('admins', admin, body);
    await ownerAudit(req, admin.id, 'owner.encryption_key_viewed');
    return send(res, 200, { key: fs.existsSync(sec.KEY_FILE) ? fs.readFileSync(sec.KEY_FILE, 'utf8').trim() : '(set by the CAREDESK_KEY environment variable)', file: sec.KEY_FILE });
  }

  throw new HttpError(404, 'Not found.');
}

async function handle(req, res) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  res.setHeader('X-Robots-Tag', 'noindex');
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { return send(res, 400, { error: 'Bad request' }); }
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else if (url.pathname === '/robots.txt') send(res, 200, 'User-agent: *\nDisallow: /\n', { 'Content-Type': 'text/plain; charset=utf-8' });   // never in search results
    else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, url.pathname);
    else send(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    if (res.headersSent) return;
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    console.error(err);
    send(res, 500, { error: 'Something went wrong on the server.' });
  }
}
const server = http.createServer(handle);

// "localhost" can mean 127.0.0.1 or ::1; when bound to this computer only, answer on both
// so browsers and tools never wait for a fallback. Still unreachable from other computers.
function listenLoopbackV6() {
  if (HOST !== '127.0.0.1') return;
  const v6 = http.createServer(handle);
  v6.on('error', () => {});            // no IPv6 on this machine: fine
  v6.listen(PORT, '::1');
}

// ---------------------------------------------------------------- command line tools
const [cmd, a1, a2] = process.argv.slice(2);

async function cli() {
  await init();
  if (cmd === 'create-admin') {
    // create the owner account, or reset its password (also unlocks it)
    if (!a1 || !a2) throw new Error('Usage: node server.js create-admin you@example.com yourpassword');
    const a = await saveAdmin(a1, a2);
    console.log(a.created ? `Owner account created for ${a.email}.` : `Owner password reset for ${a.email}.`);
  } else if (cmd === 'reset-admin-2fa') {
    const a = await db.get('SELECT id FROM admins WHERE email = ?', String(a1 || '').toLowerCase());
    if (!a) throw new Error('Usage: node server.js reset-admin-2fa you@example.com  (no such owner)');
    await tf.disableTwoFactor('admins', a.id);
    await sec.clearFailures('admins', a.id);
    console.log('Two-step sign-in turned off for the owner account. Sign in with your password and set it up again.');
  } else if (cmd === 'restore-backup') {
    if (!a1 || a2 !== '--yes') {
      throw new Error('Usage: node server.js restore-backup <file.backup> --yes\n  This REPLACES all current data in Supabase with the backup. Stop the clinic app first.');
    }
    const counts = await backup.restoreBackup(a1);
    console.log('Backup restored:', Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', '));
  } else if (cmd === 'import-sqlite') {
    const { importFromSqlite } = need('tools/import-sqlite');
    await importFromSqlite(a1 || path.join(DATA_DIR, 'clinic.db'));
  } else {
    throw new Error('Commands: create-admin <email> <password> | reset-admin-2fa <email> | restore-backup <file> --yes | import-sqlite [old clinic.db]');
  }
}

if (cmd) {
  cli().then(() => close()).then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); });
} else {
  (async () => {
    try {
      await need('db').initWithRetry();
      await sec.verifyKey();
    } catch (err) {
      console.error(`\n  Could not start: ${err.message}\n`);
      process.exit(1);
    }
    listenLoopbackV6();
    server.listen(PORT, HOST, async () => {
      console.log(`\n  ${(await getSettings()).product_name} OWNER PANEL is running`);
      console.log(`  Open: http://localhost:${PORT}`);
      console.log(`  Database: Supabase / PostgreSQL (schema "${SCHEMA}") · Files: ${storage.describe()}`);
      if (!(await adminCount())) console.log('  First time? The page will ask you to create your owner account.');
      console.log('');
    });
  })();
}
