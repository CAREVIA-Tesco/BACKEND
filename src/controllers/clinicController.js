import crypto from 'crypto';
import { ClinicPatient, ClinicVisit, ClinicRegistrationLink } from '../models/ClinicRecord.js';
import Provider from '../models/Provider.js';
import { ApiError, asyncHandler } from '../middleware/error.js';
import { notifyProvider, notifyAdmins } from '../services/notify.js';

// Patient Visit Management (walk-in clinic visits).
//  - doctor: their own patients and visits. A nurse works on the doctor's dashboard and adds her
//            name to each visit she enters ("Entered by"), so the admin can see who recorded it.
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
  ['symptoms', 'diagnosis', 'treatment', 'nurseNotes', 'medicalHistory', 'allergies', 'currentMedications'].forEach((k) => { if (b[k] !== undefined) f[k] = clean(b[k]); });
  if (b.prescription !== undefined) f.prescription = clean(b.prescription, 3000);
  if (b.recordedBy !== undefined) f.recordedBy = clean(b.recordedBy, 80);
  if (b.source !== undefined) f.source = b.source;
  if (b.link !== undefined) f.link = b.link;
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
  if (p.email !== undefined && p.email !== '') out.email = clean(p.email, 120).toLowerCase();
  if (p.address !== undefined && p.address !== '') out.address = clean(p.address, 300);
  if (p.city !== undefined && p.city !== '') out.city = clean(p.city, 100);
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
    const num = parseInt(q.replace(/\D/g, ''), 10);
    const padded = !Number.isNaN(num) ? String(num).padStart(3, '0') : null;

    const visitOr = [
      { appointmentNumber: rx },
      { code: rx },
    ];
    if (padded) {
      visitOr.push({ appointmentNumber: padded });
      visitOr.push({ code: padded });
    }
    if (!Number.isNaN(num)) {
      visitOr.push({ dailySequence: num });
    }

    const matchingVisits = await ClinicVisit.find({
      ...scope(provider),
      $or: visitOr,
    }).select('patient').lean();
    const patientIdsFromVisits = matchingVisits.map((v) => v.patient).filter(Boolean);

    filter.$or = [
      { name: rx },
      { phone: new RegExp(escapeRx(q.replace(/\D/g, '') || q)) },
      { code: rx },
      ...(patientIdsFromVisits.length ? [{ _id: { $in: patientIdsFromVisits } }] : []),
    ];
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
  const appointmentDate = isoDay(fields.visitDate);
  const visit = await ClinicVisit.create({
    ...fields,
    appointmentDate,
    provider: provider._id,
    providerName: provider.name,
    patient: patient._id,
    patientName: patient.name,
    enteredBy: actorOf(req.user),
  });
  await refreshPatientStats(patient._id);
  const fresh = await ClinicPatient.findById(patient._id);
  res.status(201).json({
    success: true,
    message: isNewPatient
      ? `New patient ${fresh.code} added. Appointment No. ${visit.appointmentNumber || visit.code}`
      : `Visit saved for ${fresh.name}. Appointment No. ${visit.appointmentNumber || visit.code}`,
    appointmentNumber: visit.appointmentNumber || visit.code,
    dailySequence: visit.dailySequence,
    appointmentDate: visit.appointmentDate,
    visit,
    patient: fresh,
    isNewPatient,
  });
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
  const visit = await loadVisit(req, req.params.id);
  await ClinicVisit.deleteOne({ _id: visit._id });
  await refreshPatientStats(visit.patient);
  res.json({ success: true, message: 'Visit deleted' });
});

