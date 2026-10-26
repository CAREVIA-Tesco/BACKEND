import User from '../models/User.js';
import Appointment from '../models/Appointment.js';
import Provider from '../models/Provider.js';
import Payment from '../models/Payment.js';
import { ApiError, asyncHandler } from '../middleware/error.js';
import { feeFor } from '../utils/format.js';
import { syncEnquiryFromAppointment } from '../services/requestFlow.js';
import { notifyAppointment } from '../services/notify.js';
import { slotToMin, minTo12, istDay, atIST } from '../utils/slots.js';

const TITLES = { online: 'Online Consultation', clinic: 'Clinic Consultation', home: 'Home Consultation' };
const LOCATIONS = { online: 'Virtual', clinic: 'Main Clinic', home: 'Patient Home' };
const ACTIVE = ['Waiting', 'Confirmed'];

// A professional sees the patient's phone number only once they have confirmed the booking
function forViewer(appt, user) {
  const j = appt.toJSON();
  if (user?.role === 'doctor' && appt.status === 'Waiting') { j.phone = null; j.phoneHidden = true; }
  return j;
}

// "09:00 AM" + date -> that time in India (the server may run in UTC)
function combine(dateInput, timeSlot) {
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) throw new ApiError(400, 'Invalid appointment date');
  const min = slotToMin(timeSlot);
  if (min === null) return d;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(dateInput)) ? String(dateInput) : istDay(d);
  return atIST(day, minTo12(min));
}

// "Thu, May 22" (reschedule picker) or ISO string -> Date
function parseLooseDate(value) {
  if (!value) return null;
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime()) && /\d{4}/.test(String(value))) return direct;
  const now = new Date();
  const withYear = new Date(`${String(value).replace(/^[A-Za-z]{3},\s*/, '')} ${now.getFullYear()}`);
  if (Number.isNaN(withYear.getTime())) return null;
  if (withYear < new Date(now.getFullYear(), now.getMonth(), now.getDate())) withYear.setFullYear(now.getFullYear() + 1);
  return withYear;
}

async function scopedFilter(user) {
  if (user.role === 'admin') return {};
  if (user.role === 'doctor') {
    const provider = await Provider.findOne({ user: user._id }).select('_id');
    return { provider: provider ? provider._id : null };
  }
  return { patientUser: user._id };
}

async function loadForUser(id, user) {
  const appt = await Appointment.findById(id).populate('provider', 'img user');
  if (!appt) throw new ApiError(404, 'Appointment not found');
  if (user.role === 'admin') return appt;
  if (user.role === 'doctor' && appt.provider?.user?.equals(user._id)) return appt;
  if (user.role === 'patient' && appt.patientUser?.equals(user._id)) return appt;
  throw new ApiError(403, 'You cannot access this appointment');
}

// GET /api/appointments?status=&scope=upcoming|past&search=
export const listAppointments = asyncHandler(async (req, res) => {
  const filter = await scopedFilter(req.user);
  const { status, scope, search, providerId, patientId } = req.query;
  if (status) filter.status = status;
  if (scope === 'upcoming') filter.status = { $in: ACTIVE };
  if (scope === 'past') filter.status = { $in: ['Completed', 'Cancelled'] };
  if (req.user.role === 'admin') {
    if (providerId) filter.provider = providerId;
    if (patientId) filter.patientUser = patientId;
  }
  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ patientName: rx }, { providerName: rx }, { code: rx }, { providerSpec: rx }];
  }
  const sort = scope === 'past' ? { scheduledAt: -1 } : scope === 'upcoming' ? { scheduledAt: 1 } : { createdAt: -1 };
  const appointments = await Appointment.find(filter).populate('provider', 'img').sort(sort).limit(500);
  res.json({ success: true, count: appointments.length, appointments: appointments.map((a) => forViewer(a, req.user)) });
});

// GET /api/appointments/:id
export const getAppointment = asyncHandler(async (req, res) => {
  const appointment = await loadForUser(req.params.id, req.user);
  res.json({ success: true, appointment: forViewer(appointment, req.user) });
});

