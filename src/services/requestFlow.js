// How a website request (Enquiry) reaches a professional and becomes an appointment.
//
//   Book Now request ──► broadcast to matching professionals (service + city)
//        │                    │ a professional accepts  ──► Appointment (Confirmed)
//        │                    │ a professional declines ──► hidden for them
//        └─► care team assigns a professional ──► Appointment (Waiting) ──► professional confirms / declines
//
// Appointment changes (confirm, decline, cancel, reschedule, complete) are mirrored on the request timeline,
// which the customer sees on the tracking page.
import Appointment from '../models/Appointment.js';
import Payment from '../models/Payment.js';
import Provider from '../models/Provider.js';
import User from '../models/User.js';
import { ApiError } from '../middleware/error.js';
import { feeFor } from '../utils/format.js';

// website service title -> provider "spec" values
const SERVICE_SPECS = {
  Physiotherapy: ['Physiotherapist'],
  'Nurse Care': ['Nurse'],
  'Home Doctor': ['General Physician'],
  'Care Taker': ['Care Taker'],
  'Baby Care': ['Pediatrician'],
  Ayurveda: ['Ayurveda Doctor'],
  BHS: ['BHS'],
};
const SERVICE_TYPE = { Physiotherapy: 'physiotherapy', 'Nurse Care': 'nurse-care', 'Home Doctor': 'home-doctor', 'Care Taker': 'care-taker', 'Baby Care': 'baby-care', Ayurveda: 'ayurveda', BHS: 'bhs' };
const TITLES = { online: 'Online Consultation', clinic: 'Clinic Consultation', home: 'Home Consultation' };
const LOCATIONS = { online: 'Virtual', clinic: 'Main Clinic', home: 'Patient Home' };
const ACTIVE = ['Waiting', 'Confirmed'];
const TZ = 'Asia/Kolkata';
const digits = (p) => String(p || '').replace(/\D/g, '').slice(-10);

export const OPEN_STATUSES = ['New', 'Contacted'];

// Does this professional fit the request? (service -> speciality, and the same city)
export function providerMatches(enquiry, provider) {
  if (!provider || provider.status !== 'ACTIVE') return false;
  const specs = SERVICE_SPECS[enquiry.service];
  const serviceOk = specs ? specs.includes(provider.spec) : enquiry.service === 'Doctor Visit' ? provider.isDoctor : true;
  const cityOk = !enquiry.city || enquiry.city === 'Other' || String(provider.city || '').toLowerCase() === String(enquiry.city).toLowerCase();
  return serviceOk && cityOk;
}

export async function matchingProviders(enquiry) {
  const providers = await Provider.find({ status: 'ACTIVE' });
  return providers.filter((p) => providerMatches(enquiry, p));
}

// "2:00 PM" / "14:00" -> "02:00 PM" (the appointment slot format)
export function toSlot(time) {
  const t = String(time || '').trim();
  let m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(t);
  if (m) return `${String(parseInt(m[1], 10)).padStart(2, '0')}:${m[2]} ${m[3].toUpperCase()}`;
  m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (m) {
    const h = parseInt(m[1], 10);
    return `${String(h % 12 || 12).padStart(2, '0')}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`;
  }
  return null;
}

const dayString = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD in India
const whenText = (appt) => `${new Date(appt.scheduledAt).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ })} at ${appt.timeSlot}`;

function combine(day, slot) {
  const m = /^(\d{2}):(\d{2}) (AM|PM)$/.exec(slot);
  let h = parseInt(m[1], 10) % 12;
  if (m[3] === 'PM') h += 12;
  return new Date(`${day}T${String(h).padStart(2, '0')}:${m[2]}:00+05:30`);
}

