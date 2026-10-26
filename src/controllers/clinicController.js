import { ClinicPatient, ClinicVisit } from '../models/ClinicRecord.js';
import Provider from '../models/Provider.js';
import User from '../models/User.js';
import { ApiError, asyncHandler } from '../middleware/error.js';

// Patient Visit Management (walk-in clinic visits).
//  - doctor: their own patients and visits
//  - nurse:  enters and updates visits for the doctor they work for (user.staffOf)
//  - admin:  everything, plus doctor-wise reports (see the /admin/clinic/* handlers)

const TZ = '+05:30';
const digits = (v) => String(v || '').replace(/\D/g, '').slice(-10);
const clean = (v, max = 2000) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));
const nameKey = (n) => String(n || '').toLowerCase().replace(/\s+/g, ' ').trim();
const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isoDay = (d) => new Date(new Date(d).getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10); // calendar day in India
const dayStart = (day) => new Date(`${day}T00:00:00${TZ}`);
const nextDay = (day) => new Date(dayStart(day).getTime() + 24 * 3600 * 1000);
const actorOf = (user) => ({ user: user._id, name: user.name, role: user.role });

// which doctor's records this request works on
async function clinicProvider(req, { forWrite = false } = {}) {
  const u = req.user;
  if (u.role === 'doctor') {
    const p = await Provider.findOne({ user: u._id });
    if (!p) throw new ApiError(403, 'Complete your professional profile first');
    return p;
  }
  if (u.role === 'nurse') {
    const p = u.staffOf ? await Provider.findById(u.staffOf) : null;
    if (!p) throw new ApiError(403, 'Your account is not linked to a doctor. Please contact the clinic.');
    return p;
  }
  if (u.role === 'admin') {
    const id = req.body?.providerId || req.query.providerId;
    if (!id) { if (forWrite) throw new ApiError(400, 'Choose the doctor'); return null; }
    const p = await Provider.findById(id).catch(() => null);
    if (!p) throw new ApiError(404, 'Doctor not found');
    return p;
  }
  throw new ApiError(403, 'You do not have access to patient records');
}
const scope = (provider) => (provider ? { provider: provider._id } : {});

function dateRange(q) {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? q.from : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? q.to : null;
  if (!from && !to) return null;
  const r = {};
  if (from) r.$gte = dayStart(from);
  if (to) r.$lt = nextDay(to);
  return r;
}

function visitFields(b) {
  const f = {};
  ['symptoms', 'diagnosis', 'treatment', 'nurseNotes'].forEach((k) => { if (b[k] !== undefined) f[k] = clean(b[k]); });
  if (b.prescription !== undefined) f.prescription = clean(b.prescription, 3000);
  if (b.visitDate !== undefined) {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(String(b.visitDate)) ? new Date(`${b.visitDate}T${isoDay(new Date()) === b.visitDate ? new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(11, 19) : '10:00:00'}${TZ}`) : new Date(b.visitDate);
    if (Number.isNaN(d.getTime())) throw new ApiError(400, 'Please enter a valid visit date');
    if (d.getTime() > Date.now() + 24 * 3600 * 1000) throw new ApiError(400, 'Visit date cannot be in the future');
    f.visitDate = d;
  }
  return f;
}

function patientFields(p) {
  const name = clean(p.name, 100);
  const phone = digits(p.phone);
  if (!name) throw new ApiError(400, "Please enter the patient's name");
  if (!/^[6-9]\d{9}$/.test(phone)) throw new ApiError(400, 'Please enter a valid 10-digit mobile number');
  const out = { name, nameKey: nameKey(name), phone };
  if (p.age !== undefined && p.age !== '' && p.age !== null) {
    const age = Number(p.age);
    if (!Number.isInteger(age) || age < 0 || age > 120) throw new ApiError(400, 'Please enter the age in years (0–120)');
    out.age = age;
  }
  if (p.gender !== undefined && p.gender !== '') {
    if (!['Male', 'Female', 'Other'].includes(p.gender)) throw new ApiError(400, 'Please choose the gender');
    out.gender = p.gender;
  }
  return out;
}

