// Targeted verification for Clinic Patient Registration (Manual & Shared Link)
const BASE = process.env.API_URL || 'http://localhost:5000/api';
let passed = 0;
let failed = 0;

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function check(name, cond, extra = '') {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

const stamp = Date.now();
const WEEK = Object.fromEntries(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => [d, ['10:00 AM', '11:00 AM', '02:00 PM', '04:00 PM']]));

console.log('--- 1. Authentication & Setup ---');
// 1. Login as Admin
const admin = await call('POST', '/auth/login', { identifier: 'admin@carevia.com', password: 'Admin@123', role: 'admin' });
check('admin login successful', admin.status === 200 && admin.data.token);
const adminToken = admin.data.token;

// 2. Register a Doctor with complete valid profile & Aadhaar
const docName = `Dr. Carevia AutoDoc ${stamp}`;
const docEmail = `autodoc${stamp}@carevia.com`;
const docProfile = {
  name: docName,
  profession: 'MBBS Doctor',
  specialization: 'General Physician',
  qualification: 'MBBS, MD (General Medicine)',
  experience: 10,
  registrationNumber: 'TNMC-556677',
  registrationCouncil: 'Tamil Nadu Medical Council',
  languages: 'English, Tamil, Hindi',
  onlineFee: 500,
  clinicFee: 700,
  city: 'Chennai',
  pincode: '600001',
  state: 'Tamil Nadu',
  schedule: WEEK,
  clinic: { name: 'Carevia Premier Clinic', address: 'Plot 42, Anna Nagar West' },
  aadhaar: { number: '367598342159', photo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' },
  bank: { holderName: docName, bankName: 'HDFC Bank', accountNumber: '987654321012', ifsc: 'HDFC0001234' },
};

const docReg = await call('POST', '/auth/register', {
  name: docName,
  identifier: docEmail,
  password: 'Doctor@123',
  role: 'doctor',
  profile: docProfile,
});
check('doctor registered', docReg.status === 201 && docReg.data.token);
const docToken = docReg.data.token;
const providerId = docReg.data.provider?._id || docReg.data.provider?.id || docReg.data.user?.providerId;
check('doctor provider ID exists', Boolean(providerId));

// Activate doctor via Admin
const activateRes = await call('PATCH', `/providers/${providerId}/status`, { status: 'ACTIVE' }, adminToken);
check('doctor activated by admin', activateRes.status === 200 && activateRes.data.provider?.status === 'ACTIVE');

console.log('\n--- 2. Add Patient Manually (Doctor Dashboard) ---');
const manPhone = `9${String(Date.now()).slice(-9)}`;
const manualPayload = {
  patient: {
    name: 'Manual Patient John',
    phone: manPhone,
    age: 45,
    gender: 'Male',
    email: 'john@example.com',
    address: '12 First Cross Street',
    city: 'Chennai',
  },
  visitDate: new Date().toISOString().slice(0, 10),
  symptoms: 'Fever, sore throat and mild headache',
  diagnosis: 'Acute Pharyngitis',
  treatment: 'Warm saline gargle, hydration, Paracetamol',
  medicalHistory: 'Hypertension',
  allergies: 'Penicillin',
  currentMedications: 'Amlodipine 5mg',
  notes: 'Review in 3 days if fever persists',
  recordedBy: 'Nurse Emily',
};

const manualRes = await call('POST', '/clinic/visits', manualPayload, docToken);
check('nurse adds patient manually from Doctor Dashboard', manualRes.status === 201 && manualRes.data.patient?.code && manualRes.data.visit?.id, JSON.stringify(manualRes.data));
const manualPatientCode = manualRes.data.patient?.code;
const manualVisitId = manualRes.data.visit?.id;

console.log('\n--- 3. Generate & Share Patient Registration Link ---');
const linkPhone = `8${String(Date.now()).slice(-9)}`;
const genLinkRes = await call('POST', '/clinic/registration-links', {
  patientName: 'Self Register Sarah',
  patientPhone: linkPhone,
  notes: 'Walk-in registration for afternoon token',
  recordedBy: 'Nurse Emily',
  expiresInHours: 24,
}, docToken);

check('nurse generates unique patient registration link', genLinkRes.status === 201 && genLinkRes.data.link?.token, JSON.stringify(genLinkRes.data));
const linkData = genLinkRes.data.link;
const regToken = linkData.token;
const linkId = linkData.id;
check('link is associated with the correct doctor', linkData.provider?.toString() === providerId.toString() || linkData.clinicName === 'Carevia Premier Clinic');
check('link initial status is Pending', linkData.status === 'Pending');
check('link has public registration URL', Boolean(genLinkRes.data.url));

console.log('\n--- 4. Public Patient Intake Form (Patient Side) ---');
// Patient opens the link without logging in
const pubFormRes = await call('GET', `/clinic/public/register/${regToken}`);
check('patient can open public registration form (unauthenticated)', pubFormRes.status === 200 && pubFormRes.data.status === 'Pending');
check('public form displays doctor & clinic information', pubFormRes.data.clinic?.doctorName === docName && pubFormRes.data.clinic?.clinicName === 'Carevia Premier Clinic');
check('public form provides prefilled values if nurse provided them', pubFormRes.data.prefill?.patientName === 'Self Register Sarah' && pubFormRes.data.prefill?.patientPhone === linkPhone);

// Validation test: missing required fields
const invalidSub = await call('POST', `/clinic/public/register/${regToken}`, {
  name: 'X', // invalid name
  phone: '123', // invalid phone
});
check('validation rejects invalid patient registration data (400)', invalidSub.status === 400);

// Valid submission by patient
const patientSubmissionPayload = {
  name: 'Self Register Sarah',
  phone: linkPhone,
  age: 32,
  gender: 'Female',
  email: 'sarah@example.com',
  address: '45 Lake View Road',
  city: 'Chennai',
  symptoms: 'Severe migraine for 2 days, sensitivity to light, nausea',
  medicalHistory: 'None',
  currentMedications: 'None',
  allergies: 'Sulfa drugs',
  notes: 'Prefers quiet examination room',
};

const submitRes = await call('POST', `/clinic/public/register/${regToken}`, patientSubmissionPayload);
check('patient successfully submits registration form', submitRes.status === 201 && submitRes.data.patient?.code && submitRes.data.visit?.id, JSON.stringify(submitRes.data));
const selfPatientCode = submitRes.data.patient?.code;
const selfVisitId = submitRes.data.visit?.id;

// Duplicate submission prevention: submitting again on same link
const dupSubRes = await call('POST', `/clinic/public/register/${regToken}`, patientSubmissionPayload);
check('duplicate submission on same link rejected with 409 Conflict', dupSubRes.status === 409);

// Loading link after submission reflects Submitted state
const reloadedPubForm = await call('GET', `/clinic/public/register/${regToken}`);
check('opening submitted link shows status is Submitted', reloadedPubForm.status === 200 && reloadedPubForm.data.status === 'Submitted');

console.log('\n--- 5. Doctor Dashboard Synchronization ---');
// Check doctor's patient list
const docPatientsRes = await call('GET', '/clinic/patients', null, docToken);
check('manual patient appears in doctor patient list', docPatientsRes.data.patients?.some((p) => p.code === manualPatientCode));
check('self-registered patient appears in doctor patient list', docPatientsRes.data.patients?.some((p) => p.code === selfPatientCode));

// Check doctor's visits list (Patient Visits Details section)
const docVisitsRes = await call('GET', '/clinic/visits', null, docToken);
const foundSelfVisit = docVisitsRes.data.visits?.find((v) => v.id === selfVisitId);
check('self-registered visit appears in doctor Patient Visits Details', Boolean(foundSelfVisit));
check('visit contains patient symptoms & intake details', foundSelfVisit?.symptoms?.includes('migraine') && foundSelfVisit?.source === 'shared_link');
check('visit recorded under correct doctor', foundSelfVisit?.provider === providerId.toString() || foundSelfVisit?.providerName === docName);

// Check registration link status in Doctor Dashboard
const docLinksRes = await call('GET', '/clinic/registration-links', null, docToken);
const updatedLink = docLinksRes.data.links?.find((l) => l.id === linkId);
check('registration link status updated to Submitted in doctor dashboard', updatedLink && updatedLink.status === 'Submitted');
check('registration link links directly to patient & visit', updatedLink?.patient && updatedLink?.visit);

console.log('\n--- 6. Admin Panel Synchronization ---');
// Check admin visits list
const adminVisitsRes = await call('GET', `/clinic/visits?providerId=${providerId}`, null, adminToken);
check('manual visit visible in Admin Panel', adminVisitsRes.data.visits?.some((v) => v.id === manualVisitId));
check('self-registered visit visible in Admin Panel', adminVisitsRes.data.visits?.some((v) => v.id === selfVisitId));

// Check admin patient list
const adminPatientsRes = await call('GET', `/clinic/patients?providerId=${providerId}`, null, adminToken);
check('manual patient visible in Admin Panel', adminPatientsRes.data.patients?.some((p) => p.code === manualPatientCode));
check('self-registered patient visible in Admin Panel', adminPatientsRes.data.patients?.some((p) => p.code === selfPatientCode));

// Check admin registration links list
const adminLinksRes = await call('GET', `/clinic/registration-links?providerId=${providerId}`, null, adminToken);
check('registration links visible in Admin Panel', adminLinksRes.data.links?.some((l) => l.id === linkId && l.status === 'Submitted'));

console.log('\n--- 7. Link Cancellation Flow ---');
// Doctor/Nurse generates an unused link and cancels it
const unusedLinkRes = await call('POST', '/clinic/registration-links', { recordedBy: 'Nurse Emily', notes: 'Unused test link' }, docToken);
const cancelId = unusedLinkRes.data.link?.id;
const cancelRes = await call('DELETE', `/clinic/registration-links/${cancelId}`, null, docToken);
check('doctor/nurse can cancel an unused registration link', cancelRes.status === 200);

const cancelledLinkCheck = await call('GET', `/clinic/public/register/${unusedLinkRes.data.link?.token}`);
check('cancelled link is reported as Cancelled to patient', cancelledLinkCheck.status === 200 && cancelledLinkCheck.data.status === 'Cancelled');

console.log(`\n========================================`);
console.log(`Summary: ${passed} passed, ${failed} failed`);
console.log(`========================================\n`);

process.exit(failed ? 1 : 0);