// POST /api/appointments   (booking flow – guests allowed, logged-in patients are linked)
export const createAppointment = asyncHandler(async (req, res) => {
  const { providerId, date, time, duration, consultationType = 'online', serviceType, paymentMethod, patientInfo = {} } = req.body;
  if (!providerId) throw new ApiError(400, 'Please select a professional');
  if (!date || !time) throw new ApiError(400, 'Please select a date and time slot');
  if (!['online', 'clinic', 'home'].includes(consultationType)) throw new ApiError(400, 'Invalid consultation type');

  const provider = await Provider.findById(providerId);
  if (!provider || provider.status !== 'ACTIVE') throw new ApiError(404, 'This professional is not available for booking');

  const scheduledAt = combine(date, time);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (scheduledAt < today) throw new ApiError(400, 'Appointment date cannot be in the past');

  const clash = await Appointment.findOne({ provider: provider._id, scheduledAt, status: { $in: ACTIVE } });
  if (clash) throw new ApiError(409, 'This time slot was just booked. Please choose another slot.');

  const isDoctorCategory = !serviceType || serviceType === 'home-doctor';
  const fee = feeFor(provider, consultationType, isDoctorCategory);
  let patient = req.user && req.user.role === 'patient' ? req.user : null;
  // admin booking on behalf of a registered patient (phone bookings)
  if (req.user?.role === 'admin' && req.body.patientId) {
    patient = await User.findOne({ _id: req.body.patientId, role: 'patient' });
    if (!patient) throw new ApiError(404, 'Patient not found');
  }
  if (!patient && !patientInfo.name && req.user?.role === 'admin') throw new ApiError(400, 'Please choose a patient or enter the patient name');
  const paidOnline = consultationType === 'online';

  const appointment = await Appointment.create({
    patientUser: patient?._id,
    patientName: patientInfo.name || patient?.name || (req.user?.role === 'patient' ? req.user.name : '') || 'Guest Patient',
    patientPhone: patientInfo.phone || patient?.phone,
    patientEmail: patientInfo.email || patient?.email,
    reason: patientInfo.reason,
    provider: provider._id,
    providerName: provider.name,
    providerSpec: provider.spec,
    scheduledAt,
    timeSlot: time,
    duration: duration || undefined,
    consultationType,
    serviceType,
    title: TITLES[consultationType],
    location: LOCATIONS[consultationType],
    fee,
    status: 'Waiting',
    paymentStatus: paidOnline ? 'Paid' : 'Pending',
    paymentMethod: paidOnline ? paymentMethod || 'upi' : 'cash',
  });

  await Payment.create({
    appointment: appointment._id,
    appointmentCode: appointment.code,
    patientUser: patient?._id,
    patientName: appointment.patientName,
    provider: provider._id,
    providerName: provider.name,
    amount: fee,
    method: appointment.paymentMethod,
    status: paidOnline ? 'Success' : 'Pending',
    paidAt: paidOnline ? new Date() : undefined,
  });

  await notifyAppointment(appointment, 'Booked', req.user?.role || 'guest');
  await appointment.populate('provider', 'img');
  res.status(201).json({ success: true, message: 'Appointment booked successfully', appointment });
});

// PATCH /api/appointments/:id/reschedule  { date, time }
export const rescheduleAppointment = asyncHandler(async (req, res) => {
  const appt = await loadForUser(req.params.id, req.user);
  if (!ACTIVE.includes(appt.status)) throw new ApiError(400, `A ${appt.status.toLowerCase()} appointment cannot be rescheduled`);
  const { date, time } = req.body;
  if (!date || !time) throw new ApiError(400, 'New date and time are required');
  const base = parseLooseDate(date);
  if (!base) throw new ApiError(400, 'Invalid date');
  const newAt = combine(base, time);
  const clash = await Appointment.findOne({ _id: { $ne: appt._id }, provider: appt.provider?._id || appt.provider, scheduledAt: newAt, status: { $in: ACTIVE } });
  if (clash) throw new ApiError(409, 'That time is already booked for this professional. Please choose another slot.');
  appt.scheduledAt = newAt;
  appt.timeSlot = time;
  appt.rescheduled = true;
  appt.status = 'Confirmed';
  await appt.save();
  await syncEnquiryFromAppointment(appt, 'Rescheduled', req.user.role);
  await notifyAppointment(appt, 'Rescheduled', req.user.role);
  res.json({ success: true, message: 'Appointment rescheduled', appointment: appt });
});

