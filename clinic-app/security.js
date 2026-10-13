// Security building blocks: encryption at rest, two-factor authentication (TOTP),
// recovery codes, account lockout and the audit (activity) log.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, now, DATA_DIR } = require('./db');

// ---------------------------------------------------------------- master encryption key
// Kept in DATA_DIR/secret.key (or the CAREDESK_KEY environment variable, base64).
// WITHOUT THIS KEY ENCRYPTED DATA CANNOT BE READ: back it up separately from the data.

const KEY_FILE = path.join(DATA_DIR, 'secret.key');

function loadKey() {
  if (process.env.CAREDESK_KEY) {
    const k = Buffer.from(process.env.CAREDESK_KEY, 'base64');
    if (k.length !== 32) throw new Error('CAREDESK_KEY must be 32 bytes, base64-encoded.');
    return k;
  }
  // Hosting services like Render wipe local files on every restart, so a key file made there would be lost
  // (and would not match the data). Online the key must come from CAREDESK_KEY.
  if (process.env.RENDER || process.env.REQUIRE_KEY_ENV === '1') {
    throw new Error('CAREDESK_KEY is not set. Copy the contents of clinic-app/data/secret.key from your PC into the CAREDESK_KEY setting.');
  }
  try {
    // 'wx' fails if the file exists, so two programs starting together never create different keys
    fs.writeFileSync(KEY_FILE, crypto.randomBytes(32).toString('base64'), { flag: 'wx', mode: 0o600 });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  const k = Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'base64');
  if (k.length !== 32) throw new Error(`${KEY_FILE} is damaged (expected a 32-byte key).`);
  return k;
}

const KEY = loadKey();
const PREFIX = 'enc:v1:';
const FILE_MAGIC = Buffer.from('CDE1');

function encrypt(value) {
  if (value == null || value === '') return value;
  const s = String(value);
  if (s.startsWith(PREFIX)) return s;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(s, 'utf8'), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

function decrypt(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value;   // plain (older) value
  const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

function encryptBuffer(buf) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([FILE_MAGIC, iv, c.getAuthTag(), ct]);
}

function decryptBuffer(buf) {
  if (!buf.subarray(0, 4).equals(FILE_MAGIC)) return buf;                     // legacy plain file
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, buf.subarray(4, 16));
  d.setAuthTag(buf.subarray(16, 32));
  return Buffer.concat([d.update(buf.subarray(32)), d.final()]);
}

const isEncryptedBuffer = (buf) => buf.subarray(0, 4).equals(FILE_MAGIC);

// Columns holding medical / personal details that are stored encrypted.
// Names, phone, email and date of birth stay searchable (not encrypted).
const SENSITIVE = {
  patients: ['address', 'emergency_contact', 'insurance', 'allergies', 'medical_history', 'medications', 'notes'],
  clinical_notes: ['subjective', 'objective', 'assessment', 'plan'],
  appointments: ['notes'],
  documents: ['ocr_text'],
};

function encryptFields(table, data) {
  const cols = SENSITIVE[table];
  if (!cols) return data;
  const out = { ...data };
  for (const c of cols) if (c in out) out[c] = encrypt(out[c]);
  return out;
}

function decryptRow(table, row) {
  const cols = SENSITIVE[table];
  if (!row || !cols) return row;
  for (const c of cols) if (c in row) row[c] = decrypt(row[c]);
  return row;
}

const decryptRows = (table, rows) => rows.map((r) => decryptRow(table, r));


// ---------------------------------------------------------------- TOTP (authenticator app codes, RFC 6238)

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function totpAt(secretB32, step) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', base32Decode(secretB32)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}

// Returns the matched time step (to block re-use of the same code), or null.
function verifyTotp(secretB32, code, lastStep = 0) {
  const c = String(code || '').replace(/\D/g, '');
  if (c.length !== 6) return null;
  const step = Math.floor(Date.now() / 30000);
  for (const s of [step - 1, step, step + 1]) {
    if (s > lastStep && crypto.timingSafeEqual(Buffer.from(totpAt(secretB32, s)), Buffer.from(c))) return s;
  }
  return null;
}

const newTotpSecret = () => base32Encode(crypto.randomBytes(20));
const otpauthUrl = (issuer, account, secret) =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

function newRecoveryCodes() {
  const codes = Array.from({ length: 10 }, () => {
    const s = base32Encode(crypto.randomBytes(5)).toLowerCase();
    return `${s.slice(0, 4)}-${s.slice(4, 8)}`;
  });
  return { codes, hashes: JSON.stringify(codes.map((c) => sha256(c))) };
}

