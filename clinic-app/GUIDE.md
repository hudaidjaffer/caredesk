# CareDesk: Owner's Guide

CareDesk is clinic software for dentists, therapists, physiotherapists and small medical
practices. Clinics sign up with a real email address and a password (at least 8 characters)
and get a **30-day free trial with unlimited use**. After that, only
**you** (the owner) can activate them.

It is made of three folders:

| Folder | What it is | Address | Start it with |
|---|---|---|---|
| `clinic-app` | The clinic software (server; data in Supabase) | http://localhost:3000 | `clinic-app\start.bat` |
| `owner-panel` | Your private control panel | http://localhost:4000 (this computer only) | `owner-panel\start.bat` |
| `frontend` | Source code of the screens (React) | – | only needed when changing the design |

---

## 1. Features

### For clinics
- **Dashboard**: today's schedule, next 7 days, patients, income, outstanding balances, overdue invoices, income vs expenses chart.
- **Appointments**: colour-coded weekly calendar (click a slot to book), list view, statuses (scheduled, confirmed, completed, cancelled, no-show).
- **Patients**: unlimited records with allergies (red alert), medications, history, insurance, emergency contact; profile with visits, notes, invoices and documents.
- **Clinical notes (SOAP)** with tooth / body-area field.
- **Documents + OCR**: upload or photograph lab reports, prescriptions, X-rays, ID cards and forms; the text is read automatically and is searchable.
- **Scan to fill**: photograph a registration form or ID card and the patient form fills itself; scan a receipt to fill an expense.
- **Billing**: numbered invoices, discounts, tax, part payments, print/PDF; payments list.
- **Expenses** and **Reports** (profit, revenue by service, no-show rate, payment methods, outstanding balances) with charts.
- **AI assistant** (see section 4): ask questions about the clinic's own data, AI patient summaries, SOAP notes written from rough notes, tidying scanned documents into lab-value tables.
- **Excel**: import a patient list from Excel/CSV; export any list, a full workbook, or a formatted report as `.xlsx`.
- **Security settings**: two-step sign-in, signed-in devices, password, activity log.

### For you (owner panel)
- **Clinics**: list, search, status, usage; **Manage** each clinic: activate (30 days … lifetime), extend trial, end access, suspend, reset password, reset two-step sign-in, unlock, AI on/off and monthly limit, private notes.
- **AI assistant**: OpenRouter key, model choice (with prices), privacy switches, default limits, spending per clinic.
- **Activity log**: every sign-in, failed attempt, record view, change, export and AI use, for all clinics.
- **Security & backups**: your two-step sign-in, password, devices, daily encrypted backups, encryption recovery key.
- **Settings**: product name, your support contact, what happens when a trial ends (read-only or fully locked).

---

## 2. Security (what's built in)

| Protection | What it means |
|---|---|
| **Encryption at rest** | Medical details, addresses, insurance, clinical notes, appointment notes, document text, uploaded photos and backups are encrypted (AES-256-GCM). Even someone who copies the database or photos can't read them without the key. |
| **Real email at sign-up** | Sign-up only accepts a working email address: the address must be correctly written, common typos get a "Did you mean …@gmail.com?" hint, temporary/throwaway and example addresses are refused, and the app checks online that the email domain can actually receive mail. |
| **Two-step sign-in (2FA)** | Optional for clinics, strongly recommended for you: password + 6-digit code from an authenticator app, with 10 one-time recovery codes. |
| **Account lockout** | 5 wrong passwords lock the account for 15 minutes; plus a per-network limit against password guessing. |
| **Activity log** | Who signed in, who viewed which patient record, every change, export, download and AI use. Kept 2 years; clinics see their own, you see all. |
| **Sessions** | Login tokens are stored only as hashes; clinics are signed out after 12 h idle (owner: 1 h); changing a password or turning on 2FA signs out other devices; "sign out other devices" button. |
| **Owner panel isolation** | Only reachable from the server computer itself. First-time setup only from that computer. |
| **Web protections** | Strict Content-Security-Policy, cross-site request blocking, no framing, secure cookies (SameSite=Strict, HttpOnly, Secure + HSTS over HTTPS), file-type checking of uploads (a disguised file is rejected), uploaded files can never run scripts. |
| **Clinic separation** | Every query is limited to the signed-in clinic (tested). |
| **Supabase** | Tables in a private schema with row-level security on and no access for Supabase's public API keys; encrypted connection; files in a private bucket, encrypted before upload; the encryption key never goes to Supabase. |
| **Backups** | Supabase's own backups, plus CareDesk's daily encrypted backup (local + bucket), last 14 kept; "Back up now" button. |
| **Dependencies** | Pinned versions, `npm audit`: 0 known vulnerabilities. |

