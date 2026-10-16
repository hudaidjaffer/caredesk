// Database layer: Supabase (PostgreSQL). Every clinic's data lives in one schema, separated by clinic_id.
// Settings come from clinic-app/.env (see .env.example) or real environment variables.
const fs = require('node:fs');
const path = require('node:path');
const { Pool, types } = require('pg');

const ENV_FILE = path.join(__dirname, '.env');
if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);   // existing environment variables win

// Return BIGINT and NUMERIC as JavaScript numbers (counts, money in cents, sums).
types.setTypeParser(20, (v) => Number.parseInt(v, 10));
types.setTypeParser(1700, (v) => Number.parseFloat(v));

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');   // local: encryption key, backups, local uploads
fs.mkdirSync(DATA_DIR, { recursive: true });
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

const SCHEMA = process.env.DB_SCHEMA || 'caredesk';
if (!/^[a-z_][a-z0-9_]{0,40}$/.test(SCHEMA)) throw new Error('DB_SCHEMA may only contain lowercase letters, digits and _.');

function connectionConfig() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error('DATABASE_URL is not set.\n  Copy clinic-app/.env.example to clinic-app/.env and paste your Supabase connection string (see GUIDE.md).');
  }
  let url;
  try { url = new URL(raw); } catch { throw new Error('DATABASE_URL is not a valid postgresql:// connection string.'); }
  if (url.port === '6543') {
    throw new Error('DATABASE_URL uses the Supabase "Transaction pooler" (port 6543), which this server cannot use.\n'
      + '  In Supabase → Connect, copy the "Direct connection" or the "Session pooler" string (port 5432) instead.');
  }
  url.searchParams.delete('sslmode');           // TLS is configured below instead
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  let ssl = false;
  if (!local) {
    // Encrypted connection to Supabase. Download the Supabase CA certificate (Database settings → SSL)
    // and set DATABASE_CA_CERT to its path to also verify the server's identity.
    ssl = process.env.DATABASE_CA_CERT
      ? { ca: fs.readFileSync(path.resolve(__dirname, process.env.DATABASE_CA_CERT), 'utf8'), rejectUnauthorized: true }
      : { rejectUnauthorized: false };
  }
  return { connectionString: url.toString(), ssl, max: Number(process.env.DB_POOL_SIZE) || 8,
    idleTimeoutMillis: 30000, connectionTimeoutMillis: 15000, application_name: 'caredesk' };
}

const pool = new Pool(connectionConfig());
pool.on('error', (err) => console.error('Database connection error:', err.message));

// Every pooled connection is pointed at our schema once, before its first use.
const prepared = new WeakSet();
async function checkout() {
  const client = await pool.connect();
  if (!prepared.has(client)) {
    try {
      await client.query(`SET search_path TO ${SCHEMA}, public`);
    } catch (err) {
      client.release(err);
      throw err;
    }
    prepared.add(client);
  }
  return client;
}

// Runs one statement on a pooled connection.
const pooled = {
  query: async (text, params) => {
    const client = await checkout();
    try { return await client.query(text, params); } finally { client.release(); }
  },
};

// SQL is written with ? placeholders (and ?1, ?2 for repeats); Postgres wants $1, $2.
function toPg(sql) {
  let i = 0;
  return sql.replace(/\?(\d+)?/g, (_, n) => `$${n || ++i}`);
}

function api(runner) {
  const query = (sql, params) => runner.query(toPg(sql), params);
  return {
    all: async (sql, ...params) => (await query(sql, params)).rows,
    get: async (sql, ...params) => (await query(sql, params)).rows[0],
    run: async (sql, ...params) => { const r = await query(sql, params); return { changes: r.rowCount, rows: r.rows }; },
  };
}

const db = api(pooled);