async function refreshPatientStats(patientId) {
  const visits = await ClinicVisit.find({ patient: patientId }).select('visitDate').lean();
  const dates = visits.map((v) => new Date(v.visitDate).getTime()).sort((a, b) => a - b);
  await ClinicPatient.updateOne({ _id: patientId }, {
    visitCount: visits.length,
    firstVisitAt: dates.length ? new Date(dates[0]) : undefined,
    lastVisitAt: dates.length ? new Date(dates[dates.length - 1]) : undefined,
  });
}

async function loadPatient(req, id) {
  const patient = await ClinicPatient.findById(id).catch(() => null);
  if (!patient) throw new ApiError(404, 'Patient not found');
  if (req.user.role !== 'admin') {
    const provider = await clinicProvider(req);
    if (!patient.provider.equals(provider._id)) throw new ApiError(404, 'Patient not found');
  }
  return patient;
}

async function loadVisit(req, id) {
  const visit = await ClinicVisit.findById(id).catch(() => null);
  if (!visit) throw new ApiError(404, 'Visit not found');
  if (req.user.role !== 'admin') {
    const provider = await clinicProvider(req);
    if (!visit.provider.equals(provider._id)) throw new ApiError(404, 'Visit not found');
  }
  return visit;
}

// ---------------------------------------------------------------- doctor / nurse / admin

// GET /api/clinic/summary  -> { totalPatients, todayVisits, monthVisits, totalVisits }
export const summary = asyncHandler(async (req, res) => {
  const provider = await clinicProvider(req);
  const today = isoDay(new Date());
  const monthStart = dayStart(`${today.slice(0, 7)}-01`);
  const s = scope(provider);
  const [totalPatients, todayVisits, monthVisits, totalVisits] = await Promise.all([
    ClinicPatient.countDocuments(s),
    ClinicVisit.countDocuments({ ...s, visitDate: { $gte: dayStart(today), $lt: nextDay(today) } }),
    ClinicVisit.countDocuments({ ...s, visitDate: { $gte: monthStart, $lt: nextDay(today) } }),
    ClinicVisit.countDocuments(s),
  ]);
  res.json({ success: true, summary: { totalPatients, todayVisits, monthVisits, totalVisits }, doctor: provider ? { id: provider._id.toString(), name: provider.name, spec: provider.spec } : null });
});

// GET /api/clinic/patients?search=&limit=
export const listPatients = asyncHandler(async (req, res) => {
  const provider = await clinicProvider(req);
  const filter = { ...scope(provider) };
  const q = clean(req.query.search, 60);
  if (q) {
    const rx = new RegExp(escapeRx(q), 'i');
    filter.$or = [{ name: rx }, { phone: new RegExp(escapeRx(q.replace(/\D/g, '') || q)) }, { code: rx }];
  }
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const patients = await ClinicPatient.find(filter).sort({ lastVisitAt: -1, createdAt: -1 }).limit(limit);
  res.json({ success: true, patients });
});

// GET /api/clinic/patients/match?phone=  -> existing patients with this mobile (to avoid duplicates)
export const matchPatients = asyncHandler(async (req, res) => {
  const provider = await clinicProvider(req, { forWrite: true });
  const phone = digits(req.query.phone);
  if (phone.length !== 10) return res.json({ success: true, patients: [] });
  const patients = await ClinicPatient.find({ provider: provider._id, phone }).sort({ lastVisitAt: -1 }).limit(10);
  res.json({ success: true, patients });
});

// GET /api/clinic/patients/:id  -> patient + full visit history (newest first)
export const getPatient = asyncHandler(async (req, res) => {
  const patient = await loadPatient(req, req.params.id);
  const visits = await ClinicVisit.find({ patient: patient._id }).sort({ visitDate: -1 });
  res.json({ success: true, patient, visits });
});

// PUT /api/clinic/patients/:id  { name, age, gender, phone }
export const updatePatient = asyncHandler(async (req, res) => {
  const patient = await loadPatient(req, req.params.id);
  const f = patientFields({ name: patient.name, phone: patient.phone, age: patient.age, gender: patient.gender, ...req.body });
  const clash = await ClinicPatient.findOne({ provider: patient.provider, phone: f.phone, nameKey: f.nameKey, _id: { $ne: patient._id } });
  if (clash) throw new ApiError(409, `${clash.name} (${clash.code}) already has this name and mobile number`);
  Object.assign(patient, f);
  await patient.save();
  if (f.name) await ClinicVisit.updateMany({ patient: patient._id }, { patientName: f.name });
  res.json({ success: true, patient });
});