### ⚠️ Your encryption key: save it now
The key is in `clinic-app\data\secret.key` (or `CAREDESK_KEY` in `.env`). It is deliberately **not** stored in Supabase. **If you lose it, encrypted data and backups
cannot be recovered.** In the owner panel → *Security & backups* → **Show recovery key**,
then save it offline (print it, or keep it in a password manager). Never keep it only on the server.

---

## 3. Setting up Supabase and running it

All data is stored in **Supabase** (a hosted PostgreSQL database). Uploaded photos/PDFs and
backups go to a **private Supabase Storage bucket**. Your encryption key stays with you, never in Supabase.

### 3.1 Create the Supabase project (once)
1. Go to **supabase.com**, sign up, and click **New project**. Choose a region close to your clinics,
   and set a strong **database password** (save it in your password manager).
2. When the project is ready, click **Connect** (top of the dashboard) and copy a connection string:
   - **Direct connection**: `postgresql://postgres:[YOUR-PASSWORD]@db.xxxx.supabase.co:5432/postgres` (needs IPv6), or
   - **Session pooler**: `postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-0-REGION.pooler.supabase.com:5432/postgres` (works on every network).
   - ⚠️ **Not** the "Transaction pooler" (port 6543): the app will refuse it.
3. **Project Settings → API Keys → Secret keys**: create/copy a secret key (`sb_secret_…`). This lets the server
   store files in Storage. Never put it in a web page or share it. (Do not use the publishable/anon key.)
