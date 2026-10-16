# Project context for Claude (read this first)

This file is the full handover from earlier chats, so a new chat can continue without the owner
re-explaining anything. Claude Code loads it automatically when a session starts in this folder.
Keep it updated when something important changes.

---

## 1. Who / what

- **Owner (the user):** non-technical business owner (email hudaidjaffer@hotmail.com, Windows 11, PowerShell).
  Plans to **sell/offer clinic software** to dentists, therapists, physiotherapists and small medical clinics
  (example data uses Pakistan: Rs currency, Lahore, Urdu OCR option). Prefers plain explanations,
  step-by-step "how to run it" instructions, and wants things done end-to-end and tested.
- **Product:** **CareDesk** (placeholder name, changeable in the owner panel → Settings): a multi-clinic
  practice-management web app. Clinics self-register with email + password and get a **7-day free trial with
  unlimited use**; after that **only the owner can activate** them.
- The folder originally contained **ERPClaw** (`README.md`, `SKILL.md`, `scripts/`, `mcp/`, `bin/`, `assets/`, `UI.yaml`,
  `CHANGELOG.md`): a GPL-3 Python AI-chat accounting engine. **It is untouched and NOT used** by CareDesk.
  We decided early on to build a separate app because ERPClaw has no web UI, needs Python (not installed),
  and isn't designed for clinics. CareDesk shares no code with ERPClaw.

## 2. What the owner asked for, in order (all done)

1. Clinic software for medical clients, a nicer medical-looking frontend, email/password sign-up (no password
   complexity rules, just a 4-char minimum), 7-day free trial, then a restriction only the owner can lift,
   unlimited entries, a feature list, and teaching on how to run and control it.
2. Owner panel "not working" → root cause: no owner account had been created (the `create-admin` command was never run).
   Fixed with a first-run setup screen; **owner panel moved to its own folder** (`owner-panel/`).
