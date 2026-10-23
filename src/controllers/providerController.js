import Provider, { DAYS } from '../models/Provider.js';
import Appointment from '../models/Appointment.js';
import User from '../models/User.js';
import { ApiError, asyncHandler } from '../middleware/error.js';
import { specFor, DOCTOR_PROFESSIONS } from '../utils/format.js';
import { notifyAdmins, notifyProvider, LINKS } from '../services/notify.js';

// Professionals who register on the website start as PENDING and only appear on the site
// (listings, search, profile page, booking) after an admin approves them (status ACTIVE).
// Listing, profile and booking endpoints all check status === 'ACTIVE' on the server.

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const num = (v) => (v === '' || v === undefined || v === null || Number.isNaN(Number(v)) ? undefined : Number(v));

function avatarFor(name) {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'Carevaa')}&background=5A2F8F&color=fff&size=128`;
}

// Turns an onboarding / edit payload into provider fields
function providerFields(body) {
  const f = {};
  if (body.name) f.name = String(body.name).trim();
  if (body.profession) f.profession = body.profession;
  if (body.specialization !== undefined) f.specialization = body.specialization;
  if (body.profession || body.specialization) {
    f.spec = specFor(body.profession || 'MBBS Doctor', body.specialization);
    f.isDoctor = DOCTOR_PROFESSIONS.includes(body.profession || 'MBBS Doctor');
  }
  if (body.spec) f.spec = body.spec;
  if (body.isDoctor !== undefined) f.isDoctor = Boolean(body.isDoctor);
  const exp = num(body.experience ?? parseInt(body.exp, 10));
  if (exp !== undefined) f.experience = exp;
  if (body.languages !== undefined) {
    f.languages = Array.isArray(body.languages)
      ? body.languages
      : String(body.languages).split(',').map((l) => l.trim()).filter(Boolean);
  }
  ['fee', 'clinicFee', 'onlineFee', 'rating'].forEach((k) => {
    const v = num(body[k]);
    if (v !== undefined) f[k] = v;
  });
  if (num(body.homeFee) !== undefined) f.fee = num(body.homeFee);
  ['city', 'state', 'district', 'locality', 'email', 'phone', 'qualification', 'registrationNumber', 'registrationCouncil', 'gender'].forEach((k) => {
    if (body[k] !== undefined) f[k] = typeof body[k] === 'string' ? body[k].trim() : body[k];
  });
  if (body.gender === '') f.gender = null;
  if (body.bio !== undefined) f.bio = String(body.bio).trim().slice(0, 600);
  if (body.pincode !== undefined && body.pincode !== '') {
    if (!/^[1-9]\d{5}$/.test(String(body.pincode).trim())) throw new ApiError(400, 'Please enter a valid 6-digit PIN code');
    f.pincode = String(body.pincode).trim();
  }
  if (num(body.homeVisitRadiusKm) !== undefined) f.homeVisitRadiusKm = num(body.homeVisitRadiusKm);
  if (body.img !== undefined && body.img !== '') {
    const img = String(body.img);
    const isUrl = /^https?:\/\//.test(img);
    const isPhoto = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(img);
    if (!isUrl && !isPhoto) throw new ApiError(400, 'Profile photo must be a JPG, PNG or WebP image');
    if (isPhoto && img.length > 700000) throw new ApiError(400, 'Profile photo is too large – please use an image under 500 KB');
    f.img = img;
  }
  if (body.loc !== undefined && body.city === undefined) f.city = body.loc;
  if (body.clinic) f.clinic = body.clinic;
  if (body.bank) {
    const acc = String(body.bank.accountNumber || '').replace(/\s/g, '');
    f.bank = {
      holderName: body.bank.holderName,
      bankName: body.bank.bankName,
      ifsc: body.bank.ifsc ? String(body.bank.ifsc).toUpperCase() : undefined,
      ...(acc ? { accountNumber: acc, accountLast4: acc.slice(-4) } : {}),
    };
  }
  if (body.schedule && typeof body.schedule === 'object') {
    f.schedule = Object.fromEntries(DAYS.map((d) => [d, Array.isArray(body.schedule[d]) ? body.schedule[d] : []]));
  }
  return f;
}

// GET /api/providers  (public: only ACTIVE providers; admin may pass ?status=ALL)
// What patients and visitors may see about a professional (no bank, personal phone or email)
const publicProvider = (p) => {
  const j = p.toJSON();
  delete j.bank;
  delete j.phone;
  delete j.email;
  delete j.user;
  return j;
};

export const listProviders = asyncHandler(async (req, res) => {
  const { search, spec, profession, city, status, isDoctor } = req.query;
  const filter = {};
  const isAdmin = req.user?.role === 'admin';

  // the website only lists active professionals – also when an admin is signed in; admin pages ask for ?status=ALL
  if (isAdmin && status === 'ALL') { /* every status */ } else if (isAdmin && status) filter.status = status;
  else filter.status = 'ACTIVE';

  if (spec) filter.spec = spec;
  if (profession) filter.profession = profession;
  if (city) filter.city = city;
  if (isDoctor !== undefined) filter.isDoctor = isDoctor === 'true';
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ name: rx }, { spec: rx }, { specialization: rx }, { city: rx }, { phone: rx }];
  }

  const providers = await Provider.find(filter).sort({ status: 1, rating: -1, createdAt: -1 });

  if (isAdmin) {
    // admin tables also show how many bookings each provider has
    const counts = await Appointment.aggregate([
      { $match: { provider: { $in: providers.map((p) => p._id) } } },
      { $group: { _id: '$provider', count: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(counts.map((c) => [c._id.toString(), c.count]));
    return res.json({
      success: true,
      count: providers.length,
      providers: providers.map((p) => ({ ...p.toJSON(), bookings: countMap[p._id.toString()] || 0 })),
    });
  }
  res.json({ success: true, count: providers.length, providers: providers.map(publicProvider) });
});

// GET /api/providers/me  (logged-in doctor's own profile)
export const myProvider = asyncHandler(async (req, res) => {
  const provider = await Provider.findOne({ user: req.user._id });
  res.json({ success: true, provider });
});

// GET /api/providers/:id
export const getProvider = asyncHandler(async (req, res) => {
  const provider = await Provider.findById(req.params.id);
  if (!provider) throw new ApiError(404, 'Provider not found');
  const isOwner = req.user && provider.user?.equals(req.user._id);
  if (provider.status !== 'ACTIVE' && req.user?.role !== 'admin' && !isOwner) throw new ApiError(404, 'Provider not found');

  let stats;
  if (req.user?.role === 'admin' || isOwner) {
    const [total, completed, upcoming, revenueAgg] = await Promise.all([
      Appointment.countDocuments({ provider: provider._id }),
      Appointment.countDocuments({ provider: provider._id, status: 'Completed' }),
      Appointment.countDocuments({ provider: provider._id, status: { $in: ['Waiting', 'Confirmed'] } }),
      Appointment.aggregate([
        { $match: { provider: provider._id, paymentStatus: 'Paid' } },
        { $group: { _id: null, total: { $sum: '$fee' } } },
      ]),
    ]);
    stats = { total, completed, upcoming, revenue: revenueAgg[0]?.total || 0 };
  }
  res.json({ success: true, provider: req.user?.role === 'admin' || isOwner ? provider : publicProvider(provider), stats });
});

// POST /api/providers/onboarding  (doctor submits / updates professional profile)
export const submitOnboarding = asyncHandler(async (req, res) => {
  const fields = providerFields(req.body);
  if (!fields.name) fields.name = req.user.name;
  if (!req.body.profession) throw new ApiError(400, 'Please select your profession');

  let provider = await Provider.findOne({ user: req.user._id });
  const isNew = !provider;
  let resubmitted = false;
  if (provider) {
    Object.assign(provider, fields);
    // a rejected professional who updates their details goes back into the review queue
    if (provider.status === 'REJECTED') { provider.status = 'PENDING'; resubmitted = true; }
  } else {
    provider = new Provider({
      ...fields,
      user: req.user._id,
      email: req.user.email,
      phone: fields.phone || req.user.phone || fields.clinic?.phone,
      status: 'PENDING', // waits for admin approval
    });
  }
  if (!provider.img) provider.img = avatarFor(provider.name);
  await provider.save();

  if (isNew || resubmitted) {
    await notifyAdmins({ type: 'account', title: resubmitted ? 'Professional re-submitted for approval' : 'New professional waiting for approval', body: `${provider.name} (${provider.spec || provider.profession || 'professional'}${provider.city ? `, ${provider.city}` : ''}) ${resubmitted ? 'updated their details after rejection' : 'registered'}. Review and approve or reject.`, link: `/admin/providers/${provider._id}` });
  }
  req.user.provider = provider._id;
  if (fields.name && req.user.name !== fields.name) req.user.name = fields.name;
  await req.user.save();

  const message = provider.status === 'ACTIVE' ? 'Profile updated – it is live on the website'
    : provider.status === 'PENDING' ? 'Profile submitted – the Carevaa team will review it. It will appear on the website once approved.'
      : 'Profile saved';
  res.status(isNew ? 201 : 200).json({ success: true, message, provider });
});

// POST /api/providers  (admin creates provider directly)
export const createProvider = asyncHandler(async (req, res) => {
  const fields = providerFields(req.body);
  if (!fields.name) throw new ApiError(400, 'Name is required');
  if (!fields.spec) fields.spec = specFor(req.body.profession || 'MBBS Doctor', req.body.specialization);
  const provider = await Provider.create({ ...fields, img: fields.img || avatarFor(fields.name), status: req.body.status || 'ACTIVE' });
  res.status(201).json({ success: true, provider });
});

// PUT /api/providers/:id  (admin, or the doctor who owns it)
export const updateProvider = asyncHandler(async (req, res) => {
  const provider = await Provider.findById(req.params.id);
  if (!provider) throw new ApiError(404, 'Provider not found');
  const isOwner = provider.user?.equals(req.user._id);
  if (req.user.role !== 'admin' && !isOwner) throw new ApiError(403, 'Not allowed');

  Object.assign(provider, providerFields(req.body));
  if (req.user.role === 'admin' && req.body.status) provider.status = req.body.status;
  // a rejected professional who corrects their profile is sent back for review
  const resubmitted = req.user.role !== 'admin' && provider.status === 'REJECTED';
  if (resubmitted) provider.status = 'PENDING';
  await provider.save();
  if (resubmitted) await notifyAdmins({ type: 'account', title: 'Professional re-submitted for approval', body: `${provider.name} updated their details after rejection. Review and approve or reject.`, link: `/admin/providers/${provider._id}` });
  res.json({ success: true, provider });
});

// PATCH /api/providers/:id/status  { status }  (admin)
export const updateProviderStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!['PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED'].includes(status)) throw new ApiError(400, 'Invalid status');
  const provider = await Provider.findById(req.params.id);
  if (!provider) throw new ApiError(404, 'Provider not found');
  const previous = provider.status;
  provider.status = status;
  if (status === 'ACTIVE') provider.verifiedAt = new Date();
  await provider.save();
  if (previous !== status) {
    const msg = {
      ACTIVE: ['Your profile is approved', 'Your Carevaa profile is live. Patients can now find and book you.'],
      REJECTED: ['Profile not approved', 'Your profile could not be approved. Please check your details or contact the Carevaa team.'],
      SUSPENDED: ['Profile paused', 'Your profile has been paused by the Carevaa team. Please contact support.'],
      PENDING: ['Profile under review', 'Your profile is being reviewed by the Carevaa team.'],
    }[status];
    await notifyProvider(provider, { type: 'account', title: msg[0], body: msg[1], link: LINKS.doctor('My Profile') });
  }
  res.json({ success: true, provider });
});

// DELETE /api/providers/:id  (admin)
export const deleteProvider = asyncHandler(async (req, res) => {
  const provider = await Provider.findById(req.params.id);
  if (!provider) throw new ApiError(404, 'Provider not found');
  const upcoming = await Appointment.countDocuments({ provider: provider._id, status: { $in: ['Waiting', 'Confirmed'] } });
  if (upcoming) throw new ApiError(409, `${provider.name} has ${upcoming} upcoming appointment${upcoming === 1 ? '' : 's'}. Cancel or move ${upcoming === 1 ? 'it' : 'them'} first, or use "Remove from website" to hide the profile instead.`);
  await Provider.deleteOne({ _id: provider._id });
  if (provider.user) await User.updateOne({ _id: provider.user }, { $unset: { provider: 1 } });
  res.json({ success: true, message: 'Provider deleted' });
});
