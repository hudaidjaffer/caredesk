// Sends emails (sign-up verification codes) through the owner's SMTP account.
// Configured in the owner panel → Settings → Email; the SMTP password is stored encrypted.
const nodemailer = require('nodemailer');
const { getSettings } = require('./db');
const sec = require('./security');
const { HttpError } = require('./core');

function mailConfig(s) {
  const port = Number(s.smtp_port) || 465;
  return {
    host: String(s.smtp_host || '').trim(),
    port,
    user: String(s.smtp_user || '').trim(),
    pass: sec.decrypt(s.smtp_pass) || '',
    from: String(s.smtp_from || '').trim() || String(s.smtp_user || '').trim(),
  };
}

// ready = server and sender known, and (when a username is used) its password has been saved
const emailReady = (s) => { const c = mailConfig(s); return !!(c.host && c.from && (!c.user || c.pass)); };

function transport(c) {
  const local = ['localhost', '127.0.0.1', '::1'].includes(c.host);
  return nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.port === 465,               // 465 = TLS from the start; 587/25 = upgrade with STARTTLS
    requireTLS: c.port !== 465 && !local, // never send the password unencrypted
    auth: c.user ? { user: c.user, pass: c.pass } : undefined,
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
  });
}

function friendlyMailError(err) {
  const m = String(err && err.message);
  if (/Invalid login|auth|535|534/i.test(m)) return 'The email server rejected the username or password. (Gmail needs an "App password", not your normal password.)';
  if (/ENOTFOUND|getaddrinfo/i.test(m)) return 'Cannot find the email server. Check the "SMTP server" address.';
  if (/ECONNREFUSED|ETIMEDOUT|timeout|ECONNRESET|ENETUNREACH|EHOSTUNREACH/i.test(m)) {
    // Render's free plan blocks outbound email (ports 25/465/587); any paid instance type allows it
    if (process.env.RENDER) return 'Email could not be sent: this server is on Render\'s free plan, which blocks sending email. Upgrade the service to a paid instance type (Starter).';
    return 'Cannot connect to the email server. Check the server address and port (usually 465 or 587).';
  }
  return `Email could not be sent (${m.slice(0, 200)}).`;
}

async function sendMail({ to, subject, text, html }, settings) {
  const s = settings || await getSettings();
  const c = mailConfig(s);
  if (!emailReady(s)) throw new HttpError(503, 'Email sending is not set up yet.');
  const fromName = String(s.product_name || 'CareDesk').replace(/["<>\r\n]/g, '');
  try {
    await transport(c).sendMail({ from: { name: fromName, address: c.from }, to, subject, text, html });
  } catch (err) {
    console.error('Email error:', err.message);
    throw new HttpError(502, friendlyMailError(err));
  }
}

const esc = (v) => String(v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// The sign-up email: a 6-digit code, plus a one-click link when the website address is known.
async function sendSignupCode(to, code, link, settings) {
  const product = settings.product_name || 'CareDesk';
  const text = [
    `Your ${product} verification code is: ${code}`,
    '',
    link ? `Or click this link to confirm your email:\n${link}\n` : '',
    'The code expires in 30 minutes. If you did not sign up, you can ignore this email.',
  ].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#1f2937">
  <h2 style="color:#0e7c86">${esc(product)}</h2>
  <p>Use this code to confirm your email and start your free trial:</p>
  <p style="font-size:32px;letter-spacing:8px;font-weight:bold;background:#f0f9fa;padding:14px;text-align:center;border-radius:8px">${esc(code)}</p>
  ${link ? `<p style="text-align:center"><a href="${esc(link)}" style="display:inline-block;background:#0e7c86;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none">Confirm my email</a></p>` : ''}
  <p style="color:#6b7280;font-size:13px">The code expires in 30 minutes. If you did not sign up, you can ignore this email.</p>
</div>`;
  await sendMail({ to, subject: `${code} is your ${product} verification code`, text, html }, settings);
}

module.exports = { mailConfig, emailReady, sendMail, sendSignupCode };
