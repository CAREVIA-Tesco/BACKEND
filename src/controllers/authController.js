import User from '../models/User.js';
import Provider from '../models/Provider.js';
import Appointment from '../models/Appointment.js';
import Payment from '../models/Payment.js';
import Enquiry from '../models/Enquiry.js';
import { signToken } from '../middleware/auth.js';
import { ApiError, asyncHandler } from '../middleware/error.js';

const isEmail = (v) => /\S+@\S+\.\S+/.test(v);
const normalizePhone = (v) => v.replace(/[^\d+]/g, '');

function identifierQuery(identifier) {
  const value = String(identifier || '').trim();
  if (!value) throw new ApiError(400, 'Email or phone number is required');
  return isEmail(value) ? { email: value.toLowerCase() } : { phone: normalizePhone(value) };
}

// A patient who booked as a guest (Book Now, or a booking with only a mobile number) and later
// registers or logs in with that mobile number gets those visits, records and requests in their account.
const last10 = (v) => String(v || '').replace(/\D/g, '').slice(-10);
export async function linkGuestRecords(user) {
  if (user.role !== 'patient') return;
  const phone = last10(user.phone);
  if (phone.length !== 10) return;
  const unlinked = { $or: [{ patientUser: { $exists: false } }, { patientUser: null }] };
  const appts = (await Appointment.find(unlinked).select('_id patientPhone')).filter((a) => last10(a.patientPhone) === phone);
  if (appts.length) {
    const ids = appts.map((a) => a._id);
    await Appointment.updateMany({ _id: { $in: ids } }, { patientUser: user._id });
    await Payment.updateMany({ appointment: { $in: ids } }, { patientUser: user._id });
  }
  const enqs = (await Enquiry.find(unlinked).select('_id phone')).filter((e) => last10(e.phone) === phone);
  if (enqs.length) await Enquiry.updateMany({ _id: { $in: enqs.map((e) => e._id) } }, { patientUser: user._id });
}

async function sessionPayload(user) {
  let provider = null;
  if (user.role === 'doctor') provider = await Provider.findOne({ user: user._id });
  return {
    success: true,
    token: signToken(user),
    user: {
      ...user.toJSON(),
      providerId: provider?._id.toString() || null,
      providerStatus: provider?.status || null,
    },
  };
}

// POST /api/auth/register  { name, identifier | email | phone, password, role }
export const register = asyncHandler(async (req, res) => {
  const { name, password } = req.body;
  const role = req.body.role === 'doctor' ? 'doctor' : 'patient'; // admins are never self-registered
  const identifier = req.body.identifier || req.body.email || req.body.phone;

  if (!name || !String(name).trim()) throw new ApiError(400, 'Full name is required');
  if (!password || String(password).length < 6) throw new ApiError(400, 'Password must be at least 6 characters');

  const query = identifierQuery(identifier);
  if (await User.findOne(query)) throw new ApiError(409, 'An account with this email/phone already exists. Please login.');

  // Optional patient details asked at sign-up (who needs care, age, gender, mobile, city, PIN, conditions)
  const extra = {};
  if (role === 'patient') {
    const b = req.body;
    if (b.phone && !query.phone) {
      const phone = normalizePhone(String(b.phone));
      if (phone.replace(/\D/g, '').length < 10) throw new ApiError(400, 'Please enter a valid 10-digit mobile number');
      if (await User.findOne({ phone })) throw new ApiError(409, 'This mobile number is already registered. Please login.');
      extra.phone = phone;
    }
    if (b.careFor !== undefined && b.careFor !== '') {
      if (!['Myself', 'Parent', 'Spouse', 'Child', 'Other'].includes(b.careFor)) throw new ApiError(400, 'Please choose who needs care');
      extra.careFor = b.careFor;
    }
    if (b.age !== undefined && b.age !== '') {
      const age = Number(b.age);
      if (!Number.isInteger(age) || age < 0 || age > 120) throw new ApiError(400, "Please enter the patient's age in years");
      extra.age = age;
    }
    if (b.gender) extra.gender = String(b.gender).trim();
    if (b.city) extra.city = String(b.city).trim().slice(0, 80);
    if (b.pincode !== undefined && b.pincode !== '') {
      if (!/^[1-9]\d{5}$/.test(String(b.pincode).trim())) throw new ApiError(400, 'Please enter a valid 6-digit PIN code');
      extra.pincode = String(b.pincode).trim();
    }
    if (b.conditions) extra.conditions = String(b.conditions).split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20);
  }

  const user = await User.create({ name: String(name).trim(), password, role, ...extra, ...query });
  await linkGuestRecords(user).catch(() => {});
  res.status(201).json(await sessionPayload(user));
});