3. "Where is the Manage option?" → it was off-screen in a wide table; redesigned as clinic cards with a visible **Manage** button.
4. **OCR + picture uploads**: patient documents with in-browser text reading, scan-to-fill patient forms, scan receipts.
5. **Full security hardening** + **React frontend** (React, lucide-react, Recharts) + **AI via OpenRouter**
   (owner's single key) + **no RAG for now** + **Excel import + export**.
   - AI features chosen: answer any question about the clinic's own data, patient summary, write SOAP notes from
     rough notes, tidy scanned text / extract lab values.
6. **Database must be Supabase** → migrated from local SQLite to Supabase Postgres (+ optional Supabase Storage).
7. This handover document.
8. (2026-10-04) **Email verification at sign-up** (6-digit code + one-click link, either works) and **min password 8**
   (owner changed their mind from 4). See §5a. Then, same day, the owner said **"hold it for now"**: verification is
   switched OFF (code kept, dormant) and replaced by a **"real email" check** at sign-up (§5a). Min password 8 stays.

## 3. Current status (as of 2026-10-04)

- **Code is complete and tested locally.** We are in the middle of **going online via ngrok + Supabase** (see §3a).
- The owner's **old real data** is still in `clinic-app/data/clinic.db` (SQLite, from before the Supabase move):
  1 clinic + 1 owner account + test data. To move it: `cd owner-panel && node server.js import-sqlite`
  (needs `.env` first). `clinic-app/data/secret.key` must be kept: it decrypts that data.
- The **real OpenRouter key has not been tested** (only a mock). Default model `anthropic/claude-sonnet-5.5`.
- Nothing is deployed online yet. No git repository (folder is not a git repo).
- Owner's to-do list after going online: run both start.bat files → owner panel (http://localhost:4000): create account,
  turn on 2FA, **save the encryption recovery key offline**, add support contact, add OpenRouter key → run `import-sqlite` once.

## 3a. Deployment in progress: ngrok + Supabase (chat of 2026-10-03/04)

Goal: owner asked to "deploy on ngrok and share link". Plan: the app runs on the owner's Windows PC, Supabase holds the
data, ngrok gives a public HTTPS link to **port 3000 only** (clinic app). **Never tunnel port 4000** (owner panel stays local).
Owner was told plainly: ngrok is fine for demos/1–3 pilot clinics; for real paying clinics move to a VPS (GUIDE.md §6).
Owner was told Supabase Free is enough to start (~500 MB DB, ~1 GB files, pauses after ~1 week idle → "Restore";
upgrade to Pro ~$25/mo once clinics pay). Claude must NOT create accounts or type passwords/tokens: the owner does those,
and must never paste the DB password / secret key / ngrok token into chat (only into `.env` / PowerShell).

Code change made for this: `TRUST_PROXY` in `security.js clientIp()` (see §6), tested (XFF used only from loopback).

**Done so far**
- `clinic-app/.env` created by Claude from `.env.example`; `SECURE_COOKIES=1` and `TRUST_PROXY=1` set (plain lines, no inline comments);
  `SUPABASE_URL=https://aqmzbhgrciqojbkrwcxo.supabase.co` filled in (not secret).
- Supabase account + project created ("hudaidjaffer@hotmail.com's Project", Free plan, region **Southeast Asia (Singapore)
  ap-southeast-1**, status Healthy). Owner may not know the DB password → told to reset it in Project Settings →
  Database → Reset database password, **letters and numbers only** (symbols break the URL).
- ngrok account created (dashboard user "Hudaid"); owner was told to pick Command Line → **Windows**. `ngrok` is now
  installed on the PC (found on PATH).

**Update 2026-10-13:** `DATABASE_URL` is now filled (session pooler `aws-0-ap-southeast-1.pooler.supabase.com:5432`,
DB password reset by the owner, letters+numbers) and the clinic app **connects to Supabase and has created its tables**.
The owner fills `.env` with `clinic-app/connect-supabase.bat` (pastes the Supabase URI, types the password hidden; it
URL-encodes the password). Note: right after a password reset Supabase's pooler can reject the new password for
~1–2 minutes. `SUPABASE_SECRET_KEY` still empty (photos stored locally for now). Both `start.bat` files were rewritten
2026-10-13: they had a bug (round brackets inside `echo` text within `if (...)` blocks made cmd crash with ". was unexpected"
or open Notepad instead of starting). Now they use `goto :noconnection`, show a clear message if DATABASE_URL is missing,
and pause after the server stops. **Never put ( ) inside echo text in .bat IF blocks.** Both launchers tested: 3000 and 4000 respond.
**Owner setup done 2026-10-13:** owner account hudaidjaffer@hotmail.com with 2FA ON, support name + email filled
(phone empty). Recovery key NOT yet viewed/saved at last check. No OpenRouter key yet. Owner chose **"start fresh"**:
the old `clinic.db` (3 test trial clinics, 2 patients) is **not imported** (file kept untouched; `import-sqlite` still possible).
Both servers now start with `db.initWithRetry()` (retries 6× every 10 s if Supabase is unreachable; wrong password fails at once),
added after a start failed during a Supabase incident. Claude in Chrome extension was NOT connected (owner did the Supabase steps from screenshots).
Supabase moved "Reset database password" to Database → Settings
(`https://supabase.com/dashboard/project/aqmzbhgrciqojbkrwcxo/database/settings`). Hosting choice still open:
Claude recommended **Render Starter (~$7/mo, Singapore) for the clinic app + owner panel kept on the PC**; Cloudflare only for a
domain/DNS (Workers can't run this app). Render prep needed: CAREDESK_KEY env from secret.key, Supabase Storage key,
`clientIp()` must trust Render's proxy (not loopback), private GitHub repo. Owner hasn't chosen Render vs ngrok yet.

**Render prep (2026-10-13, owner chose Render; start on the Free plan, upgrade to Starter when giving real trials):**
- `render.yaml` (Blueprint, repo root): web service `caredesk`, region singapore, plan free, build
  `cd frontend && npm ci --include=dev && npm run build:clinic && cd ../clinic-app && npm ci --omit=dev`, start
  `cd clinic-app && node server.js`, health `/api/public-settings`, env NODE_VERSION=24, SECURE_COOKIES=1, TRUST_PROXY=all,
  SUPABASE_URL; secrets typed by the owner in Render: DATABASE_URL, SUPABASE_SECRET_KEY, CAREDESK_KEY (= contents of secret.key).
- Code: `TRUST_PROXY=all` trusts the last X-Forwarded-For from any peer (Render); on Render (`RENDER` env) or
  `REQUIRE_KEY_ENV=1` the app refuses to start without CAREDESK_KEY; `sec.verifyKey()` (both servers, after init) stores an
  encrypted `key_check` setting on first start and refuses to start if the key can't read it. **Marker already stored in the
  real `caredesk` schema with the PC key (2026-10-13).**
- Root `.gitignore` excludes secrets (.env, data/, *.key, *.db, *.backup), node_modules, dist, and the ERPClaw files.
- Tested on a clean copy of only the uploadable files (75 files, no secrets): Render build command OK; simulated Render
  (RENDER=true, temp schema in Supabase, dropped afterwards): no key → refuses; key → starts, __Host- Secure cookie, HSTS,
  visitor IP from XFF; wrong key → refuses with message. Local embedded Postgres no longer starts on this PC
  (initdb exit 0xC0000135 DLL not found), so that test used a throwaway Supabase schema.
- **Done 2026-10-13:** Git for Windows 2.55 installed (winget, owner approved; `C:\Program Files\Git\cmd\git.exe`, not on
  PATH in older shells). The project folder is now a git repo (branch `main`), pushed to the PRIVATE repo
  **https://github.com/hudaidjaffer/caredesk** (75 files, secrets verified absent). GitHub sign-in is stored in Windows
  Credential Manager, so Claude can push updates. Claude's shell has GCM_INTERACTIVE=never / GIT_TERMINAL_PROMPT=0; to
  let the owner sign in, open a visible .bat window that clears those variables first.
- **LIVE 2026-10-13: https://caredesk-t6nm.onrender.com** (Render Blueprint "caredesk", Free plan, Singapore;
  `caredesk.onrender.com` belongs to someone else). Log showed DB + Supabase Storage (bucket caredesk-files) connected, so all
  3 secrets are set correctly. Verified from outside: page loads, HSTS/CSP/X-Frame on, 8-char rule and real-email check work,
  /api/me 401 when signed out. autoDeploy is on: every `git push` to main redeploys. Free plan sleeps after 15 min idle →
  owner told to upgrade to Starter before real trials. Owner should now run ONLY the owner panel on the PC.
- **Owner panel ONLINE 2026-10-14: https://caredesk-owner.onrender.com** (owner asked to move it to the cloud).
  Second Render service `caredesk-owner` in render.yaml (secrets via `fromService` from `caredesk`, OWNER_PUBLIC=1).
  Online mode (`ONLINE` in owner-panel/server.js = RENDER or OWNER_PUBLIC=1): binds 0.0.0.0 on Render's PORT; sign-in
  REQUIRES 2FA (password-only → 403 "requires two-step sign-in"); 2FA can't be disabled online; `/api/admin/encryption-key`
  → 403 (key only viewable in the PC owner panel); backups listed/downloaded via `backup.listAllBackups()` /
  `readBackupBuffer()` from Supabase Storage (`storage.list()`), Storage keeps newest 30 (`pruneRemote`). First-run
  setup stays impossible from the internet. Tested: scratchpad `test-owner-online.js` 24/24 (throwaway schema + mock
  Storage). The PC copy still works (local mode) and is needed for: viewing/saving the encryption key, CLI commands
  (create-admin, reset-admin-2fa, restore-backup). Supabase secret key is NOT in the PC .env (photos/backups in Storage
  aren't reachable from the PC panel).
- **Responsive (2026-10-16, owner asked "make both responsive"), live on both sites.** Phone rules are in
  `shared/styles.css` "phones & small tablets" (`@media screen and (max-width: 640px)`): tables with a `<thead>` become
  labelled cards via `shared/responsiveTables.js` (MutationObserver + queueMicrotask, NOT requestAnimationFrame, which never
  fires in background tabs; opt out with `.no-cards`, used on InvoiceView items, Setup services, owner AiTab usage);
  `.items-table` (New invoice) stacks per line using `data-label` on Qty/Price/Amount; modals = bottom sheets; `.seg`
  filters, `.pill-tabs` and `.owner-tabs` wrap as chips; owner top bar hides the email (`.owner-email`); 16px inputs;
  `dvh` heights. Appointments got a **Day** view (`c.view === 'day'`, prev/next ±1 day). Verified at 375/768/1280 with a
  throwaway Supabase schema + seeded data (scratchpad `ui-lab.js`, `node ui-lab.js cleanup` drops it): every clinic
  page, the main modals and all owner tabs have no overflow and no side-scrolling boxes. Browser-pane screenshots are
  flaky when the pane is hidden; measure with JS instead.
- Was next: Git was NOT installed (asked owner for permission to install via winget); owner creates GitHub account + empty
  private repo, Claude commits/pushes (owner signs in to GitHub in the browser popup); owner creates Render account
  (sign in with GitHub) → New → Blueprint → pastes the 3 secrets. After going live, the owner should run only the owner
  panel on the PC (not the clinic app), and add SUPABASE_SECRET_KEY to the PC .env too.

**Still to do (as of 2026-10-04)**
1. ~~Owner pastes into `clinic-app/.env`~~ (done 2026-10-13): `DATABASE_URL` = Supabase **Connect → Connection String → URI → Session pooler**
   (port 5432, host like `aws-0-ap-southeast-1.pooler.supabase.com`, user `postgres.aqmzbhgrciqojbkrwcxo`), replacing
   `[YOUR-PASSWORD]` incl. brackets; and `SUPABASE_SECRET_KEY` = Project Settings → API Keys → Secret keys (`sb_secret_…`,
   not the publishable key). Both still EMPTY at last check.
2. Owner runs `ngrok config add-authtoken <token>` themself (no `%LOCALAPPDATA%\ngrok\ngrok.yml` yet at last check) and
   claims their free static domain in the ngrok dashboard → **Domains**, then tells Claude the domain.
3. Claude then: verify `.env` (report only "filled/empty", never print secrets) → start clinic app (`cd clinic-app && node server.js`,
   check DB connects + schema init) → `ngrok http 3000 --url=https://<their-domain>` → test from outside (ngrok free shows a
   one-time "Visit Site" warning page) → give the owner the link. Offered: a `start-online.bat` that starts app + ngrok together.
4. Then the owner-panel to-do list from §3 (create owner account, 2FA, recovery key, OpenRouter key, `import-sqlite`).

Troubleshooting already explained to owner: ERR_NGROK_4018 (authtoken), ERR_NGROK_8012 (app not running on 3000),
"Request blocked (cross-site)" (use the exact ngrok link), logged out loop (needs SECURE_COOKIES=1 + https link),
PC must stay on / no sleep (Settings → System → Power).

## 4. Architecture

```
erpclaw-main/
├─ clinic-app/        Node 22+ server for clinics (port 3000) + shared backend modules
│  ├─ server.js       HTTP routes (clinic API), serves React build from ./dist
│  ├─ db.js           Supabase/Postgres pool (pg), .env loading, schema creation, tx(), settings
│  ├─ core.js         HTTP helpers, passwords (scrypt), sessions, CSRF origin check, rate limits, licensing (accessFor), CSP/headers, static server
│  ├─ security.js     AES-256-GCM encryption, field encryption map, TOTP 2FA, recovery codes, lockout, audit log
│  ├─ twofactor.js    2FA setup/enable/disable helpers (shared with owner panel)
│  ├─ data.js         all clinic data logic (patients, appointments, notes, invoices, payments, expenses, documents, dashboard, reports, exports)
│  ├─ storage.js      file storage: Supabase Storage private bucket, or local disk fallback
│  ├─ mailer.js       SMTP email (nodemailer): sign-up verification code/link; config in owner settings
│  ├─ ai.js           OpenRouter AI: chat with tools, patient summary, SOAP draft, tidy document; privacy/redaction; usage limits
│  ├─ excel.js        ExcelJS exports (single, all-in-one, report workbook) + patient import (preview/mapping/commit)
│  ├─ backup.js       encrypted gzip-JSON backups of all tables, list, restore
│  ├─ tools/import-sqlite.js  one-time copy of old SQLite data into Supabase
│  ├─ .env.example    config template (copy to .env, never share .env)
│  ├─ GUIDE.md        owner-facing manual (features, Supabase setup, AI, Excel, deploy, backups, daily workflow)
│  ├─ start.bat       Windows launcher (creates .env if missing, installs deps, builds frontend if missing)
│  ├─ dist/           built clinic React app (generated; don't edit)
│  └─ data/           LOCAL ONLY: secret.key, backups/, uploads/ (if no Supabase Storage), old clinic.db
├─ owner-panel/       owner's private panel server (port 4000, binds 127.0.0.1 + ::1 only)
│  ├─ server.js       owner API + CLI commands; requires modules from ../clinic-app via path
│  ├─ start.bat       launcher (requires ../clinic-app/.env)
│  └─ dist/           built owner React app (generated)
└─ frontend/          React source (Vite 8, React 19, lucide-react 1.50, recharts 3)
   ├─ clinic/src/     App.jsx (auth, locked screen, shell, routing), context.js, pages/, components/
   ├─ owner/src/      App.jsx (setup/login/2FA), Clinics, AiTab, AuditTab, SecurityTab, SettingsTab
   ├─ shared/         api.js, format.js, ui.jsx (Modal/Toast/Confirm/useAsync…), Security.jsx (2FA/sessions UI),
   │                  Markdown.jsx (safe renderer, no innerHTML), ocr.js (tesseract.js loader + parsers), styles.css, public/favicon.svg
   ├─ vite.clinic.config.js → builds to ../clinic-app/dist
   └─ vite.owner.config.js  → builds to ../owner-panel/dist
```

- **No framework on the server**: plain `node:http`. Dependencies (clinic-app): `pg 8.23.1`, `exceljs 4.4.0`,
  `qrcode 1.5.4`; npm `overrides` pins `uuid ^11.1.1` (fixes an audit warning inside exceljs). `npm audit`: 0 vulnerabilities.
- Both servers share one database and the same `clinic-app/.env`. The owner panel `require`s clinic-app modules
  (`need('db')`, etc.), so module changes affect both.
- Frontend routing is hash-based (`#/patients/<id>`), with a custom `useHashRoute`, not react-router.
  Global refresh via a `version` counter in context (`refresh()` bumps it and pages refetch).
  Modals are opened via `useModal()` → `open((close) => <X close={close}/>)`.
- **After any frontend change:** `cd frontend && npm run build` (writes both dist folders). The servers serve `dist/`.

### Database (Supabase / Postgres)
- Connection: `DATABASE_URL` (direct connection or **session pooler, port 5432**). The **transaction pooler
  (6543) is refused** on purpose (session `SET search_path` is used). TLS on for non-localhost; `DATABASE_CA_CERT`
  enables certificate verification (otherwise `rejectUnauthorized:false`).
- Tables live in schema **`caredesk`** (`DB_SCHEMA` env). `init()` runs at start (advisory-locked so both programs can
  start together): `CREATE SCHEMA/TABLE IF NOT EXISTS`, `ENABLE ROW LEVEL SECURITY` on every table (no policies),
  and `REVOKE ALL` from Supabase roles `anon`/`authenticated` when they exist. The server connects as `postgres`.
- `db.all/get/run(sql, ...params)` use `?` placeholders (also `?1`, `?2`), converted to `$n`. `tx(async t => …)` for transactions.
  BIGINT/NUMERIC are parsed to JS numbers. Every pooled connection gets `SET search_path` once (WeakSet `prepared`).
- Tables: admins, settings, clinics, sessions, patients, practitioners, services, appointments, clinical_notes,
  invoices, payments, expenses, documents, audit_log (BIGSERIAL id), ai_usage. IDs are UUID text; dates are ISO text;
  **money is BIGINT cents**; appointment `starts_at` is local `YYYY-MM-DDTHH:MM` text.
- Postgres specifics already handled: `ILIKE` + escaped wildcards for search, `lower()` ordering (no COLLATE NOCASE),
  `GROUP BY 1, 2` where needed, invoice numbers via `UPDATE … RETURNING invoice_seq`, payments lock the invoice row
  `FOR UPDATE`, 2FA/recovery codes use compare-and-swap updates, failed-login counter increments in SQL.

### Files (photos/PDFs) and backups
- Storage key `<clinicId>/<docId>.<ext>`. Supabase mode when `SUPABASE_URL` + `SUPABASE_SECRET_KEY` (or legacy
  `SUPABASE_SERVICE_ROLE_KEY`) are set: private bucket `caredesk-files` (`SUPABASE_BUCKET`), auto-created.
  New `sb_secret_…` keys are sent on the `apikey` header only; legacy JWT keys also get `Authorization: Bearer`.
- Files are **encrypted before storing** (magic bytes `CDE1`), decrypted when served. Upload type is checked by file
  signature (JPEG/PNG/WEBP/PDF only, max 15 MB). Served files have CSP `sandbox`; PDFs always download.
- Backups: `backup.js` dumps every table (except sessions) → JSON → gzip → encrypt → `data/backups/caredesk-<stamp>.backup`
  (last 14) + copy to bucket `backups/`. Automatic daily (checked hourly). Restore: `node server.js restore-backup <file> --yes`
  (owner-panel folder; replaces all data in one transaction).

## 5. Business rules

- Trial: `TRIAL_DAYS = 7`, min password `MIN_PASSWORD = 8` (top of `clinic-app/core.js`; was 4 until 2026-10-04,
  existing shorter passwords still sign in). Owner explicitly wanted **no** capital/number/symbol rules; don't add them.
- Plans: `trial | active | suspended` (+ `prev_plan`). `accessFor(clinic, settings)` computes status
  `trial | active | expired | suspended`, `can_write`, `can_read`. Owner setting `expired_mode`:
  `readonly` (default: can view/export, cannot add/edit; HTTP 402 on writes) or `locked` (only a contact-us screen).
  Suspended = fully blocked + all sessions ended.
- Owner "Manage" actions: activate N days / lifetime (days stack), extend trial, revoke (end access now),
  suspend/unsuspend, reset password, reset 2FA, unlock, per-clinic AI on/off + monthly USD limit, private note.
- Clinic sign-up seeds starter services by practice type (dental / therapy / physio / general / other) and the owner as a practitioner.
- No email is sent right now (sign-up verification is on hold, §5a): forgotten passwords and lost 2FA phones are still handled by the owner in Manage.

## 5a. Sign-up email: "real email" check + email verification (BOTH ON since 2026-10-16)

**2026-10-16: owner re-enabled verification** ("email caredesksupportt@gmail.com for 2 step verification and allow only legit
addresses"). Defaults now: `signup_verify: '1'`, smtp_host smtp.gmail.com, port 465, user/from caredesksupportt@gmail.com
(db.js DEFAULT_SETTINGS); the owner only pastes the Gmail **app password** in owner panel → Settings → Email card (rendered again).
`emailReady()` now also needs the password when a username is set, so until it is saved sign-ups get 503 "paused" (fail-closed).
Link base = setting `public_url` or env `PUBLIC_URL` (render.yaml: https://caredesk-t6nm.onrender.com). **Render free plan blocks
SMTP (25/465/587)**: the clinic app must be on a paid instance (Starter) to send; `friendlyMailError` says so when `RENDER` is set.
The online owner panel (free) can't send either, so its test button is hidden online (test = a real sign-up). 4 clinics signed up
before this, incl. hello@clinic.com (likely not the owner of that address). Tested: scratchpad `test-verify.js` 22/22.
Still open: changing the email in clinic Settings is not code-verified (only the real-email check).

**Never POST /api/auth/register (or any write) to the LIVE sites to check a deploy.** On 2026-10-16 a deploy check hit the
old version and created a real clinic ("Deploy check"); the owner approved deleting it. Check deploys by bundle contents
(curl the JS/CSS asset) or read-only GETs only.

(Older notes below.)

**Active now:** sign-up (and changing the clinic email in Settings) calls `checkRealEmail()` in `core.js`: strict format,
rejects common typos with a "Did you mean …@gmail.com?" (`TYPOS`), throwaway/placeholder domains (`DISPOSABLE`,
.test/.local/.example…), and domains that can't receive mail (DNS MX, falling back to A/AAAA; null MX = reject).
The PC's own DNS sometimes answers ESERVFAIL for made-up domains, so unclear answers are re-asked via public DNS
(1.1.1.1 / 8.8.8.8); only if both are unreachable is the sign-up allowed. Sign-up then signs in immediately (as before).
Tested: scratchpad `test-realemail.js` 28/28.

**On hold (owner wants it later):** everything below still exists but is off: `signup_verify` defaults to `'0'` (only
`'1'` turns it on) and the owner-panel `EmailCard` is not rendered (one commented line in `SettingsTab.jsx`). To bring it
back: render `<EmailCard …/>` again, rebuild, and the owner sets up SMTP + ticks "Require email confirmation".

- `POST /api/auth/register` no longer creates the clinic: it stores a row in `signup_verifications` (email PK,
  `details` JSON incl. scrypt password hash, SHA-256 `code_hash` of `email:code`, SHA-256 `token_hash`) and emails
  a 6-digit code + link `<public_url>/#/verify-email/<token>`; returns 202 `{verify:true}`.
  `POST /api/auth/register/verify` `{email, code}` or `{token}` → deletes the row (single use) → `createClinic()` → session.
  `POST /api/auth/register/resend` `{email}`. Limits: 30 min expiry, 5 wrong codes per code (atomic counter),
  60 s between emails, 5 emails per sign-up, IP buckets `register`/`verify`. Rows purged 1 day after expiry.
- Email = SMTP via `nodemailer` (10.0.14) in `clinic-app/mailer.js`. Settings (owner panel → Settings → Email card;
  `PUT /api/admin/email`, `POST /api/admin/email/test`): `smtp_host/port/user/from`, `smtp_pass` (encrypted, never
  returned), `public_url` (link base; never taken from the Host header, which can be faked), `signup_verify` ('1' default;
  '0' = old instant sign-up). If email isn't configured and verification is on, sign-ups return 503 "paused".
- When re-enabled, owner's to-do: set up a Gmail app password (GUIDE.md §3.4) and put the ngrok link in "Your website address".
- Not done: changing the clinic email in Settings is not re-verified by code (only the real-email check).
- Tests: scratchpad `test-email.js` (46 checks, fake SMTP server + embedded Postgres) all passing; browser check of
  the verify screen, the link flow and the owner Email card passed.
- One login per clinic (practitioners are records, not users).

## 6. Security design (keep these properties)

- **Encryption at rest (AES-256-GCM)** with a master key in `clinic-app/data/secret.key` (created with `wx`, so it's
  race-safe) or env `CAREDESK_KEY` (base64, 32 bytes). **The key must never be stored in Supabase.**
  Encrypted values are stored as text prefixed `enc:v1:`. Encrypted columns (`SENSITIVE` in security.js): patients
  (address, emergency_contact, insurance, allergies, medical_history, medications, notes), clinical_notes SOAP fields,
  appointments.notes, documents.ocr_text; plus 2FA secrets and the OpenRouter key. Names/phone/email/dob stay
  plain for search. Searching notes/documents decrypts in memory and then filters.
- Sessions: random token in an HttpOnly, SameSite=Strict cookie (`__Host-` prefix + Secure when `SECURE_COOKIES=1`);
  **only the SHA-256 is stored**. Idle timeout 12 h for clinics and 1 h for the owner; absolute 30 days / 12 h.
  A 5-minute "mfa" session sits between password and 2FA code.
- 2FA: TOTP (RFC 6238, own implementation), QR via `qrcode`, 10 hashed one-time recovery codes, replay blocked by
  `totp_last_step`. Owner can reset a clinic's 2FA; owner's own via CLI `reset-admin-2fa`.
- Lockout: 5 wrong passwords → 15 min lock per account; plus 10 failed sign-ins / 15 min per IP; sign-ups use a
  separate bucket. Unknown emails take the same time (dummy scrypt) and return the same message.
- CSRF: writes require `Content-Type: application/json` (raw uploads require header `X-CareDesk-Upload: 1`) **and**
  a matching `Origin` when present. Headers: strict CSP (allows cdn.jsdelivr.net + `wasm-unsafe-eval` + blob workers only
  for tesseract.js OCR), X-Frame-Options DENY, COOP/CORP, Permissions-Policy (camera self), HSTS over HTTPS.
- Audit log (`audit_log`): sign-ins, failures, record views (`patients.view`), every write (generic in server.js
  `describeWrite`), exports, downloads, AI use (never the question text), owner actions (`actor='owner'`). Kept 2 years.
  Clinics see their own entries; the owner sees all.
- Owner panel binds 127.0.0.1 (+ ::1) only; first-run setup only from a local request without `X-Forwarded-For`.
  Online access is meant to be via SSH tunnel.
- `TRUST_PROXY=1` (env): behind ngrok/tunnels/nginx, `clientIp()` (security.js) uses the last `X-Forwarded-For`
  entry, but only for loopback connections. Without it every visitor looks like 127.0.0.1 and shares one sign-in limit.
- ngrok plan (2026-10-03): expose ONLY port 3000 (clinic app) with `SECURE_COOKIES=1` + `TRUST_PROXY=1`; never tunnel 4000.

## 7. AI (OpenRouter) design

- The owner's key is stored encrypted in settings (`ai_key`), **never sent to browsers**. Settings: `ai_model`, `ai_zdr`
  (zero-data-retention routing), `ai_hide_names`, `ai_default_enabled`, `ai_default_limit` (USD/clinic/month).
  Per-clinic overrides `ai_enabled`, `ai_monthly_limit`. Usage/cost tracked per month in `ai_usage` from
  OpenRouter `usage.cost`; requests are blocked when over the limit. AI is only available while `can_write`.
- Every request uses `provider: { data_collection: 'deny', zdr: <setting> }`, `usage: { include: true }` and
  `user` = hashed clinic id. `OPENROUTER_BASE_URL` env exists **only for tests** (mock).
- **Chat** = tool-calling agent (max 8 rounds) with tools `run_sql`, `find_patients`, `get_patient_record`.
  `run_sql` runs one read-only SELECT against an **in-memory node:sqlite snapshot of only that clinic's data**
  (rebuilt from Postgres, cached 30 s, `PRAGMA query_only`, blocks ATTACH/PRAGMA/writes/multiple statements,
  max 100 rows). The schema is described in the system prompt.
- Privacy: phone/email/address/insurance/emergency contact are never sent; DOB → age; with hide-names on,
  names become `[[P12]]` tags (also redacted inside the user's messages and free text) and are restored before
  answers reach staff; phones/emails in OCR text are masked. Notes/document text is treated as data (prompt-injection guard).
- Other endpoints: `/api/ai/patient-summary` (always anonymised), `/api/ai/soap` (JSON SOAP from rough notes),
  `/api/ai/tidy-document` (clean OCR text + extracted lab values table). The frontend renders answers with the safe Markdown component.
- No RAG (owner agreed: exact SQL lookups + direct patient records are better for this data; can be added later).

## 8. Other features worth knowing

- OCR runs **in the browser** with tesseract.js 7.0.0 from jsDelivr (SRI-pinned in `frontend/shared/ocr.js`),
  language data from jsDelivr `@tesseract.js-data`. Languages: English + Urdu/Arabic/Hindi/Bengali/Persian/Turkish/
  French/Spanish/German. Photos are shrunk to ~2200px JPEG before upload. Parsers `parsePatient`, `parseReceipt`, `findDates` (day-first dates).
- Excel: exports for each list, `all.xlsx` (7 sheets), `report.xlsx?from&to`; money as numbers with the currency
  format; values are never written as formulas (no injection). CSV still available (formula-escaped). Import: upload
  `.xlsx`/`.csv` → preview with auto column matching (synonyms; "D.O.B" etc.) → commit (token is single-use and
  clinic-bound; duplicates by name + phone/dob skipped; batched inserts of 500 in one transaction; max 20k rows / 10 MB).
- Owner panel AI tab can browse OpenRouter models with prices (`/api/admin/ai/models`) and test the key.

## 9. Commands

```bash
# run (Windows): double-click clinic-app\start.bat and owner-panel\start.bat
cd clinic-app && node server.js                 # clinic app  → http://localhost:3000
cd owner-panel && node server.js                # owner panel → http://localhost:4000
cd frontend && npm run build                    # rebuild both React apps after frontend edits
cd frontend && npm run dev:clinic               # Vite dev server :5173 proxied to :3000

# owner-panel CLI (needs clinic-app/.env)
node server.js create-admin <email> <password>  # create owner / reset owner password + unlock
node server.js reset-admin-2fa <email>
node server.js restore-backup <file.backup> --yes
node server.js import-sqlite [path/to/clinic.db]   # default clinic-app/data/clinic.db
```

## 10. Testing (how it was verified)

- Test scripts were kept in the chat's temporary scratchpad (**not in this folder**). A new chat would need to
  recreate them if wanted. The approach: start both servers against a **local Postgres 17** (npm `embedded-postgres@17.6.0-beta.15`;
  the PG 18 build crashed in initdb on this PC) with a fresh `DB_SCHEMA` per suite, plus a mock OpenRouter (port 4999)
  and a mock Supabase Storage (port 4998), then drive the HTTP API with Node fetch.
- Last results, all passing: main app 57, documents/uploads 23, security 57, Excel 26, AI (incl. "no names/contacts
  sent") 28, Supabase Storage 8, OCR parsers 20 (= 219). Browser checks (React UI, Recharts, 2FA flow, AI chat,
  OCR upload, owner panel) passed earlier; the dashboard and owner panel were re-checked on Postgres.
- Import tool verified (old SQLite demo DB → Postgres, re-run skips everything, decryption + photo OK);
  backup → delete → restore verified.
- Gotchas: PowerShell 5.1 `Set-Content -Encoding utf8` adds a BOM and garbles non-ASCII (e.g. "…") when re-reading
  files, so prefer the Edit/Write tools; `localhost` may resolve to ::1 first (why the owner panel also listens on ::1);
  the Browser pane can render Recharts at 0 width when the pane is collapsed (not an app bug).

## 11. Ideas not done yet (only if the owner asks)

- Save the test suites into the repo (e.g. `clinic-app/tests/`) and add `npm test`.
- Staff user accounts with roles (receptionist vs clinician) instead of one login per clinic.
- More email (password reset, appointment reminders; mailer.js already exists), SMS/WhatsApp reminders.
- RAG over large document archives; PDF OCR (currently photos only).
- Online payments/subscription billing for clinics (currently the owner activates manually after being paid).
- Deploying to a VPS (steps are in GUIDE.md §6) and putting the folder under git.
- Health-data compliance paperwork (privacy policy, terms; HIPAA/GDPR/local law depending on clients).
