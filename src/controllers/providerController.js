import Provider, { DAYS } from '../models/Provider.js';
import Appointment from '../models/Appointment.js';
import User from '../models/User.js';
import { Service } from '../models/Catalog.js';
import { ApiError, asyncHandler } from '../middleware/error.js';
import { specFor, isDoctorProfession, isValidAadhaar } from '../utils/format.js';
import { notifyAdmins, notifyProvider, LINKS } from '../services/notify.js';
import { TYPES, cleanHours, offersOf, scheduleUnion, hasHours, hoursText } from '../utils/slots.js';
import { slotCalendar } from '../services/slotBooking.js';

// Validates that services selected by a provider belong to their profession
export async function validateProviderServices(profession, services = [], servicesOffered = []) {
  const selectedNames = [
    ...new Set([
      ...(services || []).map((s) => (typeof s === 'string' ? s : s?.name)).filter(Boolean),
      ...(servicesOffered || []),
    ]),
  ];
  if (selectedNames.length === 0) return;

  const catalogServices = await Service.find();
  const catalogMap = new Map();
  for (const cs of catalogServices) {
    if (cs.name) catalogMap.set(cs.name.toLowerCase().trim(), cs);
    if (cs.key) catalogMap.set(cs.key.toLowerCase().trim(), cs);
  }

  for (const name of selectedNames) {
    const matchedService = catalogMap.get(name.toLowerCase().trim());
    if (matchedService) {
      const allowedProfessions = (matchedService.professions || []).map((p) => p.toLowerCase());
      const matches = (matchedService.matches || []).map((m) => m.toLowerCase());
      const profLower = (profession || '').toLowerCase();
      const isAllowed = allowedProfessions.includes(profLower) || matches.includes(profLower);
      if (!isAllowed && allowedProfessions.length > 0) {
        throw new ApiError(400, `Service "${matchedService.name}" is not available for profession "${profession}".`);
      }
    }
  }
}

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
    f.isDoctor = isDoctorProfession(body.profession || 'MBBS Doctor');
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
  ['city', 'state', 'district', 'locality', 'email', 'phone', 'qualification', 'registrationNumber', 'registrationCouncil', 'gender', 'contactPerson', 'centreType', 'accreditation', 'trainingCertificates'].forEach((k) => {
    if (body[k] !== undefined) f[k] = typeof body[k] === 'string' ? body[k].trim() : body[k];
  });
  if (body.services !== undefined) {
    if (Array.isArray(body.services)) {
      f.services = body.services.map((s) => {
        if (typeof s === 'string') return { name: s.trim() };
        return {
          serviceId: s.serviceId || s.id,
          serviceKey: s.serviceKey || s.key,
          name: String(s.name || '').trim(),
          description: s.description ? String(s.description).trim().slice(0, 500) : undefined,
          price: num(s.price ?? s.fee),
          homeAvailable: Boolean(s.homeAvailable),
          onlineAvailable: Boolean(s.onlineAvailable),
          clinicAvailable: Boolean(s.clinicAvailable),
        };
      }).filter((s) => s.name);
      if (!body.servicesOffered) {
        f.servicesOffered = f.services.map((s) => s.name);
      }
    }
  }
  if (body.servicesOffered !== undefined) {
    f.servicesOffered = Array.isArray(body.servicesOffered)
      ? body.servicesOffered.map((s) => String(s).trim()).filter(Boolean)
      : String(body.servicesOffered).split(',').map((s) => s.trim()).filter(Boolean);
    if (!f.services || f.services.length === 0) {
      f.services = f.servicesOffered.map((name) => ({ name }));
    }
  }
  if (body.careTypes !== undefined) {
    f.careTypes = Array.isArray(body.careTypes)
      ? body.careTypes
      : String(body.careTypes).split(',').map((c) => c.trim()).filter(Boolean);
  }
  if (body.profession === 'Lab Centre' || f.profession === 'Lab Centre') {
    f.gender = null;
    f.isDoctor = false;
  }
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
  if (body.aadhaar && typeof body.aadhaar === 'object') {
    const a = {};
    const num = String(body.aadhaar.number || '').replace(/\s/g, '');
    if (num) {
      if (!isValidAadhaar(num)) throw new ApiError(400, 'Please enter a valid 12-digit Aadhaar number');
      a.number = num; a.last4 = num.slice(-4);
    }
    const photo = String(body.aadhaar.photo || '');
    if (photo) {
      if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo)) throw new ApiError(400, 'Aadhaar photo must be a JPG, PNG or WebP image');
      if (photo.length > 1600000) throw new ApiError(400, 'Aadhaar photo is too large – please use an image under 1 MB');
      a.photo = photo; a.photoUploaded = true;
    }
    if (Object.keys(a).length) f.aadhaar = { ...a, updatedAt: new Date() };
  }
  if (body.consultTypes && typeof body.consultTypes === 'object') {
    f.consultTypes = Object.fromEntries(TYPES.map((t) => [t, Boolean(body.consultTypes[t])]));
  }
  if (body.hours !== undefined) f.hours = cleanHours(body.hours);
  return f;
}

