// Encrypted backups of the whole Supabase database (every table, as compressed JSON).
// Saved in DATA_DIR/backups (last 14 kept) and, when Supabase Storage is configured, also in the
// private bucket under backups/. Uploaded photos already live in storage and are not repeated here.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { db, tx, TABLES, BACKUP_DIR, getSettings, setSetting } = require('./db');
const { encryptBuffer, decryptBuffer } = require('./security');
const storage = require('./storage');

const KEEP = 14;
const NAME_RE = /^caredesk-[\d-]+\.backup$/;

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter((f) => NAME_RE.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(BACKUP_DIR, f));
      return { file: f, size: st.size, created_at: st.mtime.toISOString() };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

const KEEP_REMOTE = 30;

// Backups on this computer plus those in the Supabase Storage bucket (online servers have no lasting disk).
async function listAllBackups() {
  const out = new Map(listBackups().map((b) => [b.file, b]));
  if (storage.useSupabase) {
    for (const o of await storage.list('backups')) {
      if (NAME_RE.test(o.name) && !out.has(o.name)) out.set(o.name, { file: o.name, size: o.size, created_at: o.created_at });
    }
  }
  return [...out.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

// The (still encrypted) backup file, from this computer or from the bucket; null if not found.
async function readBackupBuffer(name) {
  if (!NAME_RE.test(String(name))) return null;
  const local = path.join(BACKUP_DIR, name);
  if (fs.existsSync(local)) return fs.readFileSync(local);
  return storage.useSupabase ? storage.get(`backups/${name}`) : null;
}

async function pruneRemote() {
  const old = (await storage.list('backups')).filter((o) => NAME_RE.test(o.name))
    .sort((a, b) => b.name.localeCompare(a.name)).slice(KEEP_REMOTE);
  if (old.length) await storage.remove(old.map((o) => `backups/${o.name}`));
}

async function dumpAll() {
  const out = { format: 'caredesk-backup', version: 1, created_at: new Date().toISOString(), tables: {} };
  for (const t of TABLES) {
    if (t === 'sessions') continue;                       // sign-ins are not worth restoring
    out.tables[t] = await db.all(`SELECT * FROM ${t}`);
  }
  return out;
}

async function createBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const name = `caredesk-${stamp}.backup`;
  const sealed = encryptBuffer(zlib.gzipSync(Buffer.from(JSON.stringify(await dumpAll()))));
  fs.writeFileSync(path.join(BACKUP_DIR, name), sealed, { mode: 0o600 });
  if (storage.useSupabase) {
    await storage.put(`backups/${name}`, sealed).then(pruneRemote).catch((err) => console.error('Backup copy to Supabase Storage failed:', err.message));
  }
  await setSetting('last_backup_at', new Date().toISOString());
  for (const old of listBackups().slice(KEEP)) fs.rmSync(path.join(BACKUP_DIR, old.file), { force: true });
  return name;
}

function backupPath(name) {
  if (!NAME_RE.test(String(name))) return null;
  const file = path.join(BACKUP_DIR, name);
  return fs.existsSync(file) ? file : null;
}

function readBackupFile(file) {
  const data = JSON.parse(zlib.gunzipSync(decryptBuffer(fs.readFileSync(file))).toString('utf8'));
  if (data.format !== 'caredesk-backup') throw new Error('This is not a CareDesk backup file.');
  return data;
}

// Replaces ALL current data with the backup's data (one transaction: all or nothing).
async function restoreBackup(file) {
  const data = readBackupFile(file);
  await tx(async (t) => {
    // children first, so foreign keys are never violated
    const order = TABLES.filter((x) => x !== 'clinics' && x !== 'sessions').concat('clinics');
    for (const table of order) await t.run(`DELETE FROM ${table}`);
    await t.run('DELETE FROM sessions');
    for (const table of ['clinics', ...TABLES.filter((x) => x !== 'clinics' && x !== 'sessions')]) {
      for (const row of data.tables[table] || []) {
        const cols = Object.keys(row).filter((c) => /^[a-z_]+$/.test(c));
        await t.run(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map((c) => row[c]));
      }
    }
    await t.run("SELECT setval(pg_get_serial_sequence('audit_log', 'id'), COALESCE((SELECT MAX(id) FROM audit_log), 0) + 1, false)");
  });
  return Object.fromEntries(Object.entries(data.tables).map(([k, v]) => [k, v.length]));
}

// Runs a backup at start-up if the last one is older than 24h, then checks every hour.
function scheduleBackups() {
  const run = async () => {
    try {
      const last = Date.parse((await getSettings()).last_backup_at || 0) || 0;
      if (Date.now() - last < 24 * 3600000) return;
      console.log(`  Backup saved: ${await createBackup()}`);
    } catch (err) {
      console.error('Backup failed:', err.message);
    }
  };
  setTimeout(run, 15000).unref();
  setInterval(run, 3600000).unref();
}

module.exports = { listBackups, listAllBackups, readBackupBuffer, createBackup, backupPath, readBackupFile, restoreBackup, scheduleBackups };
