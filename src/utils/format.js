// Helpers that convert database values into the exact shapes the existing frontend expects.

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// "20 MAY 2026" – used by doctor & patient dashboards
export function dateLabel(d) {
  if (!d) return 'UNKNOWN';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return 'UNKNOWN';
  return `${String(date.getDate()).padStart(2, '0')} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

// "21 Sep 2026" – used by admin tables
export function shortDate(d) {
  if (!d) return '-';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '-';
  const m = MONTHS[date.getMonth()];
  return `${String(date.getDate()).padStart(2, '0')} ${m.charAt(0)}${m.slice(1).toLowerCase()} ${date.getFullYear()}`;
}

export const STATUS_COLORS = {
  Waiting: 'yellow',
  Confirmed: 'blue',
  Completed: 'green',
  Cancelled: 'gray',
};

export function formatINR(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

// Profession chosen in onboarding -> canonical "spec" label used by booking filters
const MBBS_SPEC_MAP = {
  'General Physician': 'General Physician',
  'General Medicine': 'General Physician',
  'Family Medicine': 'General Physician',
  Pediatrics: 'Pediatrician',
  Cardiology: 'Cardiologist',
  Dermatology: 'Dermatologist',
  Gynecology: 'Gynecologist',
  Orthopedics: 'Orthopedic',
  Neurology: 'Neurologist',
  Psychiatry: 'Psychiatrist',
  Urology: 'Urologist',
  Pulmonology: 'Pulmonologist',
  Gastroenterology: 'Gastroenterologist',
  Ophthalmology: 'Ophthalmologist',
  ENT: 'ENT Specialist',
  'Emergency Medicine': 'Emergency Physician',
};

const PROFESSION_SPEC = {
  'Homeopathy Doctor': 'Homeopathy Doctor',
  'Ayurveda Doctor': 'Ayurveda Doctor',
  Physiotherapist: 'Physiotherapist',
  Nurse: 'Nurse',
  Caretaker: 'Care Taker',
  BHS: 'BHS',
  'Lab Centre': 'Lab Centre',
};

export const DOCTOR_PROFESSIONS = ['MBBS Doctor', 'Homeopathy Doctor', 'Ayurveda Doctor'];
// professions in the registration list; anything else was typed in with "Other" and is treated as a doctor
export const LISTED_PROFESSIONS = [...DOCTOR_PROFESSIONS, 'Physiotherapist', 'Nurse', 'Caretaker', 'Lab Centre', 'BHS'];
export const isDoctorProfession = (p) => DOCTOR_PROFESSIONS.includes(p) || !LISTED_PROFESSIONS.includes(p);

// Aadhaar: 12 digits, not starting with 0 or 1, with a valid Verhoeff check digit
const VD = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const VP = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
export function isValidAadhaar(value) {
  const n = String(value || '').replace(/\s/g, '');
  if (!/^[2-9]\d{11}$/.test(n)) return false;
  let c = 0;
  n.split('').reverse().forEach((d, i) => { c = VD[c][VP[i % 8][Number(d)]]; });
  return c === 0;
}

export function specFor(profession, specialization) {
  if (profession === 'MBBS Doctor') return MBBS_SPEC_MAP[specialization] || specialization || 'General Physician';
  return PROFESSION_SPEC[profession] || specialization || profession || 'General Physician';
}

// Same fee rule as BookingModal.getFee()
export function feeFor(provider, consultationType, isDoctorCategory) {
  if (!provider) return 0;
  if (isDoctorCategory) {
    return consultationType === 'clinic'
      ? provider.clinicFee || provider.fee || 0
      : provider.onlineFee || provider.fee || 0;
  }
  return provider.fee || provider.clinicFee || 0;
}
