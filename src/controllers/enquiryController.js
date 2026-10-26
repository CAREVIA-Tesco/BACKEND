import Enquiry, { ENQUIRY_TYPES, ENQUIRY_STATUSES, statusText } from '../models/Enquiry.js';
import Provider from '../models/Provider.js';
import Appointment from '../models/Appointment.js';
import { providerMatches, matchingProviders, scheduleFromEnquiry, OPEN_STATUSES } from '../services/requestFlow.js';
import { ApiError, asyncHandler } from '../middleware/error.js';
import { notifyAdmins, notifyUser, notifyUsers, notifyAppointment, LINKS } from '../services/notify.js';
import { checkSlot } from '../services/slotBooking.js';
import { offersOf } from '../utils/slots.js';
import Payment from '../models/Payment.js';

const digits = (p) => String(p || '').replace(/\D/g, '').slice(-10);
const clean = (v, max = 200) => (v === undefined || v === null ? undefined : String(v).trim().slice(0, max) || undefined);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TYPE_TITLE = { booking: 'New booking request', callback: 'New callback request', plan: 'New care plan enquiry', requirement: 'New requirement posted', contact: 'New contact message', partner: 'New partnership enquiry', referral: 'New referral' };
// a new lead: tell the care team, and for Book Now also the matching professionals
async function notifyNewEnquiry(enquiry) {
  const place = [enquiry.locality, enquiry.city].filter(Boolean).join(', ');
  const when = enquiry.preferredDate ? ` on ${enquiry.toPublic().preferredDateLabel}${enquiry.preferredTime ? `, ${enquiry.preferredTime}` : ''}` : '';
  await notifyAdmins({
    type: 'request',
    title: enquiry.requestedProviderName ? 'New doctor appointment request' : TYPE_TITLE[enquiry.type] || 'New enquiry',
    body: `${enquiry.code}: ${enquiry.name}${enquiry.requestedProviderName ? ` wants ${enquiry.requestedProviderName}` : enquiry.service ? ` – ${enquiry.service}` : ''}${place ? ` in ${place}` : ''}${when}.`,
    link: `/admin/enquiries?q=${enquiry.code}`,
  });
  if (enquiry.broadcast) {
    try {
      const providers = await matchingProviders(enquiry);
      await notifyUsers(providers.map((p) => p.user), {
        type: 'request',
        title: 'New care request near you',
        body: `${enquiry.service || 'Care visit'}${place ? ` in ${place}` : ''}${when}. Accept it before someone else does.`,
        link: LINKS.doctor('Care Requests'),
      });
    } catch (e) { console.warn(`[notify] ${e.message}`); }
  }
}

