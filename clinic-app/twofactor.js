// Two-step sign-in (authenticator app) helpers shared by the clinic app and the owner panel.
const QRCode = require('qrcode');
const { db } = require('./db');
const sec = require('./security');
const { HttpError, verifyPassword } = require('./core');

async function startTwoFactor(table, row, issuer, account) {
  const secret = sec.newTotpSecret();
  await db.run(`UPDATE ${table} SET totp_pending = ? WHERE id = ?`, sec.encrypt(secret), row.id);
  const url = sec.otpauthUrl(issuer, account, secret);
  return { secret, otpauth_url: url, qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) };
}

async function enableTwoFactor(table, row, code) {
  const secret = sec.decrypt(row.totp_pending);
  if (!secret) throw new HttpError(400, 'Start the setup again.');
  const step = sec.verifyTotp(secret, code, 0);
  if (!step) throw new HttpError(400, 'That code is not correct. Check the time on your phone and try the newest code.');
  const { codes, hashes } = sec.newRecoveryCodes();
  await db.run(`UPDATE ${table} SET totp_secret = ?, totp_pending = NULL, totp_enabled = 1, totp_last_step = ?, recovery_codes = ? WHERE id = ?`,
    sec.encrypt(secret), step, hashes, row.id);
  return codes;
}

async function requirePasswordAndCode(table, row, body) {
  if (!verifyPassword(body.password || '', row.password_hash)) throw new HttpError(400, 'Password is incorrect.');
  if (row.totp_enabled && !(await sec.checkSecondFactor(table, row, body.code)).ok) throw new HttpError(400, 'The 6-digit code is not correct.');
}

async function disableTwoFactor(table, id) {
  await db.run(`UPDATE ${table} SET totp_secret = NULL, totp_pending = NULL, totp_enabled = 0, recovery_codes = NULL WHERE id = ?`, id);
}

async function renewRecoveryCodes(table, id) {
  const { codes, hashes } = sec.newRecoveryCodes();
  await db.run(`UPDATE ${table} SET recovery_codes = ? WHERE id = ?`, hashes, id);
  return codes;
}

module.exports = { startTwoFactor, enableTwoFactor, requirePasswordAndCode, disableTwoFactor, renewRecoveryCodes };
