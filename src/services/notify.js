import Notification from '../models/Notification.js';
import User from '../models/User.js';
import Provider from '../models/Provider.js';

// Creating a notification must never break the action that caused it, so every helper swallows errors.
const safe = (fn) => async (...args) => {
  try { return await fn(...args); } catch (e) { console.warn(`[notify] ${e.message}`); return null; }
};

const when = (appt) => {
  const d = new Date(appt.scheduledAt);
  const day = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  return `${day}, ${appt.timeSlot}`;
};
const firstName = (n) => String(n || '').split(' ')[0] || 'the patient';
const VISIT = { home: 'home visit', online: 'online consultation', clinic: 'clinic visit' };

export const LINKS = {
  patient: (tab) => `/patient/dashboard?tab=${encodeURIComponent(tab)}`,
  doctor: (tab) => `/doctor/dashboard?tab=${encodeURIComponent(tab)}`,
};

export const notifyUser = safe(async (userId, data) => {
  if (!userId) return null;
  return Notification.create({ user: userId, ...data });
});

export const notifyUsers = safe(async (userIds, data) => {
  const ids = [...new Set((userIds || []).filter(Boolean).map(String))];
  if (!ids.length) return [];
  return Notification.insertMany(ids.map((user) => ({ user, ...data })));
});

export const notifyAdmins = safe(async (data) => {
  const admins = await User.find({ role: 'admin', status: { $ne: 'Inactive' } }).select('_id');
  return notifyUsers(admins.map((a) => a._id), data);
});

// the login account of a professional profile
async function providerUserId(providerOrId) {
  const id = providerOrId?._id || providerOrId;
  if (!id) return null;
  const p = providerOrId?.user !== undefined ? providerOrId : await Provider.findById(id).select('user');
  return p?.user || null;
}
export const notifyProvider = safe(async (providerOrId, data) => notifyUser(await providerUserId(providerOrId), data));

// Appointment events -> patient, professional and care team (whoever did not do it themselves)
export const notifyAppointment = safe(async (appt, event, actorRole) => {
  const who = appt.providerName || 'Your professional';
  const pat = appt.patientName || 'Patient';
  const kind = VISIT[appt.consultationType] || 'visit';
  const at = when(appt);
  const toPatient = (title, body) => (actorRole !== 'patient' ? notifyUser(appt.patientUser, { type: 'appointment', title, body, link: LINKS.patient('Appointments') }) : null);
  const toDoctor = (title, body) => (actorRole !== 'doctor' ? notifyProvider(appt.provider, { type: 'appointment', title, body, link: LINKS.doctor('Appointments') }) : null);
  const toAdmins = (title, body) => (actorRole !== 'admin' ? notifyAdmins({ type: 'appointment', title, body, link: `/admin/appointments?q=${encodeURIComponent(appt.code)}` }) : null);

  switch (event) {
    case 'Booked':
      await toPatient(appt.status === 'Confirmed' ? 'Visit confirmed' : 'Visit booked', `${appt.code}: ${kind} with ${who} on ${at}.${appt.status === 'Confirmed' ? '' : ' Waiting for confirmation.'}`);
      await toDoctor('New appointment', `${firstName(pat)} booked a ${kind} on ${at} (${appt.code}). Please confirm it.`);
      await toAdmins('New appointment', `${pat} with ${who} on ${at} (${appt.code}).`);
      break;
    case 'Confirmed':
      await toPatient('Visit confirmed', `${who} confirmed your ${kind} on ${at} (${appt.code}).`);
      await toDoctor('Appointment confirmed', `${appt.code} with ${firstName(pat)} on ${at} is confirmed.`);
      break;
    case 'Rescheduled':
      await toPatient('Visit rescheduled', `Your ${kind} with ${who} is now on ${at} (${appt.code}).`);
      await toDoctor('Appointment rescheduled', `${appt.code} with ${firstName(pat)} moved to ${at}.`);
      await toAdmins('Appointment rescheduled', `${appt.code} (${pat} with ${who}) moved to ${at}.`);
      break;
    case 'Completed':
      await toPatient('Visit completed', `${who} completed your visit. Your prescription and notes are in Medical Records.`);
      if (actorRole === 'admin') await toDoctor('Visit marked completed', `${appt.code} with ${firstName(pat)} was marked completed.`);
      break;
    case 'Cancelled': {
      const by = actorRole === 'patient' ? 'the patient' : actorRole === 'doctor' ? who : 'the Carevaa team';
      await toPatient('Visit cancelled', `Your ${kind} on ${at} (${appt.code}) was cancelled by ${by}.${actorRole === 'doctor' ? ' Our care team will arrange another professional.' : ''}`);
      await toDoctor('Appointment cancelled', `${appt.code} with ${firstName(pat)} on ${at} was cancelled by ${by}.`);
      await toAdmins('Appointment cancelled', `${appt.code} (${pat} with ${who}, ${at}) was cancelled by ${by}.`);
      break;
    }
    default:
      break;
  }
  return true;
});