// PATCH /api/appointments/:id/complete  { symptoms, prescription }
export const completeAppointment = asyncHandler(async (req, res) => {
  const appt = await loadForUser(req.params.id, req.user);
  if (req.user.role === 'patient') throw new ApiError(403, 'Only the doctor can complete a visit');
  if (appt.status === 'Cancelled') throw new ApiError(400, 'A cancelled appointment cannot be completed');
  appt.status = 'Completed';
  const weight = Number(req.body.weight);
  appt.visitNotes = {
    symptoms: req.body.symptoms,
    prescription: req.body.prescription,
    bloodPressure: req.body.bloodPressure ? String(req.body.bloodPressure).trim() : undefined,
    weight: Number.isFinite(weight) && weight > 0 ? weight : undefined,
    completedAt: new Date(),
  };
  if (appt.paymentStatus === 'Pending') {
    appt.paymentStatus = 'Paid';
    await Payment.updateMany({ appointment: appt._id, status: 'Pending' }, { status: 'Success', paidAt: new Date() });
  }
  await appt.save();
  await syncEnquiryFromAppointment(appt, 'Completed', req.user.role);
  await notifyAppointment(appt, 'Completed', req.user.role);
  res.json({ success: true, message: 'Visit completed', appointment: appt });
});

// PATCH /api/appointments/:id/cancel
export const cancelAppointment = asyncHandler(async (req, res) => {
  const appt = await loadForUser(req.params.id, req.user);
  if (!ACTIVE.includes(appt.status)) throw new ApiError(400, `This appointment is already ${appt.status.toLowerCase()}`);
  appt.status = 'Cancelled';
  appt.cancelledBy = req.user.role;
  if (appt.paymentStatus === 'Paid') {
    appt.paymentStatus = 'Refunded';
    await Payment.updateMany({ appointment: appt._id, status: 'Success' }, { status: 'Refunded' });
    await Payment.create({
      appointment: appt._id,
      appointmentCode: appt.code,
      patientUser: appt.patientUser,
      patientName: appt.patientName,
      provider: appt.provider?._id || appt.provider,
      providerName: appt.providerName,
      amount: appt.fee,
      method: appt.paymentMethod,
      status: 'Success',
      type: 'Refund',
      paidAt: new Date(),
      note: `Appointment cancelled by ${req.user.role}`,
    });
  } else {
    await Payment.updateMany({ appointment: appt._id, status: 'Pending' }, { status: 'Failed' });
  }
  await appt.save();
  await syncEnquiryFromAppointment(appt, 'Cancelled', req.user.role);
  await notifyAppointment(appt, 'Cancelled', req.user.role);
  res.json({ success: true, message: 'Appointment cancelled', appointment: appt });
});

// PATCH /api/appointments/:id/status  { status }  (admin / doctor)
export const updateAppointmentStatus = asyncHandler(async (req, res) => {
  const appt = await loadForUser(req.params.id, req.user);
  if (req.user.role === 'patient') throw new ApiError(403, 'Not allowed');
  const { status } = req.body;
  if (!['Waiting', 'Confirmed', 'Completed', 'Cancelled'].includes(status)) throw new ApiError(400, 'Invalid status');
  const previous = appt.status;
  appt.status = status;
  if (status === 'Cancelled') appt.cancelledBy = req.user.role;
  await appt.save();
  if (status !== previous) {
    await syncEnquiryFromAppointment(appt, status, req.user.role);
    await notifyAppointment(appt, status, req.user.role);
  }
  res.json({ success: true, appointment: appt });
});