// copy form fields onto a profile; Aadhaar is merged so sending only the number keeps the saved photo
function assignFields(provider, fields) {
  const { aadhaar, ...rest } = fields;
  Object.assign(provider, rest);
  if (aadhaar) Object.entries(aadhaar).forEach(([k, v]) => provider.set(`aadhaar.${k}`, v));
}

// consultation types + timings: check them and keep the weekly `schedule` (used by admin views) in step
function applyConsultation(provider, body) {
  if (body.consultTypes && typeof body.consultTypes === 'object') {
    const offers = offersOf(provider);
    if (!TYPES.some((t) => offers[t])) throw new ApiError(400, 'Please choose at least one type of consultation you offer (home visit, clinic visit or online).');
    if (offers.clinic && (!String(provider.clinic?.name || '').trim() || !String(provider.clinic?.address || '').trim())) {
      throw new ApiError(400, 'You offer clinic visits – please enter your clinic name and address.');
    }
    for (const t of TYPES) {
      const h = provider.hours?.[t];
      if (offers[t] && h && h.days?.length && !(h.sessions || []).some((s) => s.to > s.from)) {
        throw new ApiError(400, `Please check the ${t === 'clinic' ? 'clinic' : t === 'online' ? 'online consultation' : 'home visit'} timings – the end time must be after the start time.`);
      }
    }
  }
  if (body.hours !== undefined || body.consultTypes) {
    provider.markModified('hours');
    const union = scheduleUnion(provider);
    if (union) provider.schedule = union;
  }
}

// GET /api/providers  (public: only ACTIVE providers; admin may pass ?status=ALL)
// What patients and visitors may see about a professional (no bank, personal phone or email)
const publicProvider = (p, inactiveSet = new Set()) => {
  const j = p.toJSON();
  delete j.bank;
  delete j.phone;
  delete j.email;
  delete j.user;
  delete j.aadhaar;
  // fees only for the consultation types the professional offers
  if (!j.offers?.home) delete j.fee;
  if (!j.offers?.clinic) { delete j.clinicFee; delete j.clinic; }
  if (!j.offers?.online) delete j.onlineFee;
  if (j.services && Array.isArray(j.services)) {
    j.services = j.services.filter((s) => !inactiveSet.has(String(s.name || '').toLowerCase().trim()) && (!s.serviceKey || !inactiveSet.has(String(s.serviceKey).toLowerCase().trim())));
  }
  if (j.servicesOffered && Array.isArray(j.servicesOffered)) {
    j.servicesOffered = j.servicesOffered.filter((s) => !inactiveSet.has(String(s || '').toLowerCase().trim()));
  }
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
  const inactiveServices = await Service.find({ status: 'Inactive' }).select('name key');
  const inactiveSet = new Set(inactiveServices.flatMap((s) => [s.name?.toLowerCase().trim(), s.key?.toLowerCase().trim()]).filter(Boolean));
  res.json({ success: true, count: providers.length, providers: providers.map((p) => publicProvider(p, inactiveSet)) });
});

// GET /api/providers/me  (logged-in doctor's own profile)
export const myProvider = asyncHandler(async (req, res) => {
  const provider = await Provider.findOne({ user: req.user._id });
  res.json({ success: true, provider });
});

// GET /api/providers/:id
export const getProvider = asyncHandler(async (req, res) => {
  // the admin team also gets the Aadhaar number and photo to verify the professional
  const provider = await Provider.findById(req.params.id).select(req.user?.role === 'admin' ? '+aadhaar.number +aadhaar.photo' : '');
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
  const inactiveServices = await Service.find({ status: 'Inactive' }).select('name key');
  const inactiveSet = new Set(inactiveServices.flatMap((s) => [s.name?.toLowerCase().trim(), s.key?.toLowerCase().trim()]).filter(Boolean));
  res.json({ success: true, provider: req.user?.role === 'admin' || isOwner ? provider : publicProvider(provider, inactiveSet), stats });
});

