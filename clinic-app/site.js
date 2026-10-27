// Public website (SEO): plain, fast HTML pages that search engines can read, plus robots.txt, sitemap.xml and a
// real 404 page. The clinic app itself lives at /app. Product name and support contact come from the owner's
// settings, so renaming the product updates every page. Content describes only features that really exist.
const { getSettings, DEFAULT_SETTINGS, state } = require('./db');
const { getSession } = require('./core');

const UPDATED = '2026-10-18';                     // "last changed" date in sitemap.xml; bump when page text changes
const TRIAL = () => require('./core').TRIAL_DAYS;

// Website settings (product name, contact): cached for a minute; defaults while the database is not connected,
// so the public pages never wait for, or fail because of, the database.
let cached = null;
let cachedAt = 0;
async function siteSettings() {
  if (!state.ready) return cached || DEFAULT_SETTINGS;
  if (cached && Date.now() - cachedAt < 60000) return cached;
  try { cached = await getSettings(); cachedAt = Date.now(); } catch { /* keep the last good copy */ }
  return cached || DEFAULT_SETTINGS;
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The site's own address: PUBLIC_URL (set on Render; change it when a custom domain is added), else the request host.
function baseUrl(req) {
  const env = String(process.env.PUBLIC_URL || '').replace(/\/+$/, '');
  if (env) return env;
  const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  return `${proto}://${req.headers.host || 'localhost'}`;
}

// ---------------------------------------------------------------- content

const FEATURES = [
  ['calendar', 'Appointment calendar', 'Day, week and list views for your whole team, colour-coded by practitioner. Click a free slot to book; mark visits confirmed, completed, cancelled or no-show.'],
  ['user', 'Patient records', 'Unlimited patients with medical history, medications and allergy alerts that stand out on every screen. Visits, notes, invoices and documents in one profile.'],
  ['notes', 'Clinical notes (SOAP)', 'Structured Subjective, Objective, Assessment and Plan notes, with a field for the tooth or body area treated.'],
  ['scan', 'Photos & document reading', 'Upload or photograph lab reports, prescriptions, X-rays and forms. The text is read automatically (English, Urdu, Arabic and more) and becomes searchable.'],
  ['receipt', 'Invoices & payments', 'Numbered invoices with discounts and tax, part payments, balances due and print-ready invoices. Track expenses next to income.'],
  ['chart', 'Reports & Excel', 'Profit, revenue by service, no-show rate and unpaid balances, with charts. Export any list to Excel, or import your existing patient list.'],
  ['shield', 'Private & secure', 'Medical details, notes and uploaded files are encrypted. Optional two-step sign-in and a full activity log of who viewed or changed what.'],
  ['phone', 'Works on any device', 'Runs in the browser on phones, tablets and computers. Nothing to install and no server to look after.'],
];

const COMMON_FAQ = (name, trial) => [
  [`How much does ${name} cost?`, `Every clinic starts with a ${trial}-day free trial with unlimited patients and every feature, and no card is needed. After the trial, contact us to activate your account.`],
  ['What happens to my data when the trial ends?', 'Your records stay safe. You can still sign in, view and export everything to Excel; adding or editing needs an activated account.'],
  ['Do I need to install anything?', 'No. It works in any modern browser on a phone, tablet or computer.'],
  ['Is patient information kept private?', 'Medical details, clinical notes and uploaded documents are encrypted, every sign-in and record view is logged, and you can turn on two-step sign-in for your clinic account.'],
  ['Can I bring my existing patient list?', 'Yes. Upload an Excel or CSV file; columns such as name, phone and date of birth are matched automatically and duplicates are skipped.'],
];

const PAGES = {
  '/': {
    title: (n) => `${n}: Clinic Software for Dental, Physio & Therapy Clinics`,
    description: (n, t) => `${n} is simple online clinic management software: appointments, patient records, SOAP notes, invoices and reports. Free ${t}-day trial, no card needed.`,
    h1: 'Clinic management software that keeps your practice calm and organised',
    lead: 'Appointments, patient records, clinical notes, billing and reports in one secure place, built for dental clinics, physiotherapists, therapists and small medical practices.',
    sections: [
      ['Everything a small clinic needs', null],
      ['Who it is for', 'who'],
    ],
    faq: true,
  },
  '/dental-clinic-software': {
    title: (n) => `Dental Clinic Software: Appointments, Charts & Billing | ${n}`,
    description: (n, t) => `Online dental practice software: appointment calendar, patient records with allergy alerts, tooth-level notes, X-ray uploads and billing. Free ${t}-day trial.`,
    h1: 'Dental clinic software for busy practices',
    lead: 'Run your dental practice from one screen: book patients into each dentist\'s calendar, record treatment by tooth, keep X-rays and lab reports with the patient, and bill in seconds.',
    points: [
      ['Treatment notes by tooth', 'Every SOAP note has a tooth / area field (for example "16, upper right molar"), so the full treatment history of each tooth is easy to follow.'],
      ['Ready-made dental services', 'New dental clinics start with common services such as check-ups, scaling & polishing, fillings, extractions and root canal treatment, with durations and prices you can change.'],
      ['X-rays and documents', 'Photograph or upload X-rays, lab reports and consent forms straight into the patient\'s file from a phone or computer.'],
      ['Allergy alerts', 'Allergies such as penicillin or latex are flagged in red wherever the patient appears, before you treat.'],
      ['Billing that adds up', 'Invoice treatments with discounts and tax, record part payments and see who still owes what.'],
      ['Every dentist\'s diary', 'Colour-coded calendars per dentist or hygienist, with day view on a phone and week view on a computer.'],
    ],
    faq: true,
  },
  '/physiotherapy-clinic-software': {
    title: (n) => `Physiotherapy Clinic Software: Scheduling, Notes & Billing | ${n}`,
    description: (n, t) => `Physiotherapy clinic software for appointments, SOAP notes by body area, scans and referral letters, invoices and reports. Free ${t}-day trial.`,
    h1: 'Physiotherapy clinic software that keeps every session on track',
    lead: 'Schedule repeat sessions, record assessments and progress by body area, keep scans and referral letters with the patient, and invoice each course of treatment.',
    points: [
      ['Notes by body area', 'Write SOAP notes for each session with the body area treated (for example "left knee" or "lumbar spine"), so progress is easy to compare over time.'],
      ['Repeat sessions made easy', 'Book follow-ups in seconds and see each therapist\'s day at a glance; mark no-shows to keep your attendance figures honest.'],
      ['Scans and referral letters', 'Upload MRI reports, referral letters and photos to the patient\'s file; the text is read automatically and becomes searchable.'],
      ['Physio services ready to go', 'New physiotherapy clinics start with typical services such as assessments, follow-up sessions and sports massage, all editable.'],
      ['Know your numbers', 'Revenue by service, no-show rate and outstanding balances in clear reports, exportable to Excel.'],
      ['Use it anywhere', 'Works on a tablet in the treatment room or a phone on a home visit.'],
    ],
    faq: true,
  },
  '/therapy-practice-software': {
    title: (n) => `Therapy & Counselling Practice Software | ${n}`,
    description: (n, t) => `Private, encrypted software for therapists and counsellors: session scheduling, confidential notes, client records and invoices. Free ${t}-day trial.`,
    h1: 'Practice software for therapists and counsellors',
    lead: 'Keep confidential session notes encrypted, manage your appointment diary, invoice clients and see your practice\'s numbers, without paperwork.',
    points: [
      ['Confidential by design', 'Session notes, medical history and uploaded documents are encrypted, and an activity log records every time a client record is opened.'],
      ['Structured session notes', 'SOAP notes keep each session consistent: what the client shared, what you observed, your assessment and the plan.'],
      ['Your diary, your way', 'Weekly sessions, cancellations and no-shows tracked in one calendar, on your phone or computer.'],
      ['Simple invoicing', 'Invoice sessions, record payments and see unpaid balances; print or save invoices as PDF.'],
      ['Two-step sign-in', 'Protect your account with a code from an authenticator app on your phone.'],
      ['Your data, exportable', 'Export clients, sessions and invoices to Excel whenever you need them.'],
    ],
    faq: true,
  },
  '/clinic-management-software-pakistan': {
    title: (n) => `Clinic Management Software in Pakistan | ${n}`,
    description: (n, t) => `Clinic management software for Pakistan: Rupee invoices, Urdu document reading, appointments and patient records. Free ${t}-day trial.`,
    h1: 'Clinic management software for clinics in Pakistan',
    lead: 'Made for how clinics in Pakistan work: billing in Rupees, patient documents in Urdu or English, and a system that runs on the phone you already have.',
    points: [
      ['Billing in Rupees', 'Set your currency to Rs and your tax rate once; every invoice, payment and report uses it.'],
      ['Reads Urdu and English', 'Photograph a prescription, lab report or registration form and the text is read automatically, in Urdu, English and several other languages.'],
      ['Scan to fill', 'Photograph a patient registration form or ID card and the new-patient form fills itself in; photograph a receipt to add an expense.'],
      ['Works on mobile data', 'Runs in the browser on any phone, tablet or computer, with no installation or local server needed.'],
      ['For every kind of clinic', 'Dental clinics, physiotherapy centres, therapists, GPs and small medical practices, from Lahore to Karachi and Islamabad.'],
      ['Your records stay safe', 'Encrypted medical records, daily encrypted backups and a full activity log.'],
    ],
    faq: true,
  },
};

const WHO = [
  ['/dental-clinic-software', 'Dental clinics', 'Tooth-level notes, X-rays and chair-side calendars.'],
  ['/physiotherapy-clinic-software', 'Physiotherapy', 'Repeat sessions and progress notes by body area.'],
  ['/therapy-practice-software', 'Therapists & counsellors', 'Confidential, encrypted session notes.'],
  ['/clinic-management-software-pakistan', 'Clinics in Pakistan', 'Rupee billing and Urdu document reading.'],
];

// ---------------------------------------------------------------- rendering

const ICONS = {
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  notes: '<path d="M9 3h6l4 4v14H5V3h4z"/><path d="M9 12h6M9 16h6"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10"/>',
  receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k] || ICONS.check}</svg>`;

const CSS = `
:root{--p:#0e7c86;--p7:#08545b;--p5:#e8f6f6;--t:#11263c;--m:#5d6f82;--b:#e2e9ef;--bg:#f3f7fa}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:'Plus Jakarta Sans','Segoe UI',system-ui,sans-serif;color:var(--t);line-height:1.6;background:#fff;font-size:16px}
a{color:var(--p)}img,svg{max-width:100%}
.wrap{max-width:1120px;margin:0 auto;padding:0 20px}
header.top{position:sticky;top:0;z-index:5;background:rgba(255,255,255,.94);backdrop-filter:blur(8px);border-bottom:1px solid var(--b)}
header.top .wrap{display:flex;align-items:center;gap:18px;min-height:64px}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:19px;color:var(--t);text-decoration:none}
.mark{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:linear-gradient(135deg,#12a3a3,#0b6a73);color:#fff}
.mark svg{width:19px;height:19px;stroke:currentColor;fill:none;stroke-width:2.2}
nav.links{display:flex;gap:18px;margin-left:auto;font-weight:600;font-size:14.5px}nav.links a{color:var(--m);text-decoration:none}nav.links a:hover{color:var(--t)}
.btn{display:inline-flex;align-items:center;justify-content:center;height:44px;padding:0 20px;border-radius:10px;font-weight:700;text-decoration:none;border:1px solid var(--b);color:var(--t);background:#fff;white-space:nowrap}
.btn.pri{background:var(--p);border-color:var(--p);color:#fff}.btn.pri:hover{background:var(--p7)}
.btn.sm{height:38px;padding:0 14px;font-size:14.5px}
.hero{background:radial-gradient(900px 400px at 85% -10%,#d9f2f2,transparent 60%),linear-gradient(180deg,#f3fafa,#fff);padding:64px 0 48px}
.hero h1{font-size:clamp(30px,5vw,48px);line-height:1.12;letter-spacing:-.02em;margin:0 0 18px;max-width:820px}
.hero p.lead{font-size:clamp(17px,2vw,19px);color:var(--m);max-width:700px;margin:0 0 28px}
.pill{display:inline-block;background:#e5f6ee;color:#15935a;font-weight:700;font-size:13.5px;padding:5px 12px;border-radius:99px;margin-bottom:18px}
.cta{display:flex;gap:12px;flex-wrap:wrap;align-items:center}.cta small{color:var(--m)}
section{padding:56px 0}section.alt{background:var(--bg)}
h2{font-size:clamp(24px,3.4vw,32px);letter-spacing:-.01em;margin:0 0 10px;line-height:1.2}
.sub{color:var(--m);margin:0 0 30px;max-width:720px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:18px}
.card{background:#fff;border:1px solid var(--b);border-radius:14px;padding:22px}
.card h3{margin:12px 0 6px;font-size:17px}.card p{margin:0;color:var(--m);font-size:15px}
.ico{width:42px;height:42px;border-radius:12px;background:var(--p5);color:var(--p);display:grid;place-items:center}
.ico svg{width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
.who a.card{text-decoration:none;color:inherit;display:block}.who a.card:hover{border-color:var(--p)}
.who b{display:block;font-size:17px;color:var(--t)}.who span{color:var(--m);font-size:15px}
.ticks{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:18px 28px}
.ticks li{display:flex;gap:12px}.ticks li .ico{flex:none;width:34px;height:34px;border-radius:10px}
.ticks h3{margin:2px 0 4px;font-size:17px}.ticks p{margin:0;color:var(--m);font-size:15px}
details{border:1px solid var(--b);border-radius:12px;padding:14px 18px;background:#fff;margin-bottom:10px}
summary{cursor:pointer;font-weight:700}details p{margin:10px 0 0;color:var(--m)}
.final{background:linear-gradient(150deg,#0b6a73,#0e7c86 45%,#1690a0);color:#fff;border-radius:20px;padding:44px 32px;text-align:center}
.final h2{color:#fff}.final p{opacity:.9;margin:0 0 24px}.final .btn{background:#fff;color:var(--p7);border-color:#fff}
footer{border-top:1px solid var(--b);padding:32px 0;color:var(--m);font-size:14.5px}
footer .wrap{display:flex;flex-wrap:wrap;gap:12px 28px;justify-content:space-between}footer nav{display:flex;flex-wrap:wrap;gap:8px 18px}
.crumbs{font-size:14px;color:var(--m);margin-bottom:12px}.crumbs a{color:var(--m)}
@media (max-width:820px){nav.links{display:none}header.top .wrap{gap:10px}.brand{margin-right:auto}.hero{padding:40px 0 32px}section{padding:40px 0}.final{padding:32px 20px}}
@media (max-width:420px){.top .btn.sm{height:36px;padding:0 10px;font-size:13.5px}.brand{font-size:17px}.mark{width:30px;height:30px}}
`;

function layout({ req, s, path, title, description, body, jsonld }) {
  const base = baseUrl(req);
  const name = s.product_name || 'CareDesk';
  const verify = process.env.GOOGLE_SITE_VERIFICATION;
  const nav = WHO.map(([href, label]) => `<a href="${href}">${esc(label.replace(' & counsellors', ''))}</a>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(base + path)}">
<meta name="robots" content="index, follow, max-image-preview:large">
${verify ? `<meta name="google-site-verification" content="${esc(verify)}">\n` : ''}<meta name="theme-color" content="#0e7c86">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(base + path)}">
<meta name="twitter:card" content="summary">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>${CSS}</style>
${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('\n')}
<script src="/site.js" defer></script>
</head>
<body>
<header class="top"><div class="wrap">
  <a class="brand" href="/"><span class="mark">${'<svg viewBox="0 0 24 24"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>'}</span>${esc(name)}</a>
  <nav class="links" aria-label="Clinic types">${nav}</nav>
  <a class="btn sm ghost" href="/app#signin">Sign in</a>
  <a class="btn sm pri" href="/app">Start free trial</a>
</div></header>
<main>${body}</main>
<footer><div class="wrap">
  <div>&copy; ${new Date().getFullYear()} ${esc(name)}${s.support_email ? ` · <a href="mailto:${esc(s.support_email)}">${esc(s.support_email)}</a>` : ''}${s.support_phone ? ` · ${esc(s.support_phone)}` : ''}</div>
  <nav aria-label="Pages"><a href="/">Home</a>${WHO.map(([href, label]) => `<a href="${href}">${esc(label)}</a>`).join('')}<a href="/app">Sign in</a></nav>
</div></footer>
</body>
</html>`;
}

function faqHtml(list) {
  return `<section><div class="wrap"><h2>Frequently asked questions</h2><p class="sub">Short answers to what clinics ask us most.</p>
${list.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n')}</div></section>`;
}

function finalCta(trial) {
  return `<section><div class="wrap"><div class="final"><h2>Try it free for ${trial} days</h2>
<p>Unlimited patients and every feature. No card needed: sign up in under a minute.</p>
<a class="btn" href="/app">Start your free trial</a></div></div></section>`;
}

function renderPage(req, s, path) {
  const p = PAGES[path];
  const name = s.product_name || 'CareDesk';
  const trial = TRIAL();
  const base = baseUrl(req);
  const title = p.title(name);
  const description = p.description(name, trial);
  const faq = COMMON_FAQ(name, trial);
  const crumbs = path === '/' ? '' : `<div class="crumbs"><a href="/">Home</a> › ${esc(p.h1.split(' ').slice(0, 3).join(' '))}</div>`;
  let body = `<section class="hero"><div class="wrap">${crumbs}
<span class="pill">${trial}-day free trial · unlimited patients · no card needed</span>
<h1>${esc(p.h1)}</h1><p class="lead">${esc(p.lead)}</p>
<div class="cta"><a class="btn pri" href="/app">Start free trial</a><a class="btn" href="#features">See features</a></div>
</div></section>`;
  if (p.points) {
    body += `<section><div class="wrap"><h2>Built for the way you work</h2><p class="sub">The parts of ${esc(name)} that matter most here.</p>
<ul class="ticks">${p.points.map(([h, t]) => `<li><span class="ico">${icon('check')}</span><div><h3>${esc(h)}</h3><p>${esc(t)}</p></div></li>`).join('')}</ul></div></section>`;
  }
  body += `<section class="alt" id="features"><div class="wrap"><h2>${p.points ? 'Everything else included' : 'Everything a small clinic needs'}</h2>
<p class="sub">One simple system instead of paper files, diaries and spreadsheets.</p>
<div class="grid">${FEATURES.map(([k, h, t]) => `<div class="card"><span class="ico">${icon(k)}</span><h3>${esc(h)}</h3><p>${esc(t)}</p></div>`).join('')}</div></div></section>`;
  body += `<section class="who"><div class="wrap"><h2>${path === '/' ? 'Made for your kind of clinic' : 'Also used by'}</h2><p class="sub">Starter services are set up for your specialty when you sign up.</p>
<div class="grid">${WHO.filter(([href]) => href !== path).map(([href, label, t]) => `<a class="card" href="${href}"><b>${esc(label)}</b><span>${esc(t)}</span></a>`).join('')}</div></div></section>`;
  body += faqHtml(faq) + finalCta(trial);

  const org = { '@type': 'Organization', '@id': `${base}/#org`, name, url: `${base}/`, ...(s.support_email ? { email: s.support_email } : {}) };
  const jsonld = [
    { '@context': 'https://schema.org', '@graph': [
      org,
      { '@type': 'WebSite', '@id': `${base}/#website`, url: `${base}/`, name, publisher: { '@id': `${base}/#org` } },
      { '@type': 'SoftwareApplication', name, url: `${base}/`, applicationCategory: 'BusinessApplication', applicationSubCategory: 'Clinic management software',
        operatingSystem: 'Web browser (Windows, macOS, Android, iOS)', description, publisher: { '@id': `${base}/#org` },
        featureList: FEATURES.map(([, h]) => h).join(', ') },
      { '@type': 'WebPage', '@id': `${base}${path}`, url: `${base}${path}`, name: title, description, isPartOf: { '@id': `${base}/#website` } },
      ...(path === '/' ? [] : [{ '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${base}/` },
        { '@type': 'ListItem', position: 2, name: p.h1, item: `${base}${path}` }] }]),
      { '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    ] },
  ];
  return layout({ req, s, path, title, description, body, jsonld });
}

function notFoundPage(req, s) {
  const name = s.product_name || 'CareDesk';
  const body = `<section class="hero"><div class="wrap"><h1>Page not found</h1>
<p class="lead">This page doesn't exist. Try one of these instead:</p>
<div class="cta"><a class="btn pri" href="/">Home</a><a class="btn" href="/app">Sign in to ${esc(name)}</a></div></div></section>`;
  return layout({ req, s, path: '/404', title: `Page not found | ${name}`, description: `Page not found on ${name}.`, body, jsonld: [] })
    .replace('<meta name="robots" content="index, follow, max-image-preview:large">', '<meta name="robots" content="noindex">');
}

// Tiny external script (the CSP allows only same-origin scripts): old app links such as /#/patients open the app.
const SITE_JS = "if(/^#\\/./.test(location.hash))location.replace('/app'+location.hash);";

// Returns true when it answered the request.
async function handleSite(req, res, url) {
  const p = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
  const headers = (type, cache = 'public, max-age=600') => ({ 'Content-Type': type, 'Cache-Control': cache });
  const out = (status, body, h) => { res.writeHead(status, h); res.end(req.method === 'HEAD' ? undefined : body); return true; };

  if (p === '/robots.txt') {
    return out(200, `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /app\n\nSitemap: ${baseUrl(req)}/sitemap.xml\n`, headers('text/plain; charset=utf-8'));
  }
  if (p === '/sitemap.xml') {
    const base = baseUrl(req);
    const urls = Object.keys(PAGES).map((path) => `  <url><loc>${esc(base + path)}</loc><lastmod>${UPDATED}</lastmod><priority>${path === '/' ? '1.0' : '0.8'}</priority></url>`).join('\n');
    return out(200, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, headers('application/xml; charset=utf-8'));
  }
  if (p === '/site.js') return out(200, SITE_JS, headers('text/javascript; charset=utf-8', 'public, max-age=86400'));
  if (!PAGES[p]) return false;
  if (url.pathname !== p) return out(301, '', { Location: p + url.search });          // one address per page (no trailing slash)
  // a signed-in clinic going to the home page goes straight to its app
  if (p === '/' && state.ready && /cd_session=/.test(req.headers.cookie || '') && await getSession(req, 'clinic').catch(() => null)) {
    return out(302, '', { Location: '/app', 'Cache-Control': 'no-store' });
  }
  const s = await siteSettings();
  return out(200, renderPage(req, s, p), headers('text/html; charset=utf-8', 'public, max-age=300'));
}

async function notFound(req, res) {
  const s = await siteSettings();
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(req.method === 'HEAD' ? undefined : notFoundPage(req, s));
}

module.exports = { handleSite, notFound, PAGES, baseUrl };
