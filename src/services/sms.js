// Sends and checks one-time codes by SMS through Twilio (plain REST calls, no extra package).
//
// Env vars (set them on Render – never in the frontend or in git):
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN      required
//   TWILIO_VERIFY_SID   (VA…)  preferred: Twilio Verify creates, sends, expires and checks the code
//   TWILIO_FROM         (+1…)  used when there is no Verify service: we create the code and send it
//                              from this Twilio number with the Messages API
import crypto from 'crypto';

const API = () => (process.env.TWILIO_API_BASE || 'https://api.twilio.com').replace(/\/$/, '');
const VERIFY = () => (process.env.TWILIO_VERIFY_BASE || 'https://verify.twilio.com').replace(/\/$/, '');

export const smsConfigured = () => !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && (process.env.TWILIO_VERIFY_SID || process.env.TWILIO_FROM));
export const usesVerify = () => !!process.env.TWILIO_VERIFY_SID;

async function twilio(url, form) {
  const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: ctrl.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(data.message || `Twilio error ${r.status}`);
      err.status = r.status;
      err.code = data.code;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export const toE164 = (phone10) => `+91${phone10}`;

// Twilio Verify
export const verifySend = (phone10) => twilio(`${VERIFY()}/v2/Services/${process.env.TWILIO_VERIFY_SID}/Verifications`, { To: toE164(phone10), Channel: 'sms' });
export async function verifyCheck(phone10, code) {
  try {
    const r = await twilio(`${VERIFY()}/v2/Services/${process.env.TWILIO_VERIFY_SID}/VerificationCheck`, { To: toE164(phone10), Code: code });
    return r.status === 'approved';
  } catch (e) {
    if (e.status === 404) return false; // expired / already used / too many tries
    throw e;
  }
}

// Messages API (our own code)
export const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
export const hashCode = (code) => crypto.createHmac('sha256', process.env.JWT_SECRET || 'carevaa').update(String(code)).digest('hex');
export const sendText = (phone10, body) => twilio(`${API()}/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`, { To: toE164(phone10), From: process.env.TWILIO_FROM, Body: body });