// Runs fn(t) inside one transaction; t has the same all/get/run methods.
async function tx(fn) {
  const client = await checkout();
  try {
    await client.query('BEGIN');
    const result = await fn(api(client));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  totp_secret TEXT, totp_pending TEXT, totp_enabled INTEGER DEFAULT 0, totp_last_step BIGINT DEFAULT 0,
  recovery_codes TEXT, failed_logins INTEGER DEFAULT 0, locked_until TEXT, password_changed_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS clinics (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_name TEXT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  clinic_type TEXT,
  currency TEXT DEFAULT '$',
  tax_rate DOUBLE PRECISION DEFAULT 0,
  invoice_footer TEXT,
  invoice_seq INTEGER DEFAULT 0,
  plan TEXT NOT NULL DEFAULT 'trial',          -- trial | active | suspended
  prev_plan TEXT,
  trial_ends_at TEXT NOT NULL,
  active_until TEXT,                           -- NULL with plan=active means lifetime
  admin_note TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  totp_secret TEXT, totp_pending TEXT, totp_enabled INTEGER DEFAULT 0, totp_last_step BIGINT DEFAULT 0,
  recovery_codes TEXT, failed_logins INTEGER DEFAULT 0, locked_until TEXT, password_changed_at TEXT,
  ai_enabled INTEGER,                          -- NULL = use the owner's default
  ai_monthly_limit DOUBLE PRECISION            -- USD; NULL = use the owner's default
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,                      -- SHA-256 of the session token
  kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT, last_seen_at TEXT, ip TEXT, user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_subject ON sessions(kind, subject_id);

-- Sign-ups waiting for their email to be confirmed; the clinic is only created after verification.
CREATE TABLE IF NOT EXISTS signup_verifications (
  email TEXT PRIMARY KEY,
  details TEXT NOT NULL,                       -- JSON: clinic name, type, owner name, phone, password hash
  code_hash TEXT NOT NULL,                     -- SHA-256 of email + 6-digit code
  token_hash TEXT UNIQUE NOT NULL,             -- SHA-256 of the one-click link token
  attempts INTEGER DEFAULT 0,
  sends INTEGER DEFAULT 1,
  last_sent_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ip TEXT
);

CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id),
  first_name TEXT NOT NULL, last_name TEXT, dob TEXT, gender TEXT, phone TEXT, email TEXT,
  address TEXT, emergency_contact TEXT, insurance TEXT, allergies TEXT, medical_history TEXT, medications TEXT, notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_patients_clinic ON patients(clinic_id, last_name);

CREATE TABLE IF NOT EXISTS practitioners (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id),
  name TEXT NOT NULL, role TEXT, phone TEXT, email TEXT, color TEXT, active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id),
  name TEXT NOT NULL, category TEXT, duration_min INTEGER DEFAULT 30, price BIGINT DEFAULT 0, active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id),
  patient_id TEXT NOT NULL, practitioner_id TEXT, service_id TEXT,
  starts_at TEXT NOT NULL,                     -- local 'YYYY-MM-DDTHH:MM'
  duration_min INTEGER DEFAULT 30,
  status TEXT DEFAULT 'scheduled',
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_appts_clinic ON appointments(clinic_id, starts_at);

CREATE TABLE IF NOT EXISTS clinical_notes (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id),
  patient_id TEXT NOT NULL, practitioner_id TEXT, date TEXT NOT NULL, area TEXT,
  subjective TEXT, objective TEXT, assessment TEXT, plan TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_clinic ON clinical_notes(clinic_id, date);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id),
  number TEXT NOT NULL, patient_id TEXT NOT NULL, date TEXT NOT NULL, due_date TEXT,
  items TEXT NOT NULL,                         -- JSON [{description, qty, unit_price, service_id}]
  subtotal BIGINT NOT NULL, discount BIGINT DEFAULT 0, tax_rate DOUBLE PRECISION DEFAULT 0, tax BIGINT DEFAULT 0,
  total BIGINT NOT NULL, paid BIGINT DEFAULT 0, status TEXT DEFAULT 'unpaid', notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoices_clinic ON invoices(clinic_id, date);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id),
  invoice_id TEXT NOT NULL, patient_id TEXT NOT NULL, date TEXT NOT NULL, amount BIGINT NOT NULL, method TEXT, reference TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_clinic ON payments(clinic_id, date);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id),
  date TEXT NOT NULL, category TEXT NOT NULL, description TEXT, amount BIGINT NOT NULL, method TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expenses_clinic ON expenses(clinic_id, date);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id),
  patient_id TEXT NOT NULL, title TEXT, category TEXT, filename TEXT,
  mime TEXT NOT NULL, ext TEXT NOT NULL, size BIGINT,
  ocr_text TEXT, ocr_lang TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_clinic ON documents(clinic_id, patient_id, created_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  at TEXT NOT NULL,
  clinic_id TEXT, actor TEXT NOT NULL, actor_id TEXT, action TEXT NOT NULL,
  entity TEXT, entity_id TEXT, detail TEXT, ip TEXT, user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_clinic ON audit_log(clinic_id, at);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);

