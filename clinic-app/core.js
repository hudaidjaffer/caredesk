// Shared server code used by both the clinic app and the owner panel (../owner-panel).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const { db, now } = require('./db');
const { sha256, clientIp } = require('./security');

const TRIAL_DAYS = 30;                          // free trial for new sign-ups (was 7 until 2026-10-17)
const MIN_PASSWORD = 8;                         // no capital/number/symbol rules, just a minimum length
const SECURE_COOKIES = process.env.SECURE_COOKIES === '1';   // set to 1 when served over HTTPS
const DAY_MS = 86400000;

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

const uid = () => crypto.randomUUID();

// ---------------------------------------------------------------- passwords

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored || '').split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

// Used when the email doesn't exist, so a wrong email takes as long as a wrong password
// (otherwise response timing would reveal which emails have accounts).
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));
const burnPasswordCheck = (pw) => { verifyPassword(pw || '', DUMMY_HASH); };

function normEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 200) throw new HttpError(400, 'Please enter a valid email address.');
  return e;
}

// ---------------------------------------------------------------- "is this a real email?" (used at sign-up)

// Throwaway inboxes and placeholder domains people type to get past a sign-up form.
const DISPOSABLE = new Set(`mailinator.com guerrillamail.com guerrillamail.net guerrillamail.org guerrillamail.biz grr.la
  sharklasers.com 10minutemail.com 10minutemail.net tempmail.com temp-mail.org temp-mail.io tempmail.net tempmailo.com
  tempr.email yopmail.com yopmail.net trashmail.com trashmail.de getnada.com nada.email dispostable.com maildrop.cc
  throwawaymail.com fakeinbox.com mintemail.com mohmal.com emailondeck.com discard.email mailnesia.com spamgourmet.com
  burnermail.io moakt.com 1secmail.com 1secmail.net mailcatch.com getairmail.com fakemail.net emailfake.com
  example.com example.org example.net test.com test.org domain.com mail.test email.test`.split(/\s+/));
// Common misspellings of big providers.
const TYPOS = {
  'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gmaill.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gnail.com': 'gmail.com',
  'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmail.om': 'gmail.com', 'gmai.com': 'gmail.com',
  'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'hotmai.com': 'hotmail.com',
  'yahooo.com': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yahoo.co': 'yahoo.com', 'yahoo.con': 'yahoo.com',
  'outlok.com': 'outlook.com', 'outlook.co': 'outlook.com', 'outlook.con': 'outlook.com', 'iclod.com': 'icloud.com', 'icloud.co': 'icloud.com',
};

// Checks the address looks right, isn't a throwaway/placeholder, and that its domain can receive email (DNS MX record).
// If DNS itself can't be reached (no internet), the sign-up is allowed rather than blocking real people.
async function checkRealEmail(email) {
  const e = normEmail(email);
  const [local, domain] = e.split('@');
  const labels = domain.split('.');
  if (e.split('@').length !== 2 || local.length > 64 || /^\.|\.$|\.\./.test(local) || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)
    || labels.some((l) => !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(l)) || !/^[a-z]{2,}$/.test(labels[labels.length - 1])) {
    throw new HttpError(400, 'Please enter a valid email address.');
  }
  if (TYPOS[domain]) throw new HttpError(400, `Did you mean ${local}@${TYPOS[domain]}? Please check the spelling of your email.`);
  if (DISPOSABLE.has(domain) || ['test', 'example', 'invalid', 'localhost', 'local'].includes(labels[labels.length - 1])) {
    throw new HttpError(400, 'Please use your real email address (temporary or example emails are not accepted).');
  }
  const noMail = () => new HttpError(400, `"${domain}" cannot receive email. Please check your email address.`);
  const verdict = await mailDomainVerdict(domain);
  if (verdict === 'none') throw noMail();
  return e;                                    // 'ok', or 'unknown' (DNS unreachable: don't block real people)
}

// 'ok' = domain accepts email, 'none' = it doesn't exist / takes no email, 'unknown' = DNS couldn't be asked.
// Some home/ISP DNS servers answer "server failure" for made-up domains, so unclear answers get a second opinion
// from public DNS (Cloudflare, Google).
const NOT_FOUND = ['ENOTFOUND', 'ENODATA', 'NXDOMAIN'];
const publicDns = new dns.Resolver({ timeout: 2500, tries: 2 });
publicDns.setServers(['1.1.1.1', '8.8.8.8']);
async function mailDomainVerdict(domain) {
  for (const r of [dns, publicDns]) {
    let mx;
    try {
      mx = await Promise.race([r.resolveMx(domain), new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), 5000).unref())]);
    } catch (err) {
      if (!NOT_FOUND.includes(err.code)) continue;   // unclear answer: ask the next DNS server
      // no MX record: by the email standard, a domain's plain address can still accept mail
      const a = await r.resolve4(domain).catch(() => r.resolve6(domain)).catch(() => []);
      return a.length ? 'ok' : 'none';
    }
    if (mx.length && mx.every((x) => !x.exchange || x.exchange === '.')) return 'none';   // "null MX": domain takes no email
    return 'ok';
  }
  return 'unknown';
}

