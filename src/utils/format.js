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