// POST /api/enquiries  (public; a logged-in patient is linked automatically)
export const createEnquiry = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const type = ENQUIRY_TYPES.includes(b.type) ? b.type : 'callback';
  const name = clean(b.name, 100) || req.user?.name || (type === 'booking' ? 'Website visitor' : undefined);
  const phone = clean(b.phone, 20) || req.user?.phone;
  const email = clean(b.email, 120) || (type === 'contact' || type === 'partner' ? undefined : req.user?.email);

  if (!name) throw new ApiError(400, 'Please enter your name');
  if (digits(phone).length < 10) throw new ApiError(400, 'Please enter a valid 10-digit mobile number');
  if (email && !EMAIL.test(email)) throw new ApiError(400, 'Please enter a valid email address');
  if ((type === 'callback' || type === 'plan' || type === 'requirement' || type === 'referral') && !clean(b.service)) throw new ApiError(400, 'Please choose the service you need');
  if (type === 'contact' && !clean(b.message, 2000)) throw new ApiError(400, 'Please type your message');
  if (type === 'partner' && !clean(b.organisation)) throw new ApiError(400, 'Please enter your organisation name');
  if (type === 'referral') {
    if (!clean(b.referrerName, 100)) throw new ApiError(400, 'Please enter your name');
    if (digits(b.referrerPhone).length < 10) throw new ApiError(400, 'Please enter your 10-digit mobile number');
    if (digits(b.referrerPhone) === digits(phone)) throw new ApiError(400, "Your friend's number must be different from yours");
  }
  if (type === 'booking') {
    if (!clean(b.city, 80)) throw new ApiError(400, 'Please enter the city where you need the service');
    if (!/^[1-9]\d{5}$/.test(String(b.pincode || '').trim())) throw new ApiError(400, 'Please enter a valid 6-digit PIN code');
    if (!b.preferredDate) throw new ApiError(400, 'Please choose a date');
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(b.preferredTime || ''))) throw new ApiError(400, 'Please choose a time');
  }
  if (b.consent === false) throw new ApiError(400, 'Please allow us to contact you about this request');

  let preferredDate;
  if (b.preferredDate) {
    preferredDate = new Date(b.preferredDate);
    if (Number.isNaN(preferredDate.getTime())) throw new ApiError(400, 'Invalid preferred date');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (preferredDate < today) throw new ApiError(400, 'Preferred date cannot be in the past');
    if (type === 'booking') {
      // store the exact requested visit time (local India time) and reject times that have already passed
      const [hh, mm] = String(b.preferredTime).split(':').map(Number);
      const day = String(b.preferredDate).slice(0, 10);
      const at = new Date(`${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+05:30`);
      if (Number.isNaN(at.getTime())) throw new ApiError(400, 'Invalid date or time');
      if (at.getTime() < Date.now() - 15 * 60 * 1000) throw new ApiError(400, 'Please choose a time later than now');
      preferredDate = at;
      b.preferredTime = at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).toUpperCase();
    }
  }

  // "Book" on a doctor's card: the consultation type must be one the doctor offers, and when the doctor has
  // published timings the chosen time must be one of their free slots (it is then booked straight away).
  let requested = null;
  let slotBooking = false;
  if (b.providerId) {
    requested = await Provider.findById(b.providerId).catch(() => null);
    if (!requested || requested.status !== 'ACTIVE') throw new ApiError(404, 'This doctor is not available for booking right now. Please choose another doctor or call us.');
  }
  if (requested && type === 'booking') {
    if (!b.visitType) { const o = offersOf(requested); b.visitType = ['home', 'clinic', 'online'].find((t) => o[t]); }
    const check = await checkSlot(requested, b.visitType, preferredDate);
    if (!check.ok) throw new ApiError(check.status, check.message);
    slotBooking = !check.request;
    if (b.visitType === 'home' && !clean(b.address, 300)) throw new ApiError(400, 'Please enter the house / flat and street address for the home visit');
  }

  // avoid duplicate leads when the same number submits the same request twice in 10 minutes
  const recentList = await Enquiry.find({
    phone: { $regex: `${digits(phone)}$` },
    type,
    service: clean(b.service),
    status: 'New',
    createdAt: { $gte: new Date(Date.now() - 10 * 60 * 1000) },
  });
  // a request for a different doctor is a new request, not a duplicate
  const recent = recentList.find((e) => String(e.requestedProvider || '') === String(b.providerId || '')
    && (!requested || new Date(e.preferredDate).getTime() === new Date(preferredDate).getTime()));
  if (recent) {
    return res.status(200).json({ success: true, duplicate: true, message: `We already have your request ${recent.code}. Our care advisor will call you shortly.`, enquiry: recent.toPublic() });
  }

  // a request naming a doctor is not shared with other professionals

  const enquiry = await Enquiry.create({
    type,
    requestedProvider: requested?._id,
    requestedProviderName: requested?.name,
    requestedProviderSpec: requested?.spec,
    name,
    phone: digits(phone),
    email,
    city: clean(b.city, 80),
    pincode: /^[1-9]\d{5}$/.test(String(b.pincode || '').trim()) ? String(b.pincode).trim() : undefined,
    district: clean(b.district, 80),
    state: clean(b.state, 80),
    locality: clean(b.locality, 120),
    address: clean(b.address, 300),
    visitType: ['home', 'online', 'clinic'].includes(b.visitType) ? b.visitType : undefined,
    service: clean(b.service, 120),
    plan: clean(b.plan, 120),
    subject: clean(b.subject, 120),
    organisation: clean(b.organisation, 150),
    preferredDate,
    preferredTime: clean(b.preferredTime, 60),
    message: clean(b.message, 2000),
    source: clean(b.source, 120),
    referrer: type === 'referral' ? { name: clean(b.referrerName, 100), phone: digits(b.referrerPhone) } : undefined,
    patientUser: req.user?.role === 'patient' ? req.user._id : undefined,
    timeline: [{ status: 'New', note: statusText('New') }],
    broadcast: type === 'booking' && !requested,
    broadcastAt: type === 'booking' && !requested ? new Date() : undefined,
  });

  // a free slot of the doctor was picked: book it now – the appointment shows on the doctor's dashboard
  // (waiting for the doctor to confirm) and in the admin panel, and the slot is no longer offered to others
  let appointment = null;
  if (slotBooking) {
    try {
      appointment = await scheduleFromEnquiry(enquiry, requested, {
        date: undefined, time: undefined, consultationType: b.visitType, status: 'Waiting', assignedBy: 'patient', by: enquiry.name,
      });
      // two patients submitting the same slot at the same moment: the first one keeps it
      const same = await Appointment.find({ provider: requested._id, scheduledAt: appointment.scheduledAt, status: { $in: ['Waiting', 'Confirmed'] } }).sort({ createdAt: 1, _id: 1 });
      if (same.length > 1 && String(same[0]._id) !== String(appointment._id)) {
        await Payment.deleteMany({ appointment: appointment._id });
        await Appointment.deleteOne({ _id: appointment._id });
        await Enquiry.deleteOne({ _id: enquiry._id });
        throw new ApiError(409, 'Sorry, this slot was just booked by another patient. Please choose another time.');
      }
    } catch (err) {
      if (!appointment) await Enquiry.deleteOne({ _id: enquiry._id });
      if (err.statusCode === 409 || err.status === 409) throw new ApiError(409, 'Sorry, this slot was just booked by another patient. Please choose another time.');
      throw err;
    }
  } else {
    await notifyNewEnquiry(enquiry);
  }

  const messages = {
    booking: 'Thank you! Our care advisor will call you shortly to confirm your visit.',
    contact: 'Thanks for writing to us. Our team will get back to you within one working day.',
    partner: 'Thank you for your interest in partnering with Carevaa. Our partnerships team will contact you soon.',
    referral: 'Thank you for the referral! Our care advisor will call your friend and share how Carevaa can help.',
  };
  res.status(201).json({
    success: true,
    message: appointment
      ? `Your slot with ${requested.name} is booked (${appointment.code}). The doctor will confirm it shortly.`
      : messages[type] || 'Request received! A Carevaa care advisor will call you shortly.',
    enquiry: enquiry.toPublic(),
    appointment: appointment ? { code: appointment.code, scheduledAt: appointment.scheduledAt, timeSlot: appointment.timeSlot, consultationType: appointment.consultationType, location: appointment.location } : undefined,
  });
});