// Create the appointment for a request and link both ways.
export async function scheduleFromEnquiry(enquiry, provider, { date, time, consultationType, status, assignedBy, by }) {
  if (enquiry.appointment) {
    const existing = await Appointment.findById(enquiry.appointment);
    if (existing && ACTIVE.includes(existing.status)) throw new ApiError(409, `This request already has an appointment (${existing.code}) with ${existing.providerName}`);
  }
  if (['Converted', 'Closed'].includes(enquiry.status)) throw new ApiError(400, `This request is already ${enquiry.status.toLowerCase()}`);

  const slot = toSlot(time || enquiry.preferredTime);
  const day = date ? String(date).slice(0, 10) : enquiry.preferredDate ? dayString(enquiry.preferredDate) : null;
  if (!slot || !day) throw new ApiError(400, 'Please choose the visit date and time');
  const scheduledAt = combine(day, slot);
  if (Number.isNaN(scheduledAt.getTime())) throw new ApiError(400, 'Invalid visit date or time');
  if (scheduledAt.getTime() < Date.now() - 15 * 60 * 1000) throw new ApiError(400, 'The visit time has already passed – please choose a new time');

  const clash = await Appointment.findOne({ provider: provider._id, scheduledAt, status: { $in: ACTIVE } });
  if (clash) throw new ApiError(409, `${provider.name} already has an appointment at that time`);

  const type = ['online', 'clinic', 'home'].includes(consultationType) ? consultationType : 'home';
  const serviceType = SERVICE_TYPE[enquiry.service];
  const isDoctorCategory = !serviceType || serviceType === 'home-doctor';
  const fee = feeFor(provider, type, isDoctorCategory);

  // link to the patient's account when one exists for this mobile number
  const phone = digits(enquiry.phone);
  const patient = enquiry.patientUser
    ? await User.findById(enquiry.patientUser)
    : (await User.find({ role: 'patient', phone: { $regex: `${phone}$` } }).limit(1))[0];

  const appointment = await Appointment.create({
    patientUser: patient?._id,
    patientName: enquiry.name,
    patientPhone: enquiry.phone,
    patientEmail: enquiry.email,
    reason: [enquiry.service, enquiry.plan, enquiry.message].filter(Boolean).join(' – ') || undefined,
    provider: provider._id,
    providerName: provider.name,
    providerSpec: provider.spec,
    scheduledAt,
    timeSlot: slot,
    consultationType: type,
    serviceType,
    title: TITLES[type],
    location: type === 'home' && enquiry.city ? `Patient Home, ${enquiry.city}` : LOCATIONS[type],
    fee,
    status,
    paymentStatus: 'Pending',
    paymentMethod: 'cash',
    enquiry: enquiry._id,
    assignedBy,
  });
  await Payment.create({
    appointment: appointment._id,
    appointmentCode: appointment.code,
    patientUser: patient?._id,
    patientName: appointment.patientName,
    provider: provider._id,
    providerName: provider.name,
    amount: fee,
    method: 'cash',
    status: 'Pending',
  });

  enquiry.appointment = appointment._id;
  enquiry.appointmentCode = appointment.code;
  enquiry.provider = provider._id;
  enquiry.providerName = provider.name;
  enquiry.status = 'Scheduled';
  enquiry.broadcast = false;
  if (patient && !enquiry.patientUser) enquiry.patientUser = patient._id;
  enquiry.timeline.push({
    status: 'Scheduled',
    note: status === 'Confirmed'
      ? `${provider.name} (${provider.spec}) accepted your request – visit on ${whenText(appointment)}. Appointment ID: ${appointment.code}.`
      : `Visit scheduled with ${provider.name} (${provider.spec}) on ${whenText(appointment)} – waiting for the professional to confirm. Appointment ID: ${appointment.code}.`,
  });
  enquiry.notes.push({ text: `${assignedBy === 'admin' ? 'Assigned to' : 'Accepted by'} ${provider.name} – ${appointment.code}`, by });
  await enquiry.save();
  return appointment;
}

// Keep the request (and what the customer sees) in step with its appointment.
export async function syncEnquiryFromAppointment(appt, event, actorRole) {
  if (!appt?.enquiry) return;
  const { default: Enquiry } = await import('../models/Enquiry.js');
  const enquiry = await Enquiry.findById(appt.enquiry);
  if (!enquiry || String(enquiry.appointment) !== String(appt._id)) return;
  const who = appt.providerName;

  if (event === 'Confirmed') {
    enquiry.timeline.push({ status: 'Scheduled', note: `${who} confirmed your visit on ${whenText(appt)}.` });
  } else if (event === 'Rescheduled') {
    enquiry.timeline.push({ status: enquiry.status, note: `Your visit was rescheduled to ${whenText(appt)}.` });
  } else if (event === 'Completed') {
    enquiry.status = 'Converted';
    enquiry.timeline.push({ status: 'Converted', note: `Visit completed by ${who}. Prescription and notes are in your records.` });
  } else if (event === 'Cancelled') {
    if (actorRole === 'patient') {
      enquiry.status = 'Closed';
      enquiry.closedReason = 'Visit cancelled by customer';
      enquiry.timeline.push({ status: 'Closed', note: 'You cancelled the visit.' });
    } else {
      // professional (or care team) could not take it: back to the pool and to the care team
      enquiry.status = 'Contacted';
      enquiry.appointment = undefined;
      enquiry.appointmentCode = undefined;
      enquiry.provider = undefined;
      enquiry.providerName = undefined;
      if (actorRole === 'doctor') enquiry.declinedBy.push(appt.provider?._id || appt.provider);
      enquiry.broadcast = true;
      enquiry.broadcastAt = new Date();
      enquiry.timeline.push({ status: 'Contacted', note: `${who} is not available at that time – we are arranging another professional for you.` });
      enquiry.notes.push({ text: `${who} declined/cancelled ${appt.code}. Request shared with other matching professionals again.`, by: actorRole === 'doctor' ? who : 'Admin' });
    }
  }
  await enquiry.save();
}