function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD)
    throw new HttpError(400, `Password must be at least ${MIN_PASSWORD} characters.`);
  if (pw.length > 200) throw new HttpError(400, 'Password is too long.');
  return pw;
}

// ---------------------------------------------------------------- HTTP helpers

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 2_000_000) { reject(new HttpError(413, 'Request too large.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(v && typeof v === 'object' ? v : {});
      } catch { reject(new HttpError(400, 'Invalid JSON body.')); }
    });
    req.on('error', reject);
  });
}

// Reads a raw (binary) request body, used for file uploads.
function readRaw(req, limit) {
  if (Number(req.headers['content-length']) > limit) {
    return Promise.reject(new HttpError(413, `File is too large (max ${Math.round(limit / 1e6)} MB).`));
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, `File is too large (max ${Math.round(limit / 1e6)} MB).`)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* bad cookie */ }
    }
  }
  return out;
}

// Blocks requests that come from another website (CSRF protection). Browsers always send
// Origin on cross-site POST/PUT/DELETE; it must match the host the app is served on.
function checkSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  let host;
  try { host = new URL(origin).host; } catch { throw new HttpError(403, 'Request blocked.'); }
  const allowed = [req.headers.host, req.headers['x-forwarded-host']].filter(Boolean);
  if (!allowed.includes(host)) throw new HttpError(403, 'Request blocked (cross-site).');
}

// ---------------------------------------------------------------- sessions
// Only a SHA-256 hash of each session token is stored, so a copied database can't be used to log in.

const SESSION_RULES = {
  clinic: { cookie: 'cd_session', absoluteMs: 30 * DAY_MS, idleMs: 12 * 3600000 },
  admin: { cookie: 'cd_admin', absoluteMs: 12 * 3600000, idleMs: 60 * 60000 },
  clinic_mfa: { cookie: 'cd_mfa', absoluteMs: 5 * 60000, idleMs: 5 * 60000 },   // between password and 2FA code
  admin_mfa: { cookie: 'cd_admin_mfa', absoluteMs: 5 * 60000, idleMs: 5 * 60000 },
};

const cookieName = (kind) => (SECURE_COOKIES ? '__Host-' : '') + SESSION_RULES[kind].cookie;

function sessionCookie(kind, token, maxAgeSec) {
  return `${cookieName(kind)}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${SECURE_COOKIES ? '; Secure' : ''}`;
}