// GET /api/enquiries/track?code=ENQ-50101&phone=9876543210  (public – both must match)
export const trackEnquiry = asyncHandler(async (req, res) => {
  const code = String(req.query.code || '').trim().toUpperCase();
  const phone = digits(req.query.phone);
  if (!code || phone.length < 10) throw new ApiError(400, 'Enter your request ID and the mobile number you used');
  const enquiry = await Enquiry.findOne({ code });
  if (!enquiry || digits(enquiry.phone) !== phone) throw new ApiError(404, 'No request found with that ID and mobile number');
  res.json({ success: true, enquiry: enquiry.toPublic() });
});

// GET /api/enquiries/mine  (logged-in patient – linked by account or phone number)
export const myEnquiries = asyncHandler(async (req, res) => {
  const or = [{ patientUser: req.user._id }];
  if (digits(req.user.phone).length === 10) or.push({ phone: { $regex: `${digits(req.user.phone)}$` } });
  const list = await Enquiry.find({ $or: or }).sort({ createdAt: -1 }).limit(100);
  res.json({ success: true, enquiries: list.map((e) => e.toPublic()) });
});

// PATCH /api/enquiries/:id/cancel  (owner – patient account, or code+phone for guests)
export const cancelEnquiry = asyncHandler(async (req, res) => {
  const enquiry = await Enquiry.findById(req.params.id).catch(() => null);
  if (!enquiry) throw new ApiError(404, 'Request not found');
  const ownsByAccount = req.user && enquiry.patientUser && enquiry.patientUser.equals(req.user._id);
  const ownsByPhone = (req.user && digits(req.user.phone).length === 10 && digits(req.user.phone) === digits(enquiry.phone))
    || (req.body?.phone && digits(req.body.phone) === digits(enquiry.phone));
  if (!ownsByAccount && !ownsByPhone && req.user?.role !== 'admin') throw new ApiError(403, 'You cannot cancel this request');
  if (['Converted', 'Closed'].includes(enquiry.status)) throw new ApiError(400, `This request is already ${enquiry.status.toLowerCase()}`);
  enquiry.status = 'Closed';
  enquiry.closedReason = 'Cancelled by customer';
  // a booked slot is released when the customer cancels the request
  if (enquiry.appointment) {
    const appt = await Appointment.findById(enquiry.appointment);
    if (appt && ['Waiting', 'Confirmed'].includes(appt.status)) {
      appt.status = 'Cancelled';
      appt.cancelledBy = 'patient';
      await appt.save();
      await Payment.updateMany({ appointment: appt._id, status: 'Pending' }, { status: 'Failed' });
      await notifyAppointment(appt, 'Cancelled', 'patient');
    }
  }
  notifyAdmins({ type: 'request', title: 'Request cancelled', body: `${enquiry.code}: ${enquiry.name} cancelled their ${enquiry.service || 'care'} request.`, link: `/admin/enquiries?q=${enquiry.code}` });
  enquiry.timeline.push({ status: 'Closed', note: 'You cancelled this request.' });
  await enquiry.save();
  res.json({ success: true, message: 'Request cancelled', enquiry: enquiry.toPublic() });
});

