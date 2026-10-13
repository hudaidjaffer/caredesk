// One-time move of data from the old local SQLite database (clinic-app/data/clinic.db) into Supabase.
// Run from the owner-panel folder:  node server.js import-sqlite [path/to/clinic.db]
// Safe to run more than once: rows that already exist in Supabase are skipped.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { db, tx, TABLES, DATA_DIR } = require('../db');
const { encryptFields, encryptBuffer, isEncryptedBuffer } = require('../security');
const storage = require('../storage');

async function importFromSqlite(file) {
  if (!fs.existsSync(file)) throw new Error(`Old database not found: ${file}`);
  const old = new DatabaseSync(file, { readOnly: true });
  const oldTables = new Set(old.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
  const report = {};

  await tx(async (t) => {
    // parents first (clinics) so foreign keys are satisfied
    const order = ['admins', 'settings', 'clinics', ...TABLES.filter((x) => !['admins', 'settings', 'clinics', 'sessions'].includes(x))];
    for (const table of order) {
      if (!oldTables.has(table)) continue;
      const pgCols = (await t.all('SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?', table))
        .map((r) => r.column_name);
      const rows = old.prepare(`SELECT * FROM ${table}`).all();
      let copied = 0;
      for (const raw of rows) {
        // encrypt any medical fields that were still stored as plain text
        const row = encryptFields(table, { ...raw });
        if (table === 'audit_log') delete row.id;                // new ids are assigned
        const cols = Object.keys(row).filter((c) => pgCols.includes(c));
        let r;
        if (table === 'audit_log') {
          // log entries have no natural key: skip ones already copied by an earlier run
          r = await t.run(`INSERT INTO audit_log (${cols.join(',')}) SELECT ${cols.map(() => '?').join(',')}
            WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE at = ? AND action = ? AND COALESCE(clinic_id, '') = COALESCE(?, '') AND COALESCE(actor_id, '') = COALESCE(?, ''))`,
          ...cols.map((c) => row[c]), row.at, row.action, row.clinic_id ?? null, row.actor_id ?? null);
        } else {
          r = await t.run(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')}) ON CONFLICT DO NOTHING`,
            ...cols.map((c) => row[c]));
        }
        copied += r.changes;
      }
      report[table] = `${copied} of ${rows.length}`;
    }
  });

  // uploaded files: make sure they're encrypted, and copy them to Supabase Storage when that's in use
  let files = 0;
  const uploads = path.join(path.dirname(file), 'uploads');
  if (fs.existsSync(uploads)) {
    for (const clinicDir of fs.readdirSync(uploads)) {
      const dir = path.join(uploads, clinicDir);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.tmp')) continue;
        const buf = fs.readFileSync(path.join(dir, f));
        const sealed = isEncryptedBuffer(buf) ? buf : encryptBuffer(buf);
        if (storage.useSupabase || sealed !== buf) await storage.put(`${clinicDir}/${f}`, sealed);
        files++;
      }
    }
  }
  old.close();
  console.log('\n  Imported into Supabase:');
  for (const [k, v] of Object.entries(report)) console.log(`   ${k.padEnd(15)} ${v}`);
  console.log(`   files           ${files} ${storage.useSupabase ? 'copied to Supabase Storage' : 'checked (kept on this computer)'}`);
  const n = (await db.get('SELECT COUNT(*) AS n FROM clinics')).n;
  console.log(`\n  Done. Supabase now has ${n} clinic(s). Everyone will need to sign in again.\n`);
}

module.exports = { importFromSqlite, DEFAULT_FILE: path.join(DATA_DIR, 'clinic.db') };
