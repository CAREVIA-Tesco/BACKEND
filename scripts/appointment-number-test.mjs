// End-to-end verification of sequential, continuous appointment numbering
// across Shared Link and Manual registrations.
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

function parseSeq(apptNum) {
  const match = String(apptNum || '').match(/^APPT-(\d+)$/);
  return match ? parseInt(match[1], 10) : NaN;
}

const stamp = Date.now();
const WEEK = Object.fromEntries(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => [d, ['10:00 AM', '11:00 AM', '02:00 PM', '04:00 PM']]));

console.log('--- 1. Authenticate Doctor & Admin ---');
const admin = await call('POST', '/auth/login', { identifier: 'admin@carevia.com', password: 'Admin@123', role: 'admin' });
check('admin login successful', admin.status === 200 && admin.data.token);
const adminToken = admin.data.token;

const docName = `Dr. SeqTest ${stamp}`;
const docEmail = `seqdoc${stamp}@carevia.com`;
const docReg = await call('POST', '/auth/register', {
  name: docName,
  identifier: docEmail,
  password: 'Doctor@123',
  role: 'doctor',
  profile: {
    name: docName,
    profession: 'MBBS Doctor',
    specialization: 'General Physician',
    qualification: 'MBBS, MD',
    experience: 8,
    languages: 'English',
    onlineFee: 400,
    clinicFee: 600,
    city: 'Chennai',
    pincode: '600001',
    state: 'Tamil Nadu',
    schedule: WEEK,
    clinic: { name: 'Carevia City Clinic', address: '12 Main Road' },
    aadhaar: { number: '367598342159', photo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' },
    bank: { holderName: docName, bankName: 'SBI', accountNumber: '123456789012', ifsc: 'SBIN0001234' },
  },
});
check('doctor registered', docReg.status === 201 && docReg.data.token);
const docToken = docReg.data.token;
const providerId = docReg.data.provider?._id || docReg.data.provider?.id || docReg.data.user?.providerId;
await call('PATCH', `/providers/${providerId}/status`, { status: 'ACTIVE' }, adminToken);

console.log('\n--- 2. Four Alternating Registrations: Link -> Manual -> Link -> Manual ---');
// Patient 1: Registers through shared link
const link1 = await call('POST', '/clinic/registration-links', {
  patientName: 'Patient One (Link)',
  patientPhone: `91${String(Date.now()).slice(-8)}`,
  recordedBy: 'Nurse Alice',
}, docToken);
check('generated registration link 1', link1.status === 201 && link1.data.link?.token);
const sub1 = await call('POST', `/clinic/public/register/${link1.data.link.token}`, {
  name: 'Patient One (Link)',
  phone: `91${String(Date.now()).slice(-8)}`,
  age: 29,
  gender: 'Female',
  symptoms: 'Headache and fatigue',
});
check('patient 1 submitted via link', sub1.status === 201 && sub1.data.visit?.appointmentNumber);
const num1 = sub1.data.visit?.appointmentNumber;
const seq1 = parseSeq(num1);
check('patient 1 has valid APPT format (e.g. APPT-xxx)', !Number.isNaN(seq1), `Got: ${num1}`);

// Patient 2: Nurse manually adds patient
const man2 = await call('POST', '/clinic/visits', {
  patient: {
    name: 'Patient Two (Manual)',
    phone: `92${String(Date.now()).slice(-8)}`,
    age: 40,
    gender: 'Male',
  },
  visitDate: new Date().toISOString().slice(0, 10),
  symptoms: 'Fever and chills',
  diagnosis: 'Viral Fever',
  recordedBy: 'Nurse Alice',
}, docToken);
check('nurse manually added patient 2', man2.status === 201 && man2.data.visit?.appointmentNumber);
const num2 = man2.data.visit?.appointmentNumber;
const seq2 = parseSeq(num2);
check('patient 2 has next sequential number (seq1 + 1)', seq2 === seq1 + 1, `Expected ${seq1 + 1}, got ${seq2} (${num2})`);

// Patient 3: Registers through shared link
const link3 = await call('POST', '/clinic/registration-links', {
  patientName: 'Patient Three (Link)',
  patientPhone: `93${String(Date.now()).slice(-8)}`,
  recordedBy: 'Nurse Alice',
}, docToken);
check('generated registration link 3', link3.status === 201 && link3.data.link?.token);
const sub3 = await call('POST', `/clinic/public/register/${link3.data.link.token}`, {
  name: 'Patient Three (Link)',
  phone: `93${String(Date.now()).slice(-8)}`,
  age: 33,
  gender: 'Female',
  symptoms: 'Allergic rhinitis and sneezing',
});
check('patient 3 submitted via link', sub3.status === 201 && sub3.data.visit?.appointmentNumber);
const num3 = sub3.data.visit?.appointmentNumber;
const seq3 = parseSeq(num3);
check('patient 3 has next sequential number (seq2 + 1)', seq3 === seq2 + 1, `Expected ${seq2 + 1}, got ${seq3} (${num3})`);

// Patient 4: Nurse manually adds patient
const man4 = await call('POST', '/clinic/visits', {
  patient: {
    name: 'Patient Four (Manual)',
    phone: `94${String(Date.now()).slice(-8)}`,
    age: 52,
    gender: 'Female',
  },
  visitDate: new Date().toISOString().slice(0, 10),
  symptoms: 'Knee joint pain',
  diagnosis: 'Osteoarthritis',
  recordedBy: 'Nurse Alice',
}, docToken);
check('nurse manually added patient 4', man4.status === 201 && man4.data.visit?.appointmentNumber);
const num4 = man4.data.visit?.appointmentNumber;
const seq4 = parseSeq(num4);
check('patient 4 has next sequential number (seq3 + 1)', seq4 === seq3 + 1, `Expected ${seq3 + 1}, got ${seq4} (${num4})`);

console.log(`\n  Sequence: ${num1} -> ${num2} -> ${num3} -> ${num4}`);

console.log('\n--- 3. Concurrency Test: Simultaneous Submissions ---');
// Generate 5 links, then submit all 5 registration forms simultaneously via Promise.all
const batchLinks = [];
for (let i = 1; i <= 5; i++) {
  const l = await call('POST', '/clinic/registration-links', {
    patientName: `Parallel Patient ${i}`,
    patientPhone: `955555550${i}`,
    recordedBy: 'Nurse Alice',
  }, docToken);
  batchLinks.push(l);
}
check('all 5 test links generated', batchLinks.every((l) => l.status === 201 && l.data.link?.token));

const parallelSubmissions = await Promise.all(batchLinks.map((l, i) =>
  call('POST', `/clinic/public/register/${l.data.link.token}`, {
    name: `Parallel Patient ${i + 1}`,
    phone: `955555550${i + 1}`,
    age: 25 + i,
    gender: i % 2 === 0 ? 'Male' : 'Female',
    symptoms: `Concurrent test symptoms ${i + 1}`,
  })
));

const parallelNumbers = parallelSubmissions.map((s) => s.data.visit?.appointmentNumber);
const uniqueParallel = new Set(parallelNumbers);
check('all 5 concurrent submissions succeeded', parallelSubmissions.every((s) => s.status === 201));
check('no duplicate appointment numbers under concurrency (all 5 unique)', uniqueParallel.size === 5, `Got: ${parallelNumbers.join(', ')}`);

// Verify the numbers form a contiguous sequence
const parallelSeqs = parallelNumbers.map(parseSeq).sort((a, b) => a - b);
const isContiguous = parallelSeqs.every((val, idx, arr) => idx === 0 || val === arr[idx - 1] + 1);
check('concurrent appointment numbers are strictly contiguous and continuous', isContiguous, `Seqs: ${parallelSeqs.join(', ')}`);

console.log('\n--- 4. Verify Appointment Numbers in Doctor Dashboard ---');
const docVisits = await call('GET', '/clinic/visits', null, docToken);
check('doctor visits endpoint includes appointmentNumber on all visits', docVisits.status === 200 && docVisits.data.visits?.every((v) => v.appointmentNumber && v.code));
check('doctor visits contains patient 1 appointment number', docVisits.data.visits?.some((v) => v.appointmentNumber === num1));
check('doctor visits contains patient 2 appointment number', docVisits.data.visits?.some((v) => v.appointmentNumber === num2));
check('doctor visits contains patient 3 appointment number', docVisits.data.visits?.some((v) => v.appointmentNumber === num3));
check('doctor visits contains patient 4 appointment number', docVisits.data.visits?.some((v) => v.appointmentNumber === num4));

const docLinks = await call('GET', '/clinic/registration-links', null, docToken);
check('doctor registration links include appointmentNumber', docLinks.status === 200 && docLinks.data.links?.some((l) => l.appointmentNumber === num1 && l.status === 'Submitted'));

console.log('\n--- 5. Verify Appointment Numbers in Admin Panel ---');
const adminVisits = await call('GET', `/clinic/visits?providerId=${providerId}`, null, adminToken);
check('admin visits endpoint includes appointmentNumber', adminVisits.status === 200 && adminVisits.data.visits?.every((v) => v.appointmentNumber));
check('admin visits contains all 4 sequential appointment numbers',
  adminVisits.data.visits?.some((v) => v.appointmentNumber === num1) &&
  adminVisits.data.visits?.some((v) => v.appointmentNumber === num2) &&
  adminVisits.data.visits?.some((v) => v.appointmentNumber === num3) &&
  adminVisits.data.visits?.some((v) => v.appointmentNumber === num4)
);

const adminLinks = await call('GET', `/clinic/registration-links?providerId=${providerId}`, null, adminToken);
check('admin registration links contain appointmentNumber', adminLinks.status === 200 && adminLinks.data.links?.some((l) => l.appointmentNumber === num1));

console.log('\n--- 6. Verify Existing Direct Booking Workflow Shares Numbering ---');
const tomorrow = new Date(Date.now() + 86400000 * 2).toISOString();
const bookRes = await call('POST', '/appointments', {
  providerId,
  date: tomorrow,
  time: '11:00 AM',
  consultationType: 'clinic',
  patientInfo: { name: 'Direct Booking Patient', phone: '9888888888' },
}, adminToken);

check('direct appointment booking succeeded', bookRes.status === 201 && bookRes.data.appointment?.code);
const directApptNum = bookRes.data.appointment?.code;
const directSeq = parseSeq(directApptNum);
const lastParallelSeq = parallelSeqs[parallelSeqs.length - 1];
check('direct booking continues from latest appointment sequence', directSeq === lastParallelSeq + 1, `Expected ${lastParallelSeq + 1}, got ${directSeq} (${directApptNum})`);

// Next clinic visit continues immediately after direct booking
const nextVisit = await call('POST', '/clinic/visits', {
  patient: {
    name: 'Follow-up Patient',
    phone: `96${String(Date.now()).slice(-8)}`,
    age: 44,
    gender: 'Male',
  },
  visitDate: new Date().toISOString().slice(0, 10),
  symptoms: 'Checkup',
  diagnosis: 'Healthy',
  recordedBy: 'Nurse Alice',
}, docToken);

check('clinic visit continues immediately after direct booking', nextVisit.status === 201 && parseSeq(nextVisit.data.visit?.appointmentNumber) === directSeq + 1,
  `Expected ${directSeq + 1}, got ${parseSeq(nextVisit.data.visit?.appointmentNumber)} (${nextVisit.data.visit?.appointmentNumber})`);

console.log(`\n========================================`);
console.log(`Appointment Numbering Test: ${passed} passed, ${failed} failed`);
console.log(`========================================\n`);

process.exit(failed ? 1 : 0);
