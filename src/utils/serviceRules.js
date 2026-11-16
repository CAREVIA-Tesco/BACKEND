// Per-service booking rules (keep in step with Frontend/src/data/serviceRules.js)
//
// - which visit types a service can be booked as (home / clinic / online)
// - which services are booked by duty hours (24 / 12 / 6 hours)
// - the basic tests that can be picked for Lab Tests
// - which professions may only offer some visit types
// - services that were removed from the website

// services not listed here can be booked as a home visit, clinic visit or online
export const SERVICE_VISIT_TYPES = {
  'nurse-care': ['home'],
  'home-doctor': ['home'],
  'care-taker': ['home'],
  'baby-care': ['home'],
  'lab-tests': ['home'],
  homeopathy: ['clinic', 'online'],
};

export const DUTY_HOURS = ['24 Hours', '12 Hours', '6 Hours'];
export const DUTY_HOUR_SERVICES = ['nurse-care', 'care-taker', 'baby-care'];

export const LAB_TESTS = [
  'Complete Blood Count (CBC)',
  'Blood Sugar (Fasting / PP)',
  'HbA1c',
  'Lipid Profile',
  'Thyroid Profile (T3, T4, TSH)',
  'Liver Function Test (LFT)',
  'Kidney Function Test (KFT)',
  'Urine Routine',
  'Vitamin D',
  'Vitamin B12',
  'Full Body Checkup',
];

// professions whose consultation types are fixed by their service
export const PROFESSION_VISIT_TYPES = {
  Nurse: ['home'],
  Caretaker: ['home'],
  'Lab Centre': ['home'],
  'Homeopathy Doctor': ['clinic', 'online'],
  BHMS: ['clinic', 'online'],
};

// removed from the website: deleted from the service list on start-up and refused in new requests
export const REMOVED_SERVICE_KEYS = ['bhs', 'neuro-rehab', 'neuro-rehab-test', 'diagnostic-rehab'];
export const REMOVED_SERVICE_NAME = /^(bhs|neuro\s*rehab(\s*test)?(\s*\d+)?|diagnostic\s*rehab)$/i;
export const isRemovedService = (svc) => !!svc && (REMOVED_SERVICE_KEYS.includes(String(svc.key || '').toLowerCase()) || REMOVED_SERVICE_NAME.test(String(svc.name || '').trim()));

// names used before the rename -> current name
export const RENAMED_SERVICES = { 'Doctor Visit': 'General Medicine' };

export const visitTypesForService = (key) => SERVICE_VISIT_TYPES[key] || ['home', 'clinic', 'online'];
export const visitTypesForProfession = (profession) => PROFESSION_VISIT_TYPES[profession] || null;