// POST /api/clinic/visits  { patientId | patient: { name, age, gender, phone }, visitDate, symptoms, diagnosis, treatment, prescription, nurseNotes, allowSameDay }
export const createVisit = asyncHandler(async (req, res) => {
  const provider = await clinicProvider(req, { forWrite: true });
  const b = req.body || {};
  let patient;
  let isNewPatient = false;
  if (b.patientId) {
    patient = await ClinicPatient.findOne({ _id: b.patientId, provider: provider._id }).catch(() => null);
    if (!patient) throw new ApiError(404, 'Patient not found');
    // age / gender may be updated at a new visit
    if (b.patient) {
      const upd = patientFields({ name: patient.name, phone: patient.phone, ...b.patient, name: patient.name, phone: patient.phone });
      if (upd.age !== undefined) patient.age = upd.age;
      if (upd.gender) patient.gender = upd.gender;
      await patient.save();
    }
  } else {
    const f = patientFields(b.patient || {});
    // same mobile + same name for this doctor = the same patient (no duplicate records)
    patient = await ClinicPatient.findOne({ provider: provider._id, phone: f.phone, nameKey: f.nameKey });
    if (patient) {
      if (f.age !== undefined) patient.age = f.age;
      if (f.gender) patient.gender = f.gender;
      await patient.save();
    } else {
      try {
        patient = await ClinicPatient.create({ ...f, provider: provider._id, providerName: provider.name, createdBy: actorOf(req.user) });
        isNewPatient = true;
      } catch (e) {
        if (e.code !== 11000) throw e;
        patient = await ClinicPatient.findOne({ provider: provider._id, phone: f.phone, nameKey: f.nameKey });
      }
    }
  }

  const fields = visitFields({ ...b, visitDate: b.visitDate || isoDay(new Date()) });
  if (!fields.symptoms && !fields.diagnosis && !fields.treatment && !fields.prescription && !fields.nurseNotes) {
    throw new ApiError(400, 'Please enter at least the symptoms, diagnosis, treatment, prescription or notes for this visit');
  }
  // the same patient already has a visit that day -> probably a double entry
  if (!b.allowSameDay) {
    const day = isoDay(fields.visitDate);
    const same = await ClinicVisit.findOne({ patient: patient._id, visitDate: { $gte: dayStart(day), $lt: nextDay(day) } });
    if (same) {
      return res.status(409).json({ success: false, duplicate: true, message: `${patient.name} already has a visit saved for this date. Open it to update, or save this as another visit.`, visit: same, patient });
    }
  }
  const visit = await ClinicVisit.create({
    ...fields,
    provider: provider._id,
    providerName: provider.name,
    patient: patient._id,
    patientName: patient.name,
    enteredBy: actorOf(req.user),
  });
  await refreshPatientStats(patient._id);
  const fresh = await ClinicPatient.findById(patient._id);
  res.status(201).json({ success: true, message: isNewPatient ? `New patient ${fresh.code} added and visit saved` : `Visit saved for ${fresh.name} (${fresh.code})`, visit, patient: fresh, isNewPatient });
});

// PUT /api/clinic/visits/:id
export const updateVisit = asyncHandler(async (req, res) => {
  const visit = await loadVisit(req, req.params.id);
  Object.assign(visit, visitFields(req.body || {}));
  visit.updatedBy = { ...actorOf(req.user), at: new Date() };
  await visit.save();
  await refreshPatientStats(visit.patient);
  res.json({ success: true, message: 'Visit updated', visit });
});

// DELETE /api/clinic/visits/:id  (doctor or admin – e.g. entered for the wrong patient)
export const deleteVisit = asyncHandler(async (req, res) => {
  if (req.user.role === 'nurse') throw new ApiError(403, 'Only the doctor can delete a visit');
  const visit = await loadVisit(req, req.params.id);
  await ClinicVisit.deleteOne({ _id: visit._id });
  await refreshPatientStats(visit.patient);
  res.json({ success: true, message: 'Visit deleted' });
});

