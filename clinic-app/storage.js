// File storage for uploaded documents and backups.
// With SUPABASE_URL + SUPABASE_SECRET_KEY set, files go to a PRIVATE Supabase Storage bucket;
// otherwise they are kept on this computer in DATA_DIR/uploads. Files are always encrypted before storing.
const fs = require('node:fs');
const path = require('node:path');
const { UPLOAD_DIR } = require('./db');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET = process.env.SUPABASE_BUCKET || 'caredesk-files';
const useSupabase = !!(SUPABASE_URL && KEY);

const safeKey = (key) => {
  if (!/^[\w.-]+(\/[\w.-]+)*$/.test(key) || key.includes('..')) throw new Error(`Invalid storage key: ${key}`);
  return key;
};

// New "sb_secret_..." keys go on the apikey header; legacy service_role JWTs also need Authorization.
const authHeaders = () => ({ apikey: KEY, ...(KEY.startsWith('eyJ') ? { Authorization: `Bearer ${KEY}` } : {}) });
const objectUrl = (key) => `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${safeKey(key).split('/').map(encodeURIComponent).join('/')}`;

async function call(url, opts, what) {
  let res;
  try {
    res = await fetch(url, { ...opts, headers: { ...authHeaders(), ...(opts.headers || {}) }, signal: AbortSignal.timeout(60000) });
  } catch (err) {
    throw new Error(`Supabase Storage unreachable (${what}): ${err.message}`);
  }
  return res;
}

async function ensureBucket() {
  if (!useSupabase) return;
  const res = await call(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
  }, 'create bucket');
  if (res.ok) return;
  const text = await res.text();
  if (/already exists|duplicate/i.test(text) || res.status === 409) return;
  if (res.status === 401 || res.status === 403) throw new Error('Supabase rejected SUPABASE_SECRET_KEY (use the secret / service_role key, never the publishable/anon key).');
  throw new Error(`Could not create the storage bucket "${BUCKET}": ${res.status} ${text.slice(0, 200)}`);
}

async function put(key, buf) {
  if (!useSupabase) {
    const file = path.join(UPLOAD_DIR, safeKey(key));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, buf);
    fs.renameSync(`${file}.tmp`, file);
    return;
  }
  const res = await call(objectUrl(key), {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' }, body: buf,
  }, 'upload');
  if (!res.ok) throw new Error(`Upload to Supabase Storage failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

// Returns a Buffer, or null if the file doesn't exist.
async function get(key) {
  if (!useSupabase) {
    try { return fs.readFileSync(path.join(UPLOAD_DIR, safeKey(key))); } catch { return null; }
  }
  const res = await call(objectUrl(key), { method: 'GET' }, 'download');
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`Download from Supabase Storage failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function remove(keys) {
  const list = (Array.isArray(keys) ? keys : [keys]).map(safeKey);
  if (!list.length) return;
  if (!useSupabase) {
    for (const k of list) fs.rmSync(path.join(UPLOAD_DIR, k), { force: true });
    return;
  }
  const res = await call(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: list }),
  }, 'delete');
  if (!res.ok && res.status !== 404) console.error('Supabase Storage delete failed:', res.status);
}

// Lists files in a folder of the bucket: [{ name, size, created_at }] (Supabase only; [] for local storage).
async function list(prefix) {
  if (!useSupabase) return [];
  const res = await call(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: safeKey(prefix), limit: 1000, offset: 0, sortBy: { column: 'name', order: 'desc' } }),
  }, 'list');
  if (!res.ok) throw new Error(`Listing Supabase Storage failed: ${res.status}`);
  return (await res.json()).filter((o) => o.id || o.metadata)                 // folders have no id/metadata
    .map((o) => ({ name: o.name, size: (o.metadata && o.metadata.size) || 0, created_at: o.created_at }));
}

module.exports = { put, get, remove, list, ensureBucket, useSupabase, BUCKET, describe: () => (useSupabase ? `Supabase Storage (bucket "${BUCKET}")` : `this computer (${UPLOAD_DIR})`) };