async function createSession(kind, subjectId, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const rule = SESSION_RULES[kind];
  const t = now();
  await db.run(`INSERT INTO sessions (token, kind, subject_id, expires_at, created_at, last_seen_at, ip, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  sha256(token), kind, subjectId, new Date(Date.now() + rule.absoluteMs).toISOString(), t, t,
  clientIp(req), String(req.headers['user-agent'] || '').slice(0, 200));
  return sessionCookie(kind, token, Math.floor(rule.absoluteMs / 1000));
}

async function getSession(req, kind) {
  const token = parseCookies(req)[cookieName(kind)];
  if (!token) return null;
  const hash = sha256(token);
  const s = await db.get('SELECT * FROM sessions WHERE token = ? AND kind = ?', hash, kind);
  if (!s) return null;
  const idleLimit = new Date(Date.now() - SESSION_RULES[kind].idleMs).toISOString();
  if (s.expires_at < now() || (s.last_seen_at || s.created_at) < idleLimit) {
    await db.run('DELETE FROM sessions WHERE token = ?', hash);
    return null;
  }
  // refresh "last seen" at most once a minute
  if (!s.last_seen_at || Date.now() - Date.parse(s.last_seen_at) > 60000) {
    await db.run('UPDATE sessions SET last_seen_at = ? WHERE token = ?', now(), hash);
  }
  return s;
}

async function endSession(req, kind) {
  const token = parseCookies(req)[cookieName(kind)];
  if (token) await db.run('DELETE FROM sessions WHERE token = ?', sha256(token));
  return sessionCookie(kind, '', 0);
}

async function endAllSessions(kind, subjectId, exceptHash = null) {
  await db.run('DELETE FROM sessions WHERE kind = ? AND subject_id = ? AND token != ?', kind, subjectId, exceptHash || '');
}

async function listSessions(kind, subjectId, currentHash) {
  const rows = await db.all(`SELECT token, created_at, last_seen_at, ip, user_agent FROM sessions
      WHERE kind = ? AND subject_id = ? ORDER BY last_seen_at DESC`, kind, subjectId);
  return rows.map((s) => ({ id: s.token.slice(0, 16), current: s.token === currentHash, created_at: s.created_at,
    last_seen_at: s.last_seen_at, ip: s.ip, device: describeAgent(s.user_agent) }));
}

async function endSessionById(kind, subjectId, shortId) {
  const rows = await db.all('SELECT token FROM sessions WHERE kind = ? AND subject_id = ?', kind, subjectId);
  const match = rows.find((r) => r.token.slice(0, 16) === shortId);
  if (match) await db.run('DELETE FROM sessions WHERE token = ?', match.token);
  return !!match;
}
function describeAgent(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return [browser, os].filter(Boolean).join(' on ');
}

async function purgeExpiredSessions() {
  await db.run('DELETE FROM sessions WHERE expires_at < ?', now());
}

// ---------------------------------------------------------------- rate limiting (in memory)

const buckets = new Map();
function hits(key, windowMs) {
  const list = (buckets.get(key) || []).filter((x) => Date.now() - x < windowMs);
  buckets.set(key, list);
  return list;
}
// Failed sign-ins: 10 per 15 minutes per IP (on top of the per-account lockout).
// Sign-ups have their own bucket so creating accounts never blocks signing in.
const AUTH_LIMIT = Number(process.env.AUTH_FAIL_LIMIT) || 10;
function rateLimit(req, bucket = 'auth') {
  if (hits(`${bucket}:${clientIp(req)}`, 15 * 60000).length >= AUTH_LIMIT) throw new HttpError(429, 'Too many attempts. Please wait 15 minutes and try again.');
}
function recordAttempt(req, bucket = 'auth') { hits(`${bucket}:${clientIp(req)}`, 15 * 60000).push(Date.now()); }
// General limiter, e.g. limit(`api:${ip}`, 600, 60000)
function limit(key, max, windowMs, message = 'Too many requests. Please slow down.') {
  const list = hits(key, windowMs);
  if (list.length >= max) throw new HttpError(429, message);
  list.push(Date.now());
}
setInterval(() => { for (const [k, v] of buckets) if (!v.length || Date.now() - v[v.length - 1] > 3600000) buckets.delete(k); }, 600000).unref();

const str = (v, max = 5000) => (v == null ? null : String(v).trim().slice(0, max) || null);

// ---------------------------------------------------------------- licensing

function accessFor(clinic, settings) {
  const t = now();
  let status;
  let endsAt = null;
  if (clinic.plan === 'suspended') status = 'suspended';
  else if (clinic.plan === 'active') {
    endsAt = clinic.active_until;
    status = !endsAt || endsAt > t ? 'active' : 'expired';
  } else {
    endsAt = clinic.trial_ends_at;
    status = endsAt > t ? 'trial' : 'expired';
  }
  const daysLeft = endsAt ? Math.max(0, Math.ceil((Date.parse(endsAt) - Date.now()) / DAY_MS)) : null;
  const locked = status === 'suspended' || (status === 'expired' && settings.expired_mode === 'locked');
  return {
    status,
    plan: clinic.plan,
    ends_at: endsAt,
    days_left: daysLeft,
    lifetime: clinic.plan === 'active' && !clinic.active_until,
    can_write: status === 'trial' || status === 'active',
    can_read: !locked,
  };
}

// ---------------------------------------------------------------- static files & headers

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

// Serves a built single-page app; unknown paths fall back to index.html.
function staticServer(dir) {
  return function serveStatic(req, res, pathname) {
    let rel;
    try { rel = pathname === '/' ? '/index.html' : decodeURIComponent(pathname); } catch { return send(res, 400, 'Bad path'); }
    const file = path.normalize(path.join(dir, rel));
    if (!file.startsWith(dir + path.sep)) return send(res, 403, { error: 'Forbidden' });
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      // hashed build assets can be cached forever; html must always be fresh
      const immutable = /[\\/]assets[\\/]/.test(file);
      return send(res, 200, fs.readFileSync(file), {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
    }
    const index = path.join(dir, 'index.html');
    if (fs.existsSync(index)) return send(res, 200, fs.readFileSync(index), { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
    send(res, 503, 'The app has not been built yet. Run "npm run build" in the frontend folder.', { 'Content-Type': 'text/plain' });
  };
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()',
  // cdn.jsdelivr.net + wasm + blob workers are needed only for the in-browser OCR engine (tesseract.js)
  'Content-Security-Policy': "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  ...(SECURE_COOKIES ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
};

// Identify a file by its first bytes (never trust the file name or browser-supplied type).
function sniffFile(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (buf.length > 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  return null;
}

module.exports = {
  TRIAL_DAYS, MIN_PASSWORD, DAY_MS, SECURE_COOKIES, HttpError, uid, hashPassword, verifyPassword, burnPasswordCheck,
  normEmail, checkRealEmail, checkPassword, send, readBody, readRaw, parseCookies, checkSameOrigin, createSession, getSession,
  endSession, endAllSessions, listSessions, endSessionById, purgeExpiredSessions, rateLimit, recordAttempt, limit,
  str, accessFor, staticServer, SECURITY_HEADERS, sniffFile, sha256,
};