// POST /api/auth/login  { identifier, password, role? }
export const login = asyncHandler(async (req, res) => {
  const { password, role } = req.body;
  const identifier = req.body.identifier || req.body.email || req.body.phone;
  if (!password) throw new ApiError(400, 'Password is required');

  const user = await User.findOne(identifierQuery(identifier)).select('+password');
  if (!user || !(await user.matchPassword(password))) throw new ApiError(401, 'Invalid email/phone or password');
  if (role && user.role !== role) {
    throw new ApiError(403, `This account is registered as ${user.role === 'admin' ? 'an admin' : `a ${user.role}`}. Please choose the "${user.role.charAt(0).toUpperCase() + user.role.slice(1)}" tab.`);
  }
  if (user.status === 'Inactive') throw new ApiError(403, 'Your account is inactive. Contact support.');

  user.lastLoginAt = new Date();
  await user.save();
  await linkGuestRecords(user).catch(() => {});
  res.json(await sessionPayload(user));
});

// GET /api/auth/me
export const me = asyncHandler(async (req, res) => {
  const payload = await sessionPayload(req.user);
  res.json({ success: true, user: payload.user });
});

// PUT /api/auth/me  { name, age, gender, city, phone, email }
export const updateMe = asyncHandler(async (req, res) => {
  const b = req.body;
  // validate what the person typed before saving anything
  if (b.phone !== undefined && b.phone !== '') {
    b.phone = String(b.phone).replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(b.phone)) throw new ApiError(400, 'Please enter a valid 10-digit mobile number');
    if (await User.findOne({ phone: b.phone, _id: { $ne: req.user._id } })) throw new ApiError(409, 'This mobile number is already used by another account');
  }
  if (b.email !== undefined && b.email !== '') {
    b.email = String(b.email).trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(b.email)) throw new ApiError(400, 'Please enter a valid email address');
    if (await User.findOne({ email: b.email, _id: { $ne: req.user._id } })) throw new ApiError(409, 'This email is already used by another account');
  }
  if (b.pincode !== undefined && b.pincode !== '' && !/^[1-9]\d{5}$/.test(String(b.pincode))) throw new ApiError(400, 'Please enter a valid 6-digit PIN code');
  if (b.age !== undefined && b.age !== '' && (!Number.isFinite(Number(b.age)) || Number(b.age) < 0 || Number(b.age) > 120)) throw new ApiError(400, 'Please enter a valid age');
  if (b.careFor !== undefined && b.careFor !== '' && !['Myself', 'Parent', 'Spouse', 'Child', 'Other'].includes(b.careFor)) throw new ApiError(400, 'Invalid value for who needs care');

  const allowed = ['name', 'age', 'gender', 'city', 'pincode', 'careFor', 'phone', 'email', 'bloodGroup', 'emergencyContact'];
  ['allergies', 'conditions'].forEach((k) => {
    if (b[k] !== undefined) req.user[k] = (Array.isArray(b[k]) ? b[k] : String(b[k]).split(',')).map((x) => String(x).trim()).filter(Boolean);
  });
  allowed.forEach((k) => {
    if (b[k] !== undefined && b[k] !== '') req.user[k] = typeof b[k] === 'string' ? b[k].trim() : b[k];
  });
  if (b.password) {
    if (String(b.password).length < 6) throw new ApiError(400, 'Password must be at least 6 characters');
    // the current password is needed to set a new one, so someone at an unlocked screen cannot take over the account
    const withPw = await User.findById(req.user._id).select('+password');
    if (!b.currentPassword || !(await withPw.matchPassword(String(b.currentPassword)))) throw new ApiError(400, 'Your current password is not correct');
    req.user.password = b.password;
  }
  await req.user.save();
  res.json({ success: true, user: req.user.toJSON() });
});
