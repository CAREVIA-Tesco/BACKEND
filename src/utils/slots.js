// Consultation types a doctor offers (home visit, clinic visit, online) and the time slots for each.
//
// provider.consultTypes = { home: true, clinic: true, online: false }
// provider.hours = {
//   clinic: { days: ['Mon', 'Tue', ...], sessions: [{ from: '10:00', to: '13:00' }, { from: '17:00', to: '20:00' }], slotMins: 30 },
//   online: { ... }, home: { ... },
// }
// Slots are kept in the appointment format "07:30 PM" (India time).
// Profiles saved before consultation types existed fall back to the fees (a fee = the type is offered)
// and to the single weekly `schedule`.

export const TYPES = ['home', 'clinic', 'online'];
export const TYPE_LABEL = { home: 'Home visit', clinic: 'Clinic visit', online: 'Online consultation' };
export const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const JS_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const TZ_OFFSET = '+05:30';
const pad = (n) => String(n).padStart(2, '0');

export const hmToMin = (hm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || '').trim());
  if (!m) return null;
  const v = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return v >= 0 && v <= 24 * 60 ? v : null;
};
export const minTo12 = (min) => {
  const h = Math.floor(min / 60) % 24;
  return `${pad(h % 12 || 12)}:${pad(min % 60)} ${h >= 12 ? 'PM' : 'AM'}`;
};
export const slotToMin = (slot) => {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(slot || '').trim());
  if (!m) return null;
  let h = parseInt(m[1], 10) % 12;
  if (m[3].toUpperCase() === 'PM') h += 12;
  return h * 60 + parseInt(m[2], 10);
};
const short12 = (min) => { const s = minTo12(min); return s.replace(/^0/, ''); };

const validSessions = (h) => (Array.isArray(h?.sessions) ? h.sessions : [])
  .map((s) => ({ from: hmToMin(s?.from), to: hmToMin(s?.to) }))
  .filter((s) => s.from !== null && s.to !== null && s.to > s.from);

export const hoursConfigured = (h) => !!(h && Array.isArray(h.days) && h.days.length && validSessions(h).length);

// every slot start inside the sessions, e.g. 10:00-11:00 every 30 min -> 10:00 AM, 10:30 AM
export function generateSlots(h) {
  const step = [10, 15, 20, 30, 45, 60, 90, 120].includes(Number(h?.slotMins)) ? Number(h.slotMins) : 30;
  const out = new Set();
  for (const s of validSessions(h)) for (let t = s.from; t + step <= s.to; t += step) out.add(t);
  return [...out].sort((a, b) => a - b).map(minTo12);
}

// Clean a { home, clinic, online } hours payload coming from a form
export function cleanHours(input) {
  if (!input || typeof input !== 'object') return undefined;
  const out = {};
  for (const t of TYPES) {
    const h = input[t];
    if (!h || typeof h !== 'object') continue;
    out[t] = {
      days: WEEK.filter((d) => Array.isArray(h.days) && h.days.includes(d)),
      sessions: (Array.isArray(h.sessions) ? h.sessions : []).slice(0, 4)
        .map((s) => ({ from: String(s?.from || '').slice(0, 5), to: String(s?.to || '').slice(0, 5) }))
        .filter((s) => hmToMin(s.from) !== null && hmToMin(s.to) !== null),
      slotMins: [10, 15, 20, 30, 45, 60, 90, 120].includes(Number(h.slotMins)) ? Number(h.slotMins) : 30,
    };
  }
  return out;
}

// { home, clinic, online } the doctor offers
export function offersOf(p) {
  const ct = p?.consultTypes || {};
  if (TYPES.some((t) => typeof ct[t] === 'boolean')) return { home: !!ct.home, clinic: !!ct.clinic, online: !!ct.online };
  // older profiles: a fee means the type is offered
  const has = (v) => v !== undefined && v !== null && v !== '';
  const offers = {
    home: has(p?.fee) && p?.homeVisitRadiusKm !== 0,
    clinic: has(p?.clinicFee),
    online: has(p?.onlineFee),
  };
  if (!offers.home && !offers.clinic && !offers.online) offers.home = true;
  return offers;
}