// GET /api/clinic/visits?from=&to=&search=  (doctor/nurse: own; admin: all or ?providerId=)
export const listVisits = asyncHandler(async (req, res) => {
  const provider = await clinicProvider(req);
  const filter = { ...scope(provider) };
  const r = dateRange(req.query);
  if (r) filter.visitDate = r;
  const q = clean(req.query.search, 60);
  if (q) {
    const rx = new RegExp(escapeRx(q), 'i');
    const pats = await ClinicPatient.find({ ...scope(provider), $or: [{ name: rx }, { code: rx }, { phone: new RegExp(escapeRx(q.replace(/\D/g, '') || q)) }] }).select('_id');
    filter.$or = [{ patient: { $in: pats.map((p) => p._id) } }, { diagnosis: rx }, { symptoms: rx }, { providerName: rx }];
  }
  const limit = Math.min(Number(req.query.limit) || 500, 5000);
  const visits = await ClinicVisit.find(filter).sort({ visitDate: -1 }).limit(limit).populate('patient', 'code name age gender phone');
  res.json({ success: true, visits });
});

// GET /api/clinic/report?from=&to=   -> daily counts + totals for this doctor (admin: ?providerId=)
export const report = asyncHandler(async (req, res) => {
  const provider = await clinicProvider(req);
  res.json({ success: true, ...(await buildReport(req.query, provider ? [provider] : null)) });
});

// ---------------------------------------------------------------- reports (doctor + admin)