// GET /api/clinic/visits?from=&to=&date=&search=  (doctor/nurse: own; admin: all or ?providerId=)
export const listVisits = asyncHandler(async (req, res) => {
  const provider = await clinicProvider(req);
  const filter = { ...scope(provider) };

  if (req.query.date) {
    const single = String(req.query.date).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(single)) {
      filter.visitDate = { $gte: dayStart(single), $lt: nextDay(single) };
    }
  } else {
    const r = dateRange(req.query);
    if (r) filter.visitDate = r;
  }

  const q = clean(req.query.search, 60);
  if (q) {
    const rx = new RegExp(escapeRx(q), 'i');
    const pats = await ClinicPatient.find({ ...scope(provider), $or: [{ name: rx }, { code: rx }, { phone: new RegExp(escapeRx(q.replace(/\D/g, '') || q)) }] }).select('_id');
    const num = parseInt(q.replace(/\D/g, ''), 10);
    const padded = !Number.isNaN(num) ? String(num).padStart(3, '0') : null;

    const orClauses = [
      { patient: { $in: pats.map((p) => p._id) } },
      { patientName: rx },
      { diagnosis: rx },
      { symptoms: rx },
      { providerName: rx },
      { appointmentNumber: rx },
      { code: rx },
    ];
    if (padded) {
      orClauses.push({ appointmentNumber: padded });
      orClauses.push({ code: padded });
    }
    if (!Number.isNaN(num)) {
      orClauses.push({ dailySequence: num });
    }
    filter.$or = orClauses;
  }
  const limit = Math.min(Number(req.query.limit) || 500, 5000);
  const visits = await ClinicVisit.find(filter).sort({ visitDate: -1, createdAt: -1 }).limit(limit).populate('patient', 'code name age gender phone');
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

  // daily series across the range with visits and unique patients count
  const daily = {};
  for (let d = dayStart(from); d < nextDay(to); d = new Date(d.getTime() + 86400000)) {
    daily[isoDay(d)] = { visits: 0, patients: new Set() };
  }
  visits.forEach((v) => {
    const k = isoDay(v.visitDate);
    if (k in daily) {
      daily[k].visits += 1;
      if (v.patient) daily[k].patients.add(String(v.patient));
    }
  });
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
    daily: Object.entries(daily).map(([date, d]) => ({ date, visits: d.visits, patients: d.patients?.size || 0 })),
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

// ---------------------------------------------------------------- shared registration links

// POST /api/clinic/registration-links
// Nurse or doctor generates a unique registration link to share with a walk-in or prospective patient.
export const createRegistrationLink = asyncHandler(async (req, res) => {
  const provider = await clinicProvider(req, { forWrite: true });
  const b = req.body || {};
  const token = crypto.randomBytes(24).toString('hex');
  const recordedBy = clean(b.recordedBy, 80);
  const patientName = clean(b.patientName, 100);
  const patientPhone = b.patientPhone ? digits(b.patientPhone) : '';
  const notes = clean(b.notes, 1000);

  const link = await ClinicRegistrationLink.create({
    token,
    provider: provider._id,
    providerName: provider.name,
    doctorSpecialization: provider.spec || '',
    clinicName: provider.clinic?.name || '',
    patientName,
    patientPhone,
    notes,
    recordedBy,
    createdBy: actorOf(req.user),
  });

  res.status(201).json({
    success: true,
    message: 'Patient registration link generated successfully',
    link,
    url: `/register-patient/${token}`,
  });
});

// GET /api/clinic/registration-links?status=&search=
// Doctor/nurse sees their own links; admin sees all (or ?providerId=).
export const listRegistrationLinks = asyncHandler(async (req, res) => {
  const provider = await clinicProvider(req);
  const filter = { ...scope(provider) };

  if (req.query.status && req.query.status !== 'all') {
    filter.status = req.query.status;
  }

  const q = clean(req.query.search, 60);
  if (q) {
    const rx = new RegExp(escapeRx(q), 'i');
    filter.$or = [
      { patientName: rx },
      { code: rx },
      { appointmentNumber: rx },
      { patientPhone: new RegExp(escapeRx(q.replace(/\D/g, '') || q)) },
      { recordedBy: rx },
      { notes: rx },
    ];
  }

  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const links = await ClinicRegistrationLink.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('patient', 'code name age gender phone')
    .populate('visit', 'visitDate symptoms diagnosis prescription nurseNotes');

  res.json({ success: true, links });
});

// GET /api/clinic/registration-links/:id
export const getRegistrationLink = asyncHandler(async (req, res) => {
  const link = await ClinicRegistrationLink.findById(req.params.id)
    .populate('patient')
    .populate('visit');
  if (!link) throw new ApiError(404, 'Registration link not found');
  if (req.user.role !== 'admin') {
    const provider = await clinicProvider(req);
    if (!link.provider.equals(provider._id)) throw new ApiError(404, 'Registration link not found');
  }
  res.json({ success: true, link });
});

// DELETE /api/clinic/registration-links/:id
export const cancelRegistrationLink = asyncHandler(async (req, res) => {
  const link = await ClinicRegistrationLink.findById(req.params.id);
  if (!link) throw new ApiError(404, 'Registration link not found');
  if (req.user.role !== 'admin') {
    const provider = await clinicProvider(req);
    if (!link.provider.equals(provider._id)) throw new ApiError(404, 'Registration link not found');
  }
  if (link.status === 'Submitted') {
    throw new ApiError(400, 'Cannot cancel a registration link that has already been submitted');
  }
  link.status = 'Cancelled';
  await link.save();
  res.json({ success: true, message: 'Registration link cancelled' });
});

// GET /api/clinic/public/register/:token (Public - patient opens the shared link on their phone)
export const getPublicRegistrationLink = asyncHandler(async (req, res) => {
  const token = String(req.params.token || '').trim();
  if (!token || token.length < 16) throw new ApiError(400, 'Invalid registration link');

  const link = await ClinicRegistrationLink.findOne({ token }).populate('provider', 'name spec clinic image location address phone experience');
  if (!link) throw new ApiError(404, 'Registration link not found or invalid');

  // Check expiration
  if (link.expiresAt && link.expiresAt.getTime() < Date.now() && link.status === 'Pending') {
    link.status = 'Expired';
    await link.save();
  }

  const provider = link.provider || {};
  const clinicInfo = {
    doctorName: provider.name || link.providerName,
    specialization: provider.spec || link.doctorSpecialization || 'Specialist',
    clinicName: provider.clinic?.name || link.clinicName || 'Clinic Desk',
    clinicAddress: provider.clinic?.address || provider.address || '',
    clinicPhone: provider.clinic?.phone || provider.phone || '',
    doctorImage: provider.image || '',
    experience: provider.experience ? `${provider.experience} Years Experience` : '',
  };

  if (link.status === 'Submitted') {
    return res.json({
      success: true,
      status: 'Submitted',
      submittedAt: link.submittedAt,
      clinic: clinicInfo,
      patientName: link.patientName || '',
      message: 'This registration link has already been submitted. Your details have been received by the clinic team.',
    });
  }

  if (link.status === 'Expired') {
    return res.json({
      success: true,
      status: 'Expired',
      clinic: clinicInfo,
      message: 'This registration link has expired. Please ask the clinic nurse for a new link.',
    });
  }

  if (link.status === 'Cancelled') {
    return res.json({
      success: true,
      status: 'Cancelled',
      clinic: clinicInfo,
      message: 'This registration link is no longer valid.',
    });
  }

  // Pending
  res.json({
    success: true,
    status: 'Pending',
    clinic: clinicInfo,
    prefill: {
      name: link.patientName || '',
      patientName: link.patientName || '',
      phone: link.patientPhone || '',
      patientPhone: link.patientPhone || '',
      notes: link.notes || '',
    },
  });
});

// POST /api/clinic/public/register/:token (Public - patient submits their registration form)
export const submitPublicRegistration = asyncHandler(async (req, res) => {
  const token = String(req.params.token || '').trim();
  if (!token || token.length < 16) throw new ApiError(400, 'Invalid registration token');

  // Find link and check status
  const link = await ClinicRegistrationLink.findOne({ token });
  if (!link) throw new ApiError(404, 'Registration link not found or invalid');

  // Duplicate submission prevention
  if (link.status === 'Submitted') {
    throw new ApiError(409, 'This registration link has already been submitted. Duplicate submissions are not permitted.');
  }
  if (link.status === 'Expired' || (link.expiresAt && link.expiresAt.getTime() < Date.now())) {
    link.status = 'Expired';
    await link.save();
    throw new ApiError(410, 'This registration link has expired. Please ask the clinic nurse for a fresh link.');
  }
  if (link.status === 'Cancelled') {
    throw new ApiError(410, 'This registration link is no longer valid.');
  }

  const provider = await Provider.findById(link.provider);
  if (!provider) throw new ApiError(404, 'Associated doctor profile not found');

  const b = req.body || {};

  // Validate required patient details
  const name = clean(b.name, 100);
  const phone = digits(b.phone);
  if (!name || name.length < 2) throw new ApiError(400, 'Please enter your full name (at least 2 characters)');
  if (!/^[6-9]\d{9}$/.test(phone)) throw new ApiError(400, 'Please enter a valid 10-digit mobile number');

  const age = Number(b.age);
  if (b.age === undefined || b.age === '' || b.age === null || !Number.isInteger(age) || age < 0 || age > 120) {
    throw new ApiError(400, 'Please enter a valid age in years (0–120)');
  }

  const gender = String(b.gender || '').trim();
  if (!['Male', 'Female', 'Other'].includes(gender)) {
    throw new ApiError(400, 'Please select your gender (Male, Female, or Other)');
  }

  // Validate visit symptoms / reason for visit
  const chiefComplaint = clean(b.symptoms || b.chiefComplaint, 2000);
  if (!chiefComplaint || chiefComplaint.length < 3) {
    throw new ApiError(400, 'Please describe your symptoms or reason for visit');
  }

  const email = clean(b.email, 120).toLowerCase();
  const address = clean(b.address, 300);
  const city = clean(b.city, 100);
  const medicalHistory = clean(b.medicalHistory, 1000);
  const currentMedications = clean(b.currentMedications, 1000);
  const allergies = clean(b.allergies, 1000);
  const patientNotes = clean(b.notes, 1000);

  const visitDateStr = b.visitDate || isoDay(new Date());
  const visitDate = /^\d{4}-\d{2}-\d{2}$/.test(String(visitDateStr))
    ? new Date(`${visitDateStr}T${new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(11, 19)}${TZ}`)
    : new Date();

  // Deduplication: Look for existing ClinicPatient for this doctor with same phone + nameKey
  const nKey = nameKey(name);
  let patient = await ClinicPatient.findOne({ provider: provider._id, phone, nameKey: nKey });
  let isNewPatient = false;

  if (patient) {
    patient.age = age;
    patient.gender = gender;
    if (email) patient.email = email;
    if (address) patient.address = address;
    if (city) patient.city = city;
    await patient.save();
  } else {
    try {
      patient = await ClinicPatient.create({
        provider: provider._id,
        providerName: provider.name,
        name,
        nameKey: nKey,
        phone,
        age,
        gender,
        email,
        address,
        city,
        createdBy: { name: link.recordedBy ? `${link.recordedBy} (Shared Link)` : 'Online Registration', role: 'patient' },
      });
      isNewPatient = true;
    } catch (e) {
      if (e.code === 11000) {
        patient = await ClinicPatient.findOne({ provider: provider._id, phone, nameKey: nKey });
      } else {
        throw e;
      }
    }
  }

  // Compile detailed visit symptoms
  const symptomParts = [chiefComplaint];
  if (medicalHistory) symptomParts.push(`Past Medical History: ${medicalHistory}`);
  if (currentMedications) symptomParts.push(`Current Medications: ${currentMedications}`);
  if (allergies) symptomParts.push(`Known Allergies: ${allergies}`);
  const compiledSymptoms = symptomParts.join('\n');

  const nurseNotesParts = [];
  if (patientNotes) nurseNotesParts.push(`Patient note: ${patientNotes}`);
  nurseNotesParts.push(`[Online Registration via link ${link.code}]`);
  if (link.recordedBy) nurseNotesParts.push(`Link generated by: ${link.recordedBy}`);

  const appointmentDate = isoDay(visitDate);

  // Create ClinicVisit
  const visit = await ClinicVisit.create({
    provider: provider._id,
    providerName: provider.name,
    patient: patient._id,
    patientName: patient.name,
    visitDate,
    appointmentDate,
    symptoms: compiledSymptoms,
    nurseNotes: nurseNotesParts.join(' | '),
    recordedBy: link.recordedBy ? `${link.recordedBy} (Shared Link)` : 'Online Registration',
    enteredBy: { name: `${patient.name} (Online Self-Registration)`, role: 'patient' },
    source: 'shared_link',
    link: link._id,
    medicalHistory,
    allergies,
    currentMedications,
  });

  await refreshPatientStats(patient._id);

  // Atomically update link status
  link.status = 'Submitted';
  link.submittedAt = new Date();
  link.patient = patient._id;
  link.patientName = patient.name;
  link.patientPhone = patient.phone;
  link.visit = visit._id;
  link.appointmentNumber = visit.appointmentNumber || visit.code;
  link.dailySequence = visit.dailySequence;
  link.appointmentDate = visit.appointmentDate;
  await link.save();

  // Notify doctor & admin
  await notifyProvider(provider._id, {
    type: 'clinic',
    title: 'New patient registered online',
    body: `${patient.name} (${patient.code}) submitted clinic registration form. Appointment No. ${visit.appointmentNumber || visit.code}`,
    link: '/doctor/dashboard?tab=Patient%20Visits',
  });
  await notifyAdmins({
    type: 'clinic',
    title: 'Online patient registration received',
    body: `${patient.name} registered online for Dr. ${provider.name} (Appointment No. ${visit.appointmentNumber || visit.code}).`,
    link: '/admin/clinic-records',
  });

  res.status(201).json({
    success: true,
    message: `Registration Successful! Your Appointment Number is ${visit.appointmentNumber || visit.code}.`,
    appointmentNumber: visit.appointmentNumber || visit.code,
    dailySequence: visit.dailySequence,
    appointmentDate: visit.appointmentDate,
    patient: {
      id: patient._id.toString(),
      code: patient.code,
      name: patient.name,
      phone: patient.phone,
      age: patient.age,
      gender: patient.gender,
      email: patient.email || '',
    },
    visit: {
      id: visit._id.toString(),
      appointmentNumber: visit.appointmentNumber || visit.code,
      code: visit.code || visit.appointmentNumber,
      dailySequence: visit.dailySequence,
      appointmentDate: visit.appointmentDate,
      visitDate: visit.visitDate,
      source: visit.source,
    },
    doctor: {
      name: provider.name,
      spec: provider.spec,
      clinic: provider.clinic?.name || '',
    },
    isNewPatient,
  });
});