// Checks a TOTP code or a one-time recovery code for an account row; updates the row.
// table is 'clinics' or 'admins'. The updates are compare-and-swap, so the same code can't be
// used twice even by two simultaneous sign-ins. Returns { ok, usedRecovery, remaining }.
async function checkSecondFactor(table, row, code) {
  const secret = decrypt(row.totp_secret);
  const step = secret ? verifyTotp(secret, code, row.totp_last_step || 0) : null;
  if (step) {
    const r = await db.run(`UPDATE ${table} SET totp_last_step = ? WHERE id = ? AND COALESCE(totp_last_step, 0) < ?`, step, row.id, step);
    return r.changes ? { ok: true, usedRecovery: false } : { ok: false };
  }
  const normalized = String(code || '').trim().toLowerCase();
  const hashes = JSON.parse(row.recovery_codes || '[]');
  const idx = hashes.indexOf(sha256(normalized));
  if (idx >= 0) {
    const remaining = hashes.filter((_, i) => i !== idx);
    const r = await db.run(`UPDATE ${table} SET recovery_codes = ? WHERE id = ? AND recovery_codes = ?`, JSON.stringify(remaining), row.id, row.recovery_codes);
    return r.changes ? { ok: true, usedRecovery: true, remaining: remaining.length } : { ok: false };
  }
  return { ok: false };
}

// ---------------------------------------------------------------- account lockout

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

function lockMessage(row) {
  if (row && row.locked_until && row.locked_until > now()) {
    const mins = Math.max(1, Math.ceil((Date.parse(row.locked_until) - Date.now()) / 60000));
    return `Too many wrong attempts. This account is locked for ${mins} more minute${mins === 1 ? '' : 's'}.`;
  }
  return null;
}

async function registerFailure(table, row) {
  if (!row) return;
  // counted in the database so parallel attempts can't slip past the limit
  const r = await db.get(`UPDATE ${table} SET failed_logins = COALESCE(failed_logins, 0) + 1 WHERE id = ? RETURNING failed_logins`, row.id);
  if (r && r.failed_logins >= MAX_FAILED) {
    await db.run(`UPDATE ${table} SET failed_logins = 0, locked_until = ? WHERE id = ?`,
      new Date(Date.now() + LOCK_MINUTES * 60000).toISOString(), row.id);
  }
}

async function clearFailures(table, id) {
  await db.run(`UPDATE ${table} SET failed_logins = 0, locked_until = NULL WHERE id = ?`, id);
}

// ---------------------------------------------------------------- audit log

// TRUST_PROXY=1 (ngrok, Cloudflare Tunnel, nginx on the same machine): every request then arrives from
// 127.0.0.1, so the real visitor IP is taken from X-Forwarded-For. Only trusted when the request really comes
// from this computer, and only the last entry (the one added by the proxy; earlier ones can be faked).
// TRUST_PROXY=all (Render and similar hosts): the app can only be reached through the host's proxy,
// so the proxy's X-Forwarded-For entry is trusted whatever address the connection comes from.
const TRUST_PROXY = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'all';
const TRUST_ANY = process.env.TRUST_PROXY === 'all';
function clientIp(req) {
  if (!req) return null;
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (TRUST_PROXY && (TRUST_ANY || ip === '127.0.0.1' || ip === '::1')) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean).pop();
    if (fwd && fwd.length <= 64) return fwd.replace(/^::ffff:/, '');
  }
  return ip;
}

async function audit(req, { clinicId = null, actor = 'clinic', actorId = null, action, entity = null, entityId = null, detail = null }) {
  try {
    await db.run(`INSERT INTO audit_log (at, clinic_id, actor, actor_id, action, entity, entity_id, detail, ip, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    now(), clinicId, actor, actorId, action, entity, entityId, detail ? String(detail).slice(0, 500) : null,
    clientIp(req), req ? String(req.headers['user-agent'] || '').slice(0, 200) : null);
  } catch (err) {
    console.error('audit log failed:', err.message);
  }
}

// Makes sure every program using this database has the same encryption key. The first start stores a small
// encrypted marker; later starts must be able to read it, otherwise new data would be saved with a key that
// can't read the old data (e.g. a hosting server set up with a wrong or missing CAREDESK_KEY).
const KEY_MARKER = 'caredesk-key-ok';
async function verifyKey() {
  const row = await db.get("SELECT value FROM settings WHERE key = 'key_check'");
  if (!row) {
    await db.run("INSERT INTO settings (key, value) VALUES ('key_check', ?) ON CONFLICT (key) DO NOTHING", encrypt(KEY_MARKER));
    return;
  }
  let ok = false;
  try { ok = decrypt(row.value) === KEY_MARKER; } catch { /* wrong key: authentication fails */ }
  if (!ok) {
    throw new Error('The encryption key here does not match the key this database was created with.\n'
      + '  Use the same key everywhere: the contents of clinic-app/data/secret.key on your PC (online: the CAREDESK_KEY setting).');
  }
}

async function purgeOldAudit() {
  const cutoff = new Date(Date.now() - 2 * 365 * 86400000).toISOString();     // keep 2 years
  await db.run('DELETE FROM audit_log WHERE at < ?', cutoff);
}

module.exports = {
  KEY_FILE, encrypt, decrypt, encryptBuffer, decryptBuffer, encryptFields, decryptRow, decryptRows, SENSITIVE,
  isEncryptedBuffer, newTotpSecret, otpauthUrl, verifyTotp, newRecoveryCodes, checkSecondFactor, sha256,
  lockMessage, registerFailure, clearFailures, audit, clientIp, purgeOldAudit, totpAt, verifyKey,
};
