import 'dotenv/config';

let passed = 0;
let failed = 0;

function check(title, condition, details = '') {
  if (condition) {
    passed++;
    console.log(`  ✓ ${title}`);
  } else {
    failed++;
    console.error(`  ✗ ${title} ${details}`);
  }
}

const API_BASE = 'http://127.0.0.1:5000/api';

async function req(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

// Valid Aadhaar: 12 digits with valid Verhoeff checksum
const VALID_AADHAAR = '234567890124';
const DUMMY_AADHAAR_PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

const WEEK_HOURS = {
  days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  sessions: [{ from: '09:00', to: '17:00' }],
  slotMins: 30
};

console.log('\n=== RUNNING DYNAMIC ONBOARDING TEST SUITE ACROSS ALL PROFESSIONS ===\n');

// 1. Health check
const health = await req('/health');
check('Server is online and healthy', health.status === 200 && health.data.success);

// 2. Admin Login
const adminLogin = await req('/auth/login', {
  method: 'POST',
  body: { identifier: 'admin@carevia.com', password: 'Admin@123', role: 'admin' }
});
check('Admin logs in successfully', adminLogin.status === 200 && adminLogin.data.token);
const adminToken = adminLogin.data.token;

const testCases = [
  {
    profession: 'MBBS Doctor',
    name: 'Dr. Arjun Mehta',
    specialization: 'Cardiology',
    qualification: 'MBBS, MD (Cardiology)',
    experience: 12,
    registrationNumber: 'TNMC-987654',
    registrationCouncil: 'Tamil Nadu Medical Council',
    gender: 'Male',
    consultTypes: { clinic: true, home: true, online: true },
    clinicFee: 700,
    homeFee: 1200,
    onlineFee: 500,
    clinic: { name: 'Mehta Heart Centre', address: '12 Anna Salai, Chennai' },
    hours: { clinic: WEEK_HOURS, home: WEEK_HOURS, online: WEEK_HOURS }
  },
  {
    profession: 'Homeopathy Doctor',
    name: 'Dr. Sunita Rao',
    specialization: 'Chronic Disease Care',
    qualification: 'BHMS, MD (Homeopathy)',
    experience: 8,
    registrationNumber: 'CCH-456789',
    registrationCouncil: 'Central Council of Homeopathy',
    gender: 'Female',
    consultTypes: { clinic: true, home: false, online: true },
    clinicFee: 500,
    onlineFee: 400,
    clinic: { name: 'Healing Touch Homeo Clinic', address: '45 MG Road, Bangalore' },
    hours: { clinic: WEEK_HOURS, online: WEEK_HOURS }
  },
  {
    profession: 'Ayurveda Doctor',
    name: 'Dr. Raghavan Nair',
    specialization: 'Panchakarma',
    qualification: 'BAMS, MD (Ayurveda)',
    experience: 10,
    registrationNumber: 'CCIM-112233',
    registrationCouncil: 'Travancore Cochin Medical Council',
    gender: 'Male',
    consultTypes: { clinic: true, home: true, online: false },
    clinicFee: 600,
    homeFee: 1000,
    clinic: { name: 'Kerala Ayurveda Kendra', address: '88 Temple Road, Kochi' },
    hours: { clinic: WEEK_HOURS, home: WEEK_HOURS }
  },
  {
    profession: 'Physiotherapist',
    name: 'Dr. Ananya Sen',
    specialization: 'Sports Physiotherapy',
    qualification: 'BPT, MPT (Sports)',
    experience: 6,
    registrationNumber: 'IAP-334455', // optional
    registrationCouncil: 'Indian Association of Physiotherapists',
    gender: 'Female',
    consultTypes: { clinic: true, home: true, online: true },
    clinicFee: 600,
    homeFee: 900,
    onlineFee: 450,
    clinic: { name: 'ActiveLife Physio Centre', address: '14 Park Street, Kolkata' },
    hours: { clinic: WEEK_HOURS, home: WEEK_HOURS, online: WEEK_HOURS }
  },
  {
    profession: 'Nurse',
    name: 'Nurse Rekha Thomas',
    specialization: 'ICU Nurse',
    qualification: 'B.Sc. Nursing',
    experience: 7,
    registrationNumber: 'TNC-778899',
    registrationCouncil: 'Tamil Nadu Nurses and Midwives Council',
    gender: 'Female',
    consultTypes: { home: true, clinic: false, online: false },
    homeFee: 650,
    hours: { home: WEEK_HOURS }
  },
  {
    profession: 'Caretaker',
    name: 'Ramesh Varma',
    // Caretaker has NO council registration, optional qualification
    careTypes: ['Elderly Care', 'Bedridden Patient Care', 'Post-Surgery Care'],
    qualification: 'Certified Geriatric Assistant',
    trainingCertificates: 'Red Cross First Aid & CPR, St. John Ambulance Bedside Care',
    experience: 5,
    gender: 'Male',
    consultTypes: { home: true, clinic: false, online: false },
    homeFee: 500,
    hours: { home: WEEK_HOURS }
  },
  {
    profession: 'Lab Centre',
    name: 'Carevaa Precision Diagnostic Laboratory',
    contactPerson: 'Dr. Ramesh Kumar (Director)',
    centreType: 'Comprehensive Diagnostic Centre',
    servicesOffered: ['Blood Tests', 'Lipid Profile', 'Thyroid Tests', 'Diabetes Tests', 'Pathology'],
    accreditation: 'NABL Accredited (ISO 15189)',
    experience: 9, // years in operation
    registrationNumber: 'LAB-LIC-2023-9988',
    registrationCouncil: 'Directorate of Medical Services',
    // NO gender, NO individual qualification
    consultTypes: { clinic: true, home: true, online: false },
    clinicFee: 300,
    homeFee: 200,
    clinic: { name: 'Carevaa Precision Diagnostic Laboratory', address: '100 Ring Road, Velachery, Chennai' },
    hours: { clinic: WEEK_HOURS, home: WEEK_HOURS }
  },
  {
    profession: 'Other',
    name: 'Deepak Sharma',
    specialization: 'Clinical Nutritionist',
    qualification: 'M.Sc. Clinical Nutrition & Dietetics',
    experience: 4,
    gender: 'Male',
    consultTypes: { online: true, clinic: false, home: true },
    onlineFee: 600,
    homeFee: 800,
    hours: { online: WEEK_HOURS, home: WEEK_HOURS }
  }
];

const registeredProviders = [];

for (const tc of testCases) {
  console.log(`\n--- Testing Onboarding for: ${tc.profession} (${tc.name}) ---`);

  const uniqueId = `${tc.profession.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}`;
  const email = `${uniqueId}@carevia.com`;

  const payload = {
    name: tc.name,
    profession: tc.profession,
    specialization: tc.specialization || (tc.careTypes ? tc.careTypes.join(', ') : tc.servicesOffered ? tc.servicesOffered[0] : ''),
    qualification: tc.qualification || '',
    experience: tc.experience,
    registrationNumber: tc.registrationNumber || '',
    registrationCouncil: tc.registrationCouncil || '',
    gender: tc.gender || null,
    contactPerson: tc.contactPerson || '',
    centreType: tc.centreType || '',
    servicesOffered: tc.servicesOffered || [],
    accreditation: tc.accreditation || '',
    careTypes: tc.careTypes || [],
    trainingCertificates: tc.trainingCertificates || '',
    city: 'Chennai',
    state: 'Tamil Nadu',
    district: 'Chennai',
    locality: 'Velachery',
    pincode: '600042',
    bio: `${tc.name} provides expert healthcare services on Carevaa.`,
    homeFee: tc.homeFee || '',
    clinicFee: tc.clinicFee || '',
    onlineFee: tc.onlineFee || '',
    consultTypes: tc.consultTypes,
    hours: tc.hours,
    clinic: tc.clinic,
    aadhaar: { number: VALID_AADHAAR, photo: DUMMY_AADHAAR_PHOTO },
    bank: {
      holderName: tc.contactPerson || tc.name,
      bankName: 'HDFC Bank',
      accountNumber: '123456789012',
      ifsc: 'HDFC0001234'
    }
  };

  const regRes = await req('/auth/register', {
    method: 'POST',
    body: {
      name: tc.name,
      identifier: email,
      password: 'Password@123',
      role: 'doctor',
      profile: payload
    }
  });

  check(
    `${tc.profession} registered with 201 Created and PENDING status`,
    regRes.status === 201 && regRes.data.provider?.status === 'PENDING',
    JSON.stringify(regRes.data)
  );

  const provider = regRes.data.provider;
  if (!provider) continue;

  registeredProviders.push({ tc, providerId: provider.id || provider._id, token: regRes.data.token });

  // Verify profession-specific saved fields
  if (tc.profession === 'Lab Centre') {
    check('Lab Centre has null gender', provider.gender === null);
    check('Lab Centre has false isDoctor', provider.isDoctor === false);
    check('Lab Centre saved contactPerson', provider.contactPerson === tc.contactPerson);
    check('Lab Centre saved centreType', provider.centreType === tc.centreType);
    check('Lab Centre saved servicesOffered', Array.isArray(provider.servicesOffered) && provider.servicesOffered.length === 5);
    check('Lab Centre saved accreditation', provider.accreditation === tc.accreditation);
  } else if (tc.profession === 'Caretaker') {
    check('Caretaker saved careTypes array', Array.isArray(provider.careTypes) && provider.careTypes.length === 3);
    check('Caretaker saved trainingCertificates', provider.trainingCertificates === tc.trainingCertificates);
    check('Caretaker registrationNumber is empty/absent', !provider.registrationNumber);
  } else if (tc.profession === 'Nurse') {
    check('Nurse saved nursing qualification', provider.qualification === tc.qualification);
    check('Nurse saved council registration', provider.registrationNumber === tc.registrationNumber);
  }
}

// Admin Verification & Public Profile check
console.log('\n--- Admin Approval & Public Profile Verification ---');

for (const { tc, providerId } of registeredProviders) {
  // Admin fetches provider details
  const adminGet = await req(`/providers/${providerId}`, { token: adminToken });
  check(`Admin fetches provider for ${tc.profession} (200 OK)`, adminGet.status === 200);

  const p = adminGet.data.provider;
  if (tc.profession === 'Lab Centre') {
    check('Admin view shows Lab Centre contactPerson', p.contactPerson === tc.contactPerson);
    check('Admin view shows Lab Centre accreditation', p.accreditation === tc.accreditation);
  } else if (tc.profession === 'Caretaker') {
    check('Admin view shows Caretaker careTypes', Array.isArray(p.careTypes));
  }

  // Admin approves provider
  const approveRes = await req(`/providers/${providerId}/status`, {
    method: 'PATCH',
    token: adminToken,
    body: { status: 'ACTIVE' }
  });
  check(`Admin approves ${tc.profession} (status: ACTIVE)`, approveRes.status === 200);

  // Public visitor views active profile
  const publicGet = await req(`/providers/${providerId}`);
  check(`Public can view active profile for ${tc.profession}`, publicGet.status === 200 && publicGet.data.provider?.name === tc.name);
  check(`Public profile hides bank and aadhaar`, !publicGet.data.provider.bank && !publicGet.data.provider.aadhaar);
}

console.log(`\n========================================`);
console.log(`TEST SUITE FINISHED: ${passed} PASSED, ${failed} FAILED`);
console.log(`========================================\n`);

if (failed > 0) process.exit(1);