// GET /api/enquiries?status=&type=&q=  (admin)
export const listEnquiries = asyncHandler(async (req, res) => {
  const filter = {};
  if (ENQUIRY_STATUSES.includes(req.query.status)) filter.status = req.query.status;
  if (ENQUIRY_TYPES.includes(req.query.type)) filter.type = req.query.type;
  let list = await Enquiry.find(filter).sort({ createdAt: -1 }).limit(1000);
  if (req.query.q) {
    const q = String(req.query.q).toLowerCase();
    list = list.filter((e) => [e.code, e.name, e.phone, e.email, e.city, e.pincode, e.district, e.locality, e.service, e.organisation, e.referrer?.name, e.referrer?.phone].join(' ').toLowerCase().includes(q));
  }
  const all = await Enquiry.find().select('status type createdAt').lean();
  const counts = Object.fromEntries(ENQUIRY_STATUSES.map((s) => [s, all.filter((e) => e.status === s).length]));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  res.json({ success: true, enquiries: list, counts: { ...counts, total: all.length, today: all.filter((e) => e.createdAt >= today).length } });
});

// GET /api/enquiries/:id  (admin)
export const getEnquiry = asyncHandler(async (req, res) => {
  const enquiry = await Enquiry.findById(req.params.id).catch(() => null);
  if (!enquiry) throw new ApiError(404, 'Request not found');
  res.json({ success: true, enquiry });
});