CREATE TABLE IF NOT EXISTS ai_usage (
  clinic_id TEXT NOT NULL,
  month TEXT NOT NULL,
  requests BIGINT DEFAULT 0, prompt_tokens BIGINT DEFAULT 0, completion_tokens BIGINT DEFAULT 0, cost_usd DOUBLE PRECISION DEFAULT 0,
  PRIMARY KEY (clinic_id, month)
);
`;

const TABLES = ['admins', 'settings', 'clinics', 'sessions', 'signup_verifications', 'patients', 'practitioners', 'services', 'appointments',
  'clinical_notes', 'invoices', 'payments', 'expenses', 'documents', 'audit_log', 'ai_usage'];

// Creates the schema and tables (safe to run every start, and from both programs at once).
let ready = null;
function init() {
  if (!ready) {
    ready = (async () => {
      const client = await checkout();
      try {
        await client.query("SELECT pg_advisory_lock(hashtext('caredesk_schema'))");
        try {
          await client.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
          await client.query(`SET search_path TO ${SCHEMA}, public`);
          await client.query(SCHEMA_SQL);
          // Supabase exposes tables through its public REST API. Our tables live in their own schema
          // (not exposed), have row-level security switched on with no policies, and the API roles get no rights.
          for (const t of TABLES) await client.query(`ALTER TABLE ${SCHEMA}.${t} ENABLE ROW LEVEL SECURITY`);
          const roles = (await client.query("SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')")).rows.map((r) => r.rolname);
          for (const r of roles) {
            await client.query(`REVOKE ALL ON SCHEMA ${SCHEMA} FROM ${r}`);
            await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA ${SCHEMA} FROM ${r}`);
            await client.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${SCHEMA} FROM ${r}`);
          }
        } finally {
          await client.query("SELECT pg_advisory_unlock(hashtext('caredesk_schema'))");
        }
      } finally {
        client.release();
      }
    })().catch((err) => { ready = null; throw friendlyDbError(err); });
  }
  return ready;
}

// Start-up: if Supabase is briefly unreachable (network blip, Supabase incident), keep trying for about a minute
// instead of closing the window straight away. A wrong password is reported immediately.
async function initWithRetry(tries = 7) {
  for (let i = 1; ; i++) {
    try { return await init(); } catch (err) {
      const fatal = /password|not a valid|Transaction pooler|DATABASE_URL is not set|DB_SCHEMA/i.test(err.message);
      if (fatal || i >= tries) throw err;
      console.log(`  Database not reachable yet (${err.message.split('\n')[0]}). Trying again in 10 seconds... (${i}/${tries - 1})`);
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
}

function friendlyDbError(err) {
  const m = String(err && err.message);
  if (/password authentication failed/i.test(m)) return new Error('Supabase rejected the database password in DATABASE_URL.');
  if (/ENOTFOUND|getaddrinfo/i.test(m)) return new Error('Cannot find the database host in DATABASE_URL. Check the address, or use the Supabase "Session pooler" string if your network has no IPv6.');
  if (/ENETUNREACH|EHOSTUNREACH|ECONNREFUSED|timeout/i.test(m)) return new Error(`Cannot reach the database (${m}). Check your internet connection, or use the Supabase "Session pooler" connection string.`);
  return err;
}

const now = () => new Date().toISOString();

const DEFAULT_SETTINGS = {
  product_name: 'CareDesk',
  support_name: '',
  support_email: '',
  support_phone: '',
  expired_mode: 'readonly',                    // readonly | locked
  ai_key: '',                                  // encrypted
  ai_model: 'anthropic/claude-sonnet-5.5',
  ai_zdr: '1',
  ai_hide_names: '1',
  ai_default_enabled: '1',
  ai_default_limit: '5',
  signup_verify: '0',                          // '1' = new sign-ups must confirm their email (code or link); OFF (owner's choice)
  public_url: '',                              // website address used in email links, e.g. https://x.ngrok-free.app
  smtp_host: 'smtp.gmail.com',
  smtp_port: '465',
  smtp_user: 'caredesksupportt@gmail.com',
  smtp_pass: '',                               // encrypted
  smtp_from: 'caredesksupportt@gmail.com',
};

async function getSettings(runner = db) {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of await runner.all('SELECT key, value FROM settings')) out[row.key] = row.value;
  return out;
}

async function setSetting(key, value, runner = db) {
  await runner.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, value);
}

const close = () => pool.end();

module.exports = {
  db, tx, init, initWithRetry, close, now, getSettings, setSetting, DEFAULT_SETTINGS, DATA_DIR, UPLOAD_DIR, BACKUP_DIR, SCHEMA, TABLES, pool,
};
