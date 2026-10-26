// Free / booked slots for a doctor, per consultation type.
// A doctor can only be in one place at a time, so a slot booked for any type (home, clinic or online)
// is unavailable for the others too.
import Appointment from '../models/Appointment.js';
import Enquiry from '../models/Enquiry.js';
import { TYPES, offersOf, daySlots, hasHours, hoursText, istDay, weekdayOf, atIST, addDays } from '../utils/slots.js';

const ACTIVE = ['Waiting', 'Confirmed'];
const LEAD_MS = 30 * 60 * 1000; // a slot can be booked until 30 minutes before it starts

// times (ms) already taken for this doctor between start and end
export async function takenTimes(providerId, start, end, { excludeAppointment } = {}) {
  const [appts, held] = await Promise.all([
    Appointment.find({ provider: providerId, status: { $in: ACTIVE }, scheduledAt: { $gte: start, $lt: end } }).select('scheduledAt'),
    // requests naming this doctor that the care team has not turned into an appointment yet
    Enquiry.find({ requestedProvider: providerId, status: { $in: ['New', 'Contacted'] }, preferredDate: { $gte: start, $lt: end } }).select('preferredDate appointment'),
  ]);
  const set = new Set();
  appts.forEach((a) => { if (!excludeAppointment || String(a._id) !== String(excludeAppointment)) set.add(new Date(a.scheduledAt).getTime()); });
  held.forEach((e) => { if (!e.appointment) set.add(new Date(e.preferredDate).getTime()); });
  return set;
}

// [{ date: '2026-10-26', day: 'Mon', slots: [{ time: '07:30 PM', available: true }] }]
export async function slotCalendar(provider, type, { from, days = 14 } = {}) {
  const today = istDay(new Date());
  const first = from && from >= today ? from : today;
  const dates = Array.from({ length: days }, (_, i) => addDays(first, i));
  const start = new Date(`${dates[0]}T00:00:00+05:30`);
  const end = new Date(`${addDays(dates[dates.length - 1], 1)}T00:00:00+05:30`);
  const taken = await takenTimes(provider._id, start, end);
  const now = Date.now();
  return dates.map((date) => {
    const day = weekdayOf(date);
    const slots = daySlots(provider, type, day).map((time) => {
      const at = atIST(date, time).getTime();
      const past = at < now + LEAD_MS;
      return { time, available: !past && !taken.has(at), booked: !past && taken.has(at), past };
    });
    return { date, day, slots };
  });
}

// Checks a patient's choice. Returns { ok: true } or { ok: false, status, message }.
export async function checkSlot(provider, type, at) {
  const offers = offersOf(provider);
  if (!TYPES.includes(type) || !offers[type]) return { ok: false, status: 400, message: `${provider.name} does not offer this type of consultation. Please choose another option.` };
  if (!hasHours(provider, type)) return { ok: true, request: true }; // no timings published – the care team arranges the time
  const date = istDay(at);
  const slot = daySlots(provider, type, weekdayOf(date)).find((s) => atIST(date, s).getTime() === at.getTime());
  if (!slot) return { ok: false, status: 409, message: `That time is outside ${provider.name}'s ${type === 'clinic' ? 'clinic' : type === 'online' ? 'online consultation' : 'home visit'} timings. Please choose one of the available slots.` };
  if (at.getTime() < Date.now() - 60 * 1000) return { ok: false, status: 400, message: 'That slot has already passed. Please choose a later time.' };
  const taken = await takenTimes(provider._id, at, new Date(at.getTime() + 1));
  if (taken.has(at.getTime())) return { ok: false, status: 409, message: 'Sorry, this slot was just booked by another patient. Please choose another time.' };
  return { ok: true, slot, date };
}

export { hoursText };