const legacyDay = (p, day) => [...(p?.schedule?.[day] || [])].sort((a, b) => (slotToMin(a) ?? 0) - (slotToMin(b) ?? 0));

// slots for one consultation type on a weekday ('Mon')
export function daySlots(p, type, day) {
  const h = p?.hours?.[type];
  if (hoursConfigured(h)) return h.days.includes(day) ? generateSlots(h) : [];
  return legacyDay(p, day);
}

// does this type have any timings at all?
export function hasHours(p, type) {
  if (hoursConfigured(p?.hours?.[type])) return true;
  return WEEK.some((d) => legacyDay(p, d).length);
}

// weekly schedule across every offered type – kept on provider.schedule for the admin and dashboard views
export function scheduleUnion(p) {
  const offers = offersOf(p);
  const anyHours = TYPES.some((t) => offers[t] && hoursConfigured(p?.hours?.[t]));
  if (!anyHours) return null;
  return Object.fromEntries(WEEK.map((d) => {
    const all = new Set();
    TYPES.forEach((t) => { if (offers[t] && hoursConfigured(p.hours[t])) daySlots(p, t, d).forEach((s) => all.add(s)); });
    return [d, [...all].sort((a, b) => slotToMin(a) - slotToMin(b))];
  }));
}

// "Mon – Sat" / "Mon, Wed, Fri"
function daysText(days) {
  const idx = WEEK.map((d, i) => (days.includes(d) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return '';
  if (idx.length === 7) return 'Every day';
  const runs = [];
  idx.forEach((i) => { const r = runs[runs.length - 1]; if (r && i === r[1] + 1) r[1] = i; else runs.push([i, i]); });
  return runs.map(([a, b]) => (a === b ? WEEK[a] : b === a + 1 ? `${WEEK[a]}, ${WEEK[b]}` : `${WEEK[a]} – ${WEEK[b]}`)).join(', ');
}

// "Mon – Sat · 10:00 AM – 1:00 PM, 5:00 PM – 8:00 PM"
export function hoursText(p, type) {
  const h = p?.hours?.[type];
  if (hoursConfigured(h)) {
    const sessions = validSessions(h).map((s) => `${short12(s.from)} – ${short12(s.to)}`).join(', ');
    return `${daysText(h.days)} · ${sessions}`;
  }
  const days = WEEK.filter((d) => legacyDay(p, d).length);
  if (!days.length) return '';
  const mins = days.flatMap((d) => legacyDay(p, d)).map(slotToMin).filter((m) => m !== null);
  const first = Math.min(...mins); const last = Math.max(...mins);
  return `${daysText(days)} · ${first === last ? short12(first) : `${short12(first)} – ${short12(last)}`}`;
}

// public summary used by the website: [{ type, label, fee, hours, days }]
export function modesOf(p) {
  const offers = offersOf(p);
  const fees = { home: p?.fee, clinic: p?.clinicFee, online: p?.onlineFee };
  return TYPES.filter((t) => offers[t]).map((t) => ({
    type: t,
    label: TYPE_LABEL[t],
    fee: fees[t] ?? null,
    hours: hoursText(p, t),
    days: hoursConfigured(p?.hours?.[t]) ? p.hours[t].days : WEEK.filter((d) => legacyDay(p, d).length),
    slotMins: hoursConfigured(p?.hours?.[t]) ? p.hours[t].slotMins || 30 : null,
  }));
}

// India date helpers
export const istDay = (date) => new Date(date).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
export const weekdayOf = (ymd) => JS_DAY[new Date(`${ymd}T12:00:00${TZ_OFFSET}`).getUTCDay()];
export const atIST = (ymd, slot) => {
  const min = slotToMin(slot);
  return new Date(`${ymd}T${pad(Math.floor(min / 60))}:${pad(min % 60)}:00${TZ_OFFSET}`);
};
export const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T12:00:00${TZ_OFFSET}`);
  d.setUTCDate(d.getUTCDate() + n);
  return istDay(d);
};
// the slot ("07:30 PM") of an exact India time
export const slotOfDate = (date) => {
  const s = new Date(date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
  return minTo12(hmToMin(s));
};