// POST /api/providers/onboarding  (doctor submits / updates professional profile)
export const submitOnboarding = asyncHandler(async (req, res) => {
  const fields = providerFields(req.body);
  if (!fields.name) fields.name = req.user.name;
  if (!req.body.profession) throw new ApiError(400, 'Please select your profession');
  await validateProviderServices(req.body.profession, fields.services, fields.servicesOffered);

  let provider = await Provider.findOne({ user: req.user._id });
  const isNew = !provider;
  let resubmitted = false;
  if (provider) {
    assignFields(provider, fields);
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
  applyConsultation(provider, req.body);
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

// A doctor's account is only created together with their professional profile: the sign-up form sends the
// whole onboarding form, it is checked here first, and only then are the account and the profile saved.
export async function prepareNewProvider(body, account) {
  const b = body || {};
  if (!b.profession) throw new ApiError(400, 'Please select your profession');
  const isLab = b.profession === 'Lab Centre';
  const isCaretaker = b.profession === 'Caretaker';

  if (!isLab && !isCaretaker && !String(b.qualification || '').trim()) {
    throw new ApiError(400, b.profession === 'Nurse' ? 'Please enter your nursing qualification' : 'Please enter your highest qualification');
  }

  const needsRegistration = ['MBBS Doctor', 'Homeopathy Doctor', 'Ayurveda Doctor', 'Nurse'];
  if (needsRegistration.includes(b.profession) && !String(b.registrationNumber || '').trim()) {
    throw new ApiError(400, `Please enter your ${b.profession === 'Nurse' ? 'nursing ' : ''}council registration number`);
  }
  if (isLab && !String(b.registrationNumber || '').trim()) {
    throw new ApiError(400, 'Please enter your laboratory registration or licence number');
  }

  if (b.experience === undefined || b.experience === '' || Number(b.experience) < 0) {
    throw new ApiError(400, isLab ? 'Please enter years of operation' : 'Please enter your years of experience');
  }
  if (!String(b.city || '').trim()) throw new ApiError(400, 'Please enter the city where you work');
  if (!/^[1-9]\d{5}$/.test(String(b.pincode || '').trim())) throw new ApiError(400, 'Please enter a valid 6-digit PIN code');
  const bank = b.bank || {};
  if (!String(bank.holderName || '').trim() || !String(bank.bankName || '').trim() || !String(bank.accountNumber || '').trim() || !String(bank.ifsc || '').trim()) {
    throw new ApiError(400, 'Please fill in all bank details');
  }
  const ad = b.aadhaar || {};
  if (!String(ad.number || '').trim()) throw new ApiError(400, isLab ? 'Please enter the owner or contact person ID number' : 'Please enter your Aadhaar number');
  if (!String(ad.photo || '').trim()) throw new ApiError(400, isLab ? 'Please upload a photo of the owner or contact person ID card' : 'Please upload a photo of your Aadhaar card');
  const fields = providerFields(b);
  await validateProviderServices(b.profession, fields.services, fields.servicesOffered);
  if (!fields.name) fields.name = account.name;
  const provider = new Provider({
    ...fields,
    email: account.email,
    phone: fields.phone || account.phone || fields.clinic?.phone,
    status: 'PENDING', // waits for admin approval
  });
  if (!provider.img) provider.img = avatarFor(provider.name);
  applyConsultation(provider, b);
  await provider.validate();
  return provider;
}

export async function announceNewProvider(provider) {
  await notifyAdmins({ type: 'account', title: 'New professional waiting for approval', body: `${provider.name} (${provider.spec || provider.profession || 'professional'}${provider.city ? `, ${provider.city}` : ''}) registered. Review and approve or reject.`, link: `/admin/providers/${provider._id}` });
}

// POST /api/providers  (admin creates provider directly)
export const createProvider = asyncHandler(async (req, res) => {
  const fields = providerFields(req.body);
  if (!fields.name) throw new ApiError(400, 'Name is required');
  const targetProfession = fields.profession || req.body.profession || 'MBBS Doctor';
  await validateProviderServices(targetProfession, fields.services, fields.servicesOffered);
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

  const fields = providerFields(req.body);
  const targetProfession = fields.profession || provider.profession || 'MBBS Doctor';
  if (fields.services || fields.servicesOffered) {
    await validateProviderServices(targetProfession, fields.services, fields.servicesOffered);
  }
  assignFields(provider, fields);
  applyConsultation(provider, req.body);
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

// GET /api/providers/:id/slots?type=clinic&from=YYYY-MM-DD&days=14  (public)
// The consultation types the doctor offers, and the free / booked slots for the chosen type.
export const providerSlots = asyncHandler(async (req, res) => {
  const provider = await Provider.findById(req.params.id).catch(() => null);
  const isOwner = req.user && provider?.user?.equals(req.user._id);
  if (!provider || (provider.status !== 'ACTIVE' && req.user?.role !== 'admin' && !isOwner)) throw new ApiError(404, 'This doctor is not available for booking right now');
  const offers = offersOf(provider);
  const type = TYPES.includes(req.query.type) && offers[req.query.type] ? req.query.type : TYPES.find((t) => offers[t]);
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 1), 60);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? req.query.from : undefined;
  const configured = hasHours(provider, type);
  res.json({
    success: true,
    providerId: provider._id.toString(),
    type,
    offers,
    modes: provider.toJSON().modes,
    configured,
    hours: hoursText(provider, type),
    clinic: offers.clinic ? { name: provider.clinic?.name || '', address: provider.clinic?.address || '', phone: provider.clinic?.phone || '', website: provider.clinic?.website || '', city: provider.city || '' } : null,
    days: configured ? await slotCalendar(provider, type, { from, days }) : [],
  });
});