// PATCH /api/enquiries/:id  { status, note, publicNote, providerId, appointmentCode, followUpAt, closedReason }  (admin)
export const updateEnquiry = asyncHandler(async (req, res) => {
  const enquiry = await Enquiry.findById(req.params.id).catch(() => null);
  if (!enquiry) throw new ApiError(404, 'Request not found');
  const b = req.body || {};
  const by = req.user?.name || 'Admin';

  if (b.providerId !== undefined) {
    if (!b.providerId) {
      enquiry.provider = undefined;
      enquiry.providerName = undefined;
    } else {
      const provider = await Provider.findById(b.providerId).catch(() => null);
      if (!provider) throw new ApiError(404, 'Provider not found');
      enquiry.provider = provider._id;
      enquiry.providerName = provider.name;
      enquiry.notes.push({ text: `Assigned to ${provider.name}`, by });
    }
  }

  if (b.appointmentCode !== undefined) {
    const code = String(b.appointmentCode || '').trim().toUpperCase();
    if (code) {
      const appt = await Appointment.findOne({ code });
      if (!appt) throw new ApiError(404, `No appointment found with ID ${code}`);
      enquiry.appointment = appt._id;
      enquiry.appointmentCode = appt.code;
      if (!b.status && !['Converted', 'Closed'].includes(enquiry.status)) b.status = 'Converted';
    } else {
      enquiry.appointment = undefined;
      enquiry.appointmentCode = undefined;
    }
  }

  if (b.followUpAt !== undefined) enquiry.followUpAt = b.followUpAt ? new Date(b.followUpAt) : undefined;

  if (b.status && b.status !== enquiry.status) {
    if (!ENQUIRY_STATUSES.includes(b.status)) throw new ApiError(400, 'Invalid status');
    enquiry.status = b.status;
    if (b.status === 'Closed') enquiry.closedReason = clean(b.closedReason, 200) || enquiry.closedReason || 'Closed by Carevaa';
    const extra = b.status === 'Converted' && enquiry.appointmentCode ? ` Appointment ID: ${enquiry.appointmentCode}.` : '';
    enquiry.timeline.push({ status: b.status, note: (clean(b.publicNote, 300) || statusText(b.status)) + extra });
  } else if (clean(b.publicNote, 300)) {
    enquiry.timeline.push({ status: enquiry.status, note: clean(b.publicNote, 300) });
  }

  if (clean(b.note, 1000)) enquiry.notes.push({ text: clean(b.note, 1000), by });

  await enquiry.save();
  // the customer sees a new line on their request -> tell them too
  const latest = enquiry.timeline[enquiry.timeline.length - 1];
  if (enquiry.patientUser && latest && Date.now() - new Date(latest.at).getTime() < 5000 && (b.status || clean(b.publicNote, 300))) {
    await notifyUser(enquiry.patientUser, { type: 'request', title: `Request ${enquiry.code}: ${enquiry.status}`, body: latest.note, link: LINKS.patient('Requests') });
  }
  res.json({ success: true, enquiry });
});

// ---- Routing requests to professionals -------------------------------------------------

const firstName = (n) => String(n || '').split(' ')[0] || 'Patient';
// what a professional sees before accepting (no phone / email / full name)
const openView = (e) => ({
  id: e._id.toString(),
  code: e.code,
  patient: firstName(e.name),
  city: e.city,
  pincode: e.pincode,
  locality: e.locality,
  district: e.district,
  visitType: e.visitType || 'home',
  service: e.service || 'General care',
  plan: e.plan,
  message: e.message,
  preferredDate: e.preferredDate,
  preferredDateLabel: e.toPublic().preferredDateLabel,
  preferredTime: e.preferredTime,
  requestedAt: e.createdAt,
});

async function myProvider(user) {
  const provider = await Provider.findOne({ user: user._id });
  if (!provider) throw new ApiError(400, 'Complete your professional profile first');
  if (provider.status !== 'ACTIVE') throw new ApiError(403, 'Your profile is not active yet');
  return provider;
}

// GET /api/enquiries/open  (professional) – open requests that match my service and city
export const openRequests = asyncHandler(async (req, res) => {
  const provider = await myProvider(req.user);
  const list = await Enquiry.find({ broadcast: true, status: { $in: OPEN_STATUSES } }).sort({ createdAt: -1 }).limit(200);
  const mine = list.filter((e) => !e.appointment && !(e.declinedBy || []).some((id) => id.equals(provider._id)) && providerMatches(e, provider));
  res.json({ success: true, requests: mine.map(openView) });
});