async function buildReport(q, providers) {
  const today = isoDay(new Date());
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? q.from : `${today.slice(0, 7)}-01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? q.to : today;
  const range = { $gte: dayStart(from), $lt: nextDay(to) };
  const provFilter = providers ? { provider: { $in: providers.map((p) => p._id) } } : {};
  const [visits, patients, allProviders] = await Promise.all([
    ClinicVisit.find({ ...provFilter, visitDate: range }).select('provider providerName patient visitDate').lean(),
    ClinicPatient.find(provFilter).select('provider').lean(),
    providers ? Promise.resolve(providers) : Provider.find({ isDoctor: true }).select('name spec status'),
  ]);
  const monthStart = dayStart(`${today.slice(0, 7)}-01`);
  const [todayCounts, monthCounts] = await Promise.all([
    ClinicVisit.aggregate([{ $match: { ...provFilter, visitDate: { $gte: dayStart(today), $lt: nextDay(today) } } }, { $group: { _id: '$provider', n: { $sum: 1 } } }]),
    ClinicVisit.aggregate([{ $match: { ...provFilter, visitDate: { $gte: monthStart, $lt: nextDay(today) } } }, { $group: { _id: '$provider', n: { $sum: 1 } } }]),
  ]);
  const map = (arr) => Object.fromEntries(arr.map((x) => [String(x._id), x.n]));
  const todayMap = map(todayCounts);
  const monthMap = map(monthCounts);

  // daily series across the range
  const daily = {};
  for (let d = dayStart(from); d < nextDay(to); d = new Date(d.getTime() + 86400000)) daily[isoDay(d)] = 0;
  visits.forEach((v) => { const k = isoDay(v.visitDate); if (k in daily) daily[k] += 1; });
  const monthly = {};
  visits.forEach((v) => { const k = isoDay(v.visitDate).slice(0, 7); monthly[k] = (monthly[k] || 0) + 1; });

  // doctors that have records, plus every listed doctor
  const ids = new Set([...allProviders.map((p) => String(p._id)), ...patients.map((p) => String(p.provider)), ...visits.map((v) => String(v.provider))]);
  const names = Object.fromEntries(allProviders.map((p) => [String(p._id), p]));
  const missing = [...ids].filter((id) => !names[id]);
  if (missing.length) (await Provider.find({ _id: { $in: missing } }).select('name spec status')).forEach((p) => { names[String(p._id)] = p; });
  const doctors = [...ids].map((id) => {
    const vs = visits.filter((v) => String(v.provider) === id);
    return {
      providerId: id,
      doctor: names[id]?.name || vs[0]?.providerName || 'Removed doctor',
      spec: names[id]?.spec || '',
      totalPatients: patients.filter((p) => String(p.provider) === id).length,
      visitsInRange: vs.length,
      patientsInRange: new Set(vs.map((v) => String(v.patient))).size,
      todayVisits: todayMap[id] || 0,
      monthVisits: monthMap[id] || 0,
    };
  }).sort((a, b) => b.visitsInRange - a.visitsInRange || b.totalPatients - a.totalPatients || a.doctor.localeCompare(b.doctor));

  return {
    from, to,
    totals: {
      visits: visits.length,
      patients: new Set(visits.map((v) => String(v.patient))).size,
      totalPatients: patients.length,
      todayVisits: Object.values(todayMap).reduce((a, b) => a + b, 0),
      monthVisits: Object.values(monthMap).reduce((a, b) => a + b, 0),
    },
    daily: Object.entries(daily).map(([date, visitsCount]) => ({ date, visits: visitsCount })),
    monthly: Object.entries(monthly).sort().map(([month, n]) => ({ month, visits: n })),
    doctors,
  };
}

// GET /api/admin/clinic/report?from=&to=&providerId=
export const adminReport = asyncHandler(async (req, res) => {
  let providers = null;
  if (req.query.providerId) {
    const p = await Provider.findById(req.query.providerId).catch(() => null);
    if (!p) throw new ApiError(404, 'Doctor not found');
    providers = [p];
  }
  res.json({ success: true, ...(await buildReport(req.query, providers)) });
});

// ---------------------------------------------------------------- clinic staff (nurses)

// GET /api/clinic/staff   (doctor: own nurses; admin: ?providerId=)
export const listStaff = asyncHandler(async (req, res) => {
  if (req.user.role === 'nurse') throw new ApiError(403, 'Not allowed');
  const provider = await clinicProvider(req, { forWrite: true });
  const staff = await User.find({ role: 'nurse', staffOf: provider._id }).sort({ createdAt: -1 });
  res.json({ success: true, staff: staff.map((u) => ({ id: u._id.toString(), name: u.name, phone: u.phone, email: u.email, status: u.status, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt })) });
});

// POST /api/clinic/staff  { name, phone, email?, password }
export const addStaff = asyncHandler(async (req, res) => {
  if (req.user.role === 'nurse') throw new ApiError(403, 'Not allowed');
  const provider = await clinicProvider(req, { forWrite: true });
  const b = req.body || {};
  const name = clean(b.name, 80);
  const phone = digits(b.phone);
  const email = clean(b.email, 120).toLowerCase();
  if (!name) throw new ApiError(400, "Please enter the nurse's name");
  if (!/^[6-9]\d{9}$/.test(phone)) throw new ApiError(400, 'Please enter a valid 10-digit mobile number');
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new ApiError(400, 'Please enter a valid email address');
  if (String(b.password || '').length < 6) throw new ApiError(400, 'Password must be at least 6 characters');
  if (await User.findOne({ phone: { $regex: `${phone}$` } })) throw new ApiError(409, 'An account with this mobile number already exists');
  if (email && (await User.findOne({ email }))) throw new ApiError(409, 'An account with this email already exists');
  const u = await User.create({ name, phone, email: email || undefined, password: String(b.password), role: 'nurse', staffOf: provider._id });
  res.status(201).json({ success: true, message: `${name} can now sign in with ${phone} on the Doctor tab of the login page`, staff: { id: u._id.toString(), name, phone, email: u.email, status: u.status } });
});

// PATCH /api/clinic/staff/:id  { status: 'Active' | 'Inactive' }
export const updateStaff = asyncHandler(async (req, res) => {
  if (req.user.role === 'nurse') throw new ApiError(403, 'Not allowed');
  const provider = await clinicProvider(req, { forWrite: true });
  const u = await User.findOne({ _id: req.params.id, role: 'nurse', staffOf: provider._id }).catch(() => null);
  if (!u) throw new ApiError(404, 'Staff member not found');
  if (!['Active', 'Inactive'].includes(req.body?.status)) throw new ApiError(400, 'Invalid status');
  u.status = req.body.status;
  await u.save();
  res.json({ success: true, message: u.status === 'Active' ? `${u.name} can sign in again` : `${u.name} can no longer sign in`, staff: { id: u._id.toString(), name: u.name, phone: u.phone, status: u.status } });
});