4. Optional but recommended: **Project Settings → Database → SSL**: download the certificate, save it in the
   `clinic-app` folder, and put its file name in `DATABASE_CA_CERT` (this also verifies you're talking to Supabase).

### 3.2 Connect the app
1. Double-click **`clinic-app\start.bat`**. The first time it creates a file called **`.env`** and opens it in Notepad.
2. Fill in (replace `[YOUR-PASSWORD]` with your database password):
   ```
   DATABASE_URL=postgresql://postgres:YOUR-PASSWORD@db.xxxx.supabase.co:5432/postgres
   SUPABASE_URL=https://xxxx.supabase.co
   SUPABASE_SECRET_KEY=sb_secret_...
   ```
   Save, close Notepad, and double-click `start.bat` again. The tables are created automatically in their own
   private schema (`caredesk`), with row-level security on and no access for Supabase's public API keys.
3. Double-click **`owner-panel\start.bat`**. Your panel opens at http://localhost:4000. The first time, create your owner account.
4. In the owner panel: **Security & backups** → turn on two-step sign-in and **save the recovery key**;
   **Settings** → your support contact; **AI assistant** → your OpenRouter key (section 4).

`.env` holds your passwords and keys: never email it, upload it or share it.

### 3.3 Moving your existing data into Supabase (once)
If you used CareDesk before with the local database, copy everything (clinics, patients, notes, invoices,
documents, owner account, settings, activity log) into Supabase. Stop both programs, then in the `owner-panel` folder run:
```bash
node server.js import-sqlite
```
It reads `clinic-app\data\clinic.db`, copies all rows (already-encrypted data stays encrypted), and uploads stored
photos to your Supabase bucket. It is safe to run twice: existing rows are skipped. Keep the same
`clinic-app\data\secret.key`: it is needed to read the encrypted data. Everyone signs in again afterwards.

**Forgot your owner password?** In the `owner-panel` folder run:
```bash
node server.js create-admin your@email.com newpassword
```
**Lost the phone for your owner two-step sign-in and your recovery codes?**
```bash
node server.js reset-admin-2fa your@email.com
```

### 3.4 Email verification codes (OFF: switched off by the owner)

Built but switched off; ask your developer to switch it back on. When on, new clinics must type a 6-digit code (or click
"Confirm my email") from an email before their account is created, sent from **caredesksupportt@gmail.com** (details filled in;
only its Google app password is needed). **On Render the clinic app must then be on a paid plan (Starter):** the free plan blocks email.

1. Google Account → **Security** → turn on **2-Step Verification** → then search **App passwords** → create one
   (name it "CareDesk"). Google shows a 16-letter password: copy it.
2. Owner panel → **Settings** → **Email: sign-up verification**:
   SMTP server `smtp.gmail.com`, port `465`, username = the Gmail address, password = the 16-letter app password.
3. **Your website address**: the link clinics use, e.g. `https://your-name.ngrok-free.app`. This is what the
   "Confirm my email" button in the email opens. Leave it empty and the email contains only the code.
4. Click **Save & send test email to me** and check your inbox (and spam).

Other providers work too (Brevo, Zoho Mail, your web host's email): use the SMTP server, port, username and password
they give you. Hotmail/Outlook.com addresses usually **can't** be used for sending from apps anymore.
The password is stored encrypted. You can switch email confirmation off in the same card (not recommended).

---
## 4. Setting up the AI assistant (OpenRouter)

1. Create an account at **openrouter.ai**, add credit, and create an API key (**Keys** page). It starts with `sk-or-`.
2. Owner panel → **AI assistant** → paste the key → **Save key** → **Test connection**.
3. Choose the default monthly limit per clinic (e.g. $5). You can raise or lower it, or turn AI off, per clinic under **Manage**.
4. Optional: pick another model with **Browse models & prices**. The default `anthropic/claude-sonnet-5.5` is careful with medical text; cheaper models cost less but make more mistakes.

**What the AI can do for clinics**
- **Ask anything** about their own data: "How many no-shows last month?", "Who owes us money?", "Which patients are allergic to penicillin?", "Profit this month vs last". It looks the answers up in a private, read-only copy of only that clinic's data, and shows how it found them.
- **Patient summary** before a visit (profile → Overview → *Summarise*).
- **Write SOAP notes** from rough notes (New clinical note → *Write with AI*).
- **Tidy scanned documents**: fixes OCR mistakes and lists lab values in a table (document → *Tidy text & find values*).

**Privacy of the AI**
- Phone numbers, emails, addresses, insurance and emergency contacts are **never sent**.
- Patient names are replaced by codes (e.g. `[[P12]]`) before sending and turned back into names on screen (switch: *Hide patient names*).
- Requests only go to providers that don't store or train on data, and by default only to zero-data-retention endpoints.
- The AI can only read, never change data. Questions are not saved; the activity log records only *that* the AI was used.

**Do you need RAG?** Not now. The assistant looks things up exactly (with database queries) and reads the
relevant patient's notes and documents directly, which is more accurate and cheaper for this kind of data.
RAG (meaning-based search across thousands of documents) can be added later if clinics build up very large archives.

---

## 5. Excel

- **Export**: every list page has an **Excel** button; Settings → *Import & export* → **Everything (one workbook)**; Reports → **Excel report** (summary + monthly + by service + outstanding).
- **Import patients**: Patients → **Import**, or Settings → *Import & export*. Upload `.xlsx` or `.csv`; columns like "Name", "Mobile", "D.O.B", "Sex" are matched automatically (you can change the matching); names are split, dates in most formats are understood, duplicates are skipped, and problem rows are listed. A **template** is available.
- Library used: **ExcelJS** (server side).

---

## 6. Putting it online for clients

The data is already online in Supabase; now the **app server** needs to run somewhere clinics can reach.

1. Rent a small server (DigitalOcean, Hetzner, Hostinger VPS, AWS Lightsail; ~$5–6/month, Ubuntu) and install Node.js 22+.
2. Copy the three folders (`clinic-app`, `owner-panel`, `frontend`) and your `clinic-app/.env` to the server
   (put the encryption key in `.env` as `CAREDESK_KEY=...`, copied from the owner panel → Show recovery key), then:
   ```bash
   cd clinic-app && npm install --omit=dev
   cd ../frontend && npm install && npm run build
   ```
3. Keep both programs running with PM2:
   ```bash
   npm install -g pm2
   cd ~/clinic-app && PORT=3000 SECURE_COOKIES=1 pm2 start server.js --name caredesk
   cd ~/owner-panel && SECURE_COOKIES=1 pm2 start server.js --name caredesk-owner
   pm2 save && pm2 startup
   ```
4. Buy a domain and put **HTTPS** in front of the **clinic app only** with Caddy:
   ```
   caredesk.yourname.com {
       reverse_proxy localhost:3000
   }
   ```
5. Open your owner panel privately from your own PC through an SSH tunnel (it is never exposed to the internet):
   ```bash
   ssh -L 4000:localhost:4000 youruser@your-server-ip
   ```
   then visit http://localhost:4000.

Tip: choose a server in the same region as your Supabase project; every page loads data from the database.

**Settings (in `clinic-app/.env`)**

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | – (required) | Supabase connection string (direct or session pooler, port 5432) |
| `DATABASE_CA_CERT` | – | Supabase SSL certificate file, to verify the server |
| `DB_SCHEMA` | `caredesk` | Schema the tables live in |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | – | Store photos/PDFs/backups in Supabase Storage (otherwise on this computer) |
| `SUPABASE_BUCKET` | `caredesk-files` | Private bucket name (created automatically) |
| `CAREDESK_KEY` | – | Encryption key (instead of `data/secret.key`); **never store it in Supabase** |
| `PORT` / `OWNER_PORT` | 3000 / 4000 | Ports |
| `OWNER_HOST` | 127.0.0.1 | Keep as is (owner panel: this computer only) |
| `SECURE_COOKIES` | off | Set to `1` when served over HTTPS |

Trial length (`TRIAL_DAYS = 30`) and minimum password length (`MIN_PASSWORD = 8`) are at the top of `clinic-app/core.js`.

### Backups and restore
- **Supabase** keeps its own daily backups of the database (see your project's Database → Backups; longer
  retention and point-in-time recovery on paid plans).
- **CareDesk** also makes its own daily **encrypted** backup of every table: saved in `clinic-app\data\backups`
  (last 14) and copied to your private Supabase bucket. Owner panel → Security & backups → **Back up now** / **Download**.
- Keep the **encryption key** offline. Without it, encrypted data and backups can't be read.
- To restore a CareDesk backup into Supabase (this **replaces** all current data): stop the clinic app, then in `owner-panel`:
  ```bash
  node server.js restore-backup ..\clinic-app\data\backups\caredesk-YYYY-....backup --yes
  ```

---
## 7. Daily workflow (to teach your clinics)

1. **Setup once**: Settings → clinic profile (address, currency, tax, invoice footer); Services & team → fees and staff colours;
   Settings → Security → **turn on two-step sign-in**; Import existing patients from Excel if they have a list.
2. **New patient**: Appointments → click a time slot → type the name → "Add new patient" → book. Or *New patient* → **Scan photo** of their form.
3. **Visit**: open the appointment → mark Completed → **Note** (type rough notes → *Write with AI* → review → save) → **Invoice** → **Record payment** → **Print/PDF**.
4. **Paperwork**: patient → **Upload** photos of reports; use *Tidy text & find values* for lab reports.
5. **Questions**: open **AI assistant** and ask in plain English.
6. **Month end**: Reports → **Excel report**.

---

## 8. Changing the design (developers)

The screens are React (with lucide-react icons and Recharts charts) in `frontend/`:
```bash
cd frontend
npm install
npm run build
```
`npm run build` writes the clinic screens to `clinic-app/dist` and the owner screens to `owner-panel/dist`.
For live editing: run the servers, then `npm run dev:clinic` (opens http://localhost:5173, proxied to the clinic server).

---

## 9. Good to know
- **Health data laws** (HIPAA, GDPR, local acts) may apply to you as the host: use HTTPS, keep backups and the key private,
  turn on two-step sign-in, and consider a privacy policy and terms of use for clinics.
- **The AI can be wrong.** Clinics must review AI notes, summaries and extracted values; the app reminds them.
- **No emails are sent** (yet): forgotten clinic passwords and lost 2FA phones are handled by you in **Manage** (check who you're talking to first).
- **One login per clinic**; practitioners are tracked per appointment and note.
- "CareDesk" is a placeholder name: change it in owner panel → Settings.
