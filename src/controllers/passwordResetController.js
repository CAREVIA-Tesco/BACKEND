import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Provider from '../models/Provider.js';
import { signToken } from '../middleware/auth.js';
import { ApiError, asyncHandler } from '../middleware/error.js';
import { smsConfigured, usesVerify, verifySend, verifyCheck, newCode, hashCode, sendText } from '../services/sms.js';

// Forgot password with a mobile OTP (patients and professionals; admin accounts are excluded).
//   1. POST /api/auth/forgot-password { phone }            -> SMS with a 6-digit code
//   2. POST /api/auth/verify-otp      { phone, code }      -> resetToken (valid 10 minutes, one use)
//   3. POST /api/auth/reset-password  { resetToken, password } -> new password saved, logged in

const OTP_MINUTES = 10;
const RESEND_SECONDS = 30;
const MAX_SENDS_PER_HOUR = 5;
const MAX_TRIES = 5;
const GENERIC = 'If this mobile number is registered with Carevaa, you will receive an OTP shortly.';

const phone10 = (v) => String(v || '').replace(/\D/g, '').slice(-10);
const validPhone = (p) => /^[6-9]\d{9}$/.test(p);

async function findAccount(p) {
  // phones are stored as typed (with or without +91), so match on the last 10 digits
  const list = await User.find({ phone: { $regex: `${p}$` }, role: { $in: ['patient', 'doctor'] } }).select('+resetOtp +resetOtpSentAt +password');
  return list.find((u) => phone10(u.phone) === p) || null;
}

// per-IP limit on top of the per-number limits
const ipHits = new Map();
function ipLimited(ip) {
  const now = Date.now();
  const rec = (ipHits.get(ip) || []).filter((t) => now - t < 60 * 60 * 1000);
  rec.push(now);
  ipHits.set(ip, rec);
  if (ipHits.size > 5000) ipHits.clear();
  return rec.length > 20;
}

// the reset token is signed with a separate key and carries a fingerprint of the current password,
// so it cannot be used as a login and stops working once the password has been changed
const resetKey = () => `${process.env.JWT_SECRET}:password-reset`;
const fingerprint = (user) => crypto.createHash('sha256').update(String(user.password)).digest('hex').slice(0, 16);

export const forgotPassword = asyncHandler(async (req, res) => {
  const p = phone10(req.body.phone);
  if (!validPhone(p)) throw new ApiError(400, 'Please enter a valid 10-digit mobile number');
  if (!smsConfigured()) throw new ApiError(503, 'Password reset by SMS is not available right now. Please contact support.');
  if (ipLimited(req.ip)) throw new ApiError(429, 'Too many requests. Please try again after some time.');

  const user = await findAccount(p);
  if (!user || user.status === 'Inactive') return res.json({ success: true, message: GENERIC, resendIn: RESEND_SECONDS });

  const now = Date.now();
  const recent = (user.resetOtpSentAt || []).filter((t) => now - new Date(t).getTime() < 60 * 60 * 1000);
  const last = recent.length ? new Date(recent[recent.length - 1]).getTime() : 0;
  if (now - last < RESEND_SECONDS * 1000) throw new ApiError(429, `Please wait ${Math.ceil((RESEND_SECONDS * 1000 - (now - last)) / 1000)} seconds before asking for a new OTP.`);
  if (recent.length >= MAX_SENDS_PER_HOUR) throw new ApiError(429, 'Too many OTPs requested for this number. Please try again after an hour.');

  try {
    if (usesVerify()) {
      await verifySend(p);
      user.resetOtp = undefined;
    } else {
      const code = newCode();
      await sendText(p, `${code} is your Carevaa OTP to reset your password. It is valid for ${OTP_MINUTES} minutes. Do not share it with anyone.`);
      user.resetOtp = { hash: hashCode(code), expiresAt: new Date(now + OTP_MINUTES * 60 * 1000), attempts: 0 };
    }
  } catch (e) {
    console.warn(`[sms] OTP send failed for ****${p.slice(-4)}: ${e.message}${e.code ? ` (Twilio ${e.code})` : ''}`);
    throw new ApiError(502, 'We could not send the OTP right now. Please try again in a minute.');
  }
  user.resetOtpSentAt = [...recent, new Date(now)];
  await user.save({ validateModifiedOnly: true });
  res.json({ success: true, message: GENERIC, resendIn: RESEND_SECONDS });
});

export const verifyOtp = asyncHandler(async (req, res) => {
  const p = phone10(req.body.phone);
  const code = String(req.body.code || '').trim();
  if (!validPhone(p)) throw new ApiError(400, 'Please enter a valid 10-digit mobile number');
  if (!/^\d{4,8}$/.test(code)) throw new ApiError(400, 'Please enter the 6-digit OTP');
  if (ipLimited(req.ip)) throw new ApiError(429, 'Too many requests. Please try again after some time.');
  const wrong = new ApiError(400, 'The OTP is incorrect or has expired. Please check it or ask for a new one.');

  const user = await findAccount(p);
  if (!user || user.status === 'Inactive') throw wrong;

  let ok = false;
  if (usesVerify()) {
    try { ok = await verifyCheck(p, code); } catch (e) {
      console.warn(`[sms] OTP check failed: ${e.message}`);
      throw new ApiError(502, 'We could not check the OTP right now. Please try again.');
    }
  } else {
    const otp = user.resetOtp;
    if (!otp?.hash || new Date(otp.expiresAt).getTime() < Date.now()) throw wrong;
    if ((otp.attempts || 0) >= MAX_TRIES) throw new ApiError(429, 'Too many wrong attempts. Please ask for a new OTP.');
    const a = Buffer.from(otp.hash, 'hex');
    const b = Buffer.from(hashCode(code), 'hex');
    ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    user.resetOtp = ok ? undefined : { hash: otp.hash, expiresAt: otp.expiresAt, attempts: (otp.attempts || 0) + 1 };
    await user.save({ validateModifiedOnly: true });
  }
  if (!ok) throw wrong;

  const resetToken = jwt.sign({ id: user._id.toString(), purpose: 'password-reset', fp: fingerprint(user) }, resetKey(), { expiresIn: `${OTP_MINUTES}m` });
  res.json({ success: true, resetToken, name: user.name.split(' ')[0] });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const password = String(req.body.password || '');
  if (password.length < 6) throw new ApiError(400, 'Password must be at least 6 characters');
  let decoded;
  try { decoded = jwt.verify(String(req.body.resetToken || ''), resetKey()); } catch { decoded = null; }
  if (!decoded || decoded.purpose !== 'password-reset') throw new ApiError(400, 'This reset link has expired. Please start again.');
  const user = await User.findById(decoded.id).select('+password');
  if (!user || !['patient', 'doctor'].includes(user.role) || fingerprint(user) !== decoded.fp) throw new ApiError(400, 'This reset link has expired. Please start again.');
  if (await user.matchPassword(password)) throw new ApiError(400, 'Please choose a password different from your old one');

  user.password = password;
  user.resetOtpSentAt = undefined;
  await user.save();
  let provider = null;
  if (user.role === 'doctor') provider = await Provider.findOne({ user: user._id });
  res.json({
    success: true,
    message: 'Your password has been changed.',
    token: signToken(user),
    user: { ...user.toJSON(), providerId: provider?._id.toString() || null, providerStatus: provider?.status || null },
  });
});