// POST /api/enquiries/:id/accept  { consultationType }  (professional) – first to accept gets the visit
export const acceptRequest = asyncHandler(async (req, res) => {
  const provider = await myProvider(req.user);
  const enquiry = await Enquiry.findById(req.params.id).catch(() => null);
  if (!enquiry || !enquiry.broadcast || !OPEN_STATUSES.includes(enquiry.status) || enquiry.appointment) {
    throw new ApiError(409, 'This request has already been taken or is no longer open');
  }
  if (!providerMatches(enquiry, provider)) throw new ApiError(403, 'This request is for a different service or city');
  const appointment = await scheduleFromEnquiry(enquiry, provider, {
    date: req.body?.date, time: req.body?.time, consultationType: req.body?.consultationType || enquiry.visitType || 'home', status: 'Confirmed', assignedBy: 'provider', by: provider.name,
  });
  res.status(201).json({ success: true, message: `Accepted – appointment ${appointment.code} added to your schedule`, appointment });
});

// POST /api/enquiries/:id/decline  (professional) – hide it from me
export const declineRequest = asyncHandler(async (req, res) => {
  const provider = await myProvider(req.user);
  const enquiry = await Enquiry.findById(req.params.id).catch(() => null);
  if (!enquiry) throw new ApiError(404, 'Request not found');
  if (!(enquiry.declinedBy || []).some((id) => id.equals(provider._id))) {
    enquiry.declinedBy.push(provider._id);
    enquiry.notes.push({ text: `${provider.name} passed on this request`, by: provider.name });
    await enquiry.save();
  }
  res.json({ success: true, message: 'Request hidden' });
});

// GET /api/enquiries/:id/matches  (admin) – professionals who fit the request
export const requestMatches = asyncHandler(async (req, res) => {
  const enquiry = await Enquiry.findById(req.params.id).catch(() => null);
  if (!enquiry) throw new ApiError(404, 'Request not found');
  const providers = await matchingProviders(enquiry);
  const declined = (enquiry.declinedBy || []).map(String);
  res.json({ success: true, providers: providers.map((p) => ({ id: p._id.toString(), name: p.name, spec: p.spec, city: p.city, fee: p.fee || p.clinicFee || p.onlineFee || 0, declined: declined.includes(p._id.toString()) })) });
});

// POST /api/enquiries/:id/assign  { providerId, date, time, consultationType }  (admin)
export const assignRequest = asyncHandler(async (req, res) => {
  const enquiry = await Enquiry.findById(req.params.id).catch(() => null);
  if (!enquiry) throw new ApiError(404, 'Request not found');
  const provider = await Provider.findById(req.body?.providerId).catch(() => null);
  if (!provider || provider.status !== 'ACTIVE') throw new ApiError(404, 'Choose an active professional');
  const appointment = await scheduleFromEnquiry(enquiry, provider, {
    date: req.body.date, time: req.body.time, consultationType: req.body.consultationType || enquiry.visitType, status: 'Waiting', assignedBy: 'admin', by: req.user?.name || 'Admin',
  });
  res.status(201).json({ success: true, message: `Sent to ${provider.name} – appointment ${appointment.code}`, appointment, enquiry });
});

// POST /api/enquiries/:id/broadcast  { on }  (admin) – share with / withdraw from all matching professionals
export const broadcastRequest = asyncHandler(async (req, res) => {
  const enquiry = await Enquiry.findById(req.params.id).catch(() => null);
  if (!enquiry) throw new ApiError(404, 'Request not found');
  const on = req.body?.on !== false;
  if (on && (!OPEN_STATUSES.includes(enquiry.status) || enquiry.appointment)) throw new ApiError(400, 'Only open requests without an appointment can be shared');
  enquiry.broadcast = on;
  if (on) enquiry.broadcastAt = new Date();
  enquiry.notes.push({ text: on ? 'Shared with all matching professionals' : 'Withdrawn from professionals', by: req.user?.name || 'Admin' });
  await enquiry.save();
  const matches = on ? (await matchingProviders(enquiry)).length : 0;
  res.json({ success: true, enquiry, matches });
});
