// Shared checks for the public forms (bookings, enquiries, job applications, business partners).
// Indian mobile numbers: 10 digits starting 6-9; "+91 98765 43210", "098765 43210" are accepted and cleaned.
export function cleanMobile(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : '';
}
export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim());
// a person's name: at least 2 letters; letters, spaces and . ' - only
export const isName = (v) => { const s = String(v || '').trim(); return s.length >= 2 && s.length <= 100 && /^[\p{L}][\p{L}\p{M} .'-]*$/u.test(s); };
