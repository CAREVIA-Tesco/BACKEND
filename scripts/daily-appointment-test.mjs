// Rigorous end-to-end verification of Daily Doctor-Wise Appointment Numbering,
// Reset at 12:00 AM IST, Common Sequence across Link & Manual, Concurrency,
// Search by Patient Name & Appointment Number, and Date-Wise Reports.

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

console.log('--- 1. Authenticate Admin and Register Two Independent Doctors ---');
const admin = await call('POST', '/auth/login', { identifier: 'admin@carevia.com', password: 'Admin@123', role: 'admin' });
check('admin login successful', admin.status === 200 && admin.data.token);
const adminToken = admin.data.token;

async function registerDoc(name, email) {
  const reg = await call('POST', '/auth/register', {
    name,
    identifier: email,
    password: 'Doctor@123',
    role: 'doctor',
    profile: {
      name,
      profession: 'MBBS Doctor',
      specialization: 'General Physician',
      qualification: 'MBBS, MD',
      experience: 12,
      languages: 'English, Hindi',
      onlineFee: 400,
      clinicFee: 600,
      city: 'Delhi',
      pincode: '110001',
      state: 'Delhi',
      schedule: WEEK,
      clinic: { name: `${name} Clinic`, address: '88 Ring Road' },
      aadhaar: { number: '367598342159', photo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' },
      bank: { holderName: name, bankName: 'SBI', accountNumber: '123456789012', ifsc: 'SBIN0001234' },
    },
  });
  const token = reg.data.token;
  const pId = reg.data.provider?._id || reg.data.provider?.id || reg.data.user?.providerId;
  await call('PATCH', `/providers/${pId}/status`, { status: 'ACTIVE' }, adminToken);
  return { token, providerId: pId, name };
}

const docA = await registerDoc(`Dr. Alpha ${stamp}`, `alpha${stamp}@carevia.com`);
const docB = await registerDoc(`Dr. Beta ${stamp}`, `beta${stamp}@carevia.com`);
check('Doctor A registered & activated', Boolean(docA.token && docA.providerId));
check('Doctor B registered & activated', Boolean(docB.token && docB.providerId));

console.log('\n--- 2. Common Numbering on Doctor A: Link -> Manual -> Link -> Manual ---');
// Patient 1: Registers through shared link on Doctor A
const link1 = await call('POST', '/clinic/registration-links', {
  patientName: 'Patient One (Link)',
  patientPhone: `98${String(Date.now()).slice(-8)}`,
  recordedBy: 'Nurse Alice',
}, docA.token);
check('generated registration link 1', link1.status === 201 && link1.data.link?.token);

const sub1 = await call('POST', `/clinic/public/register/${link1.data.link.token}`, {
  name: 'Patient One (Link)',
  phone: `98${String(Date.now()).slice(-8)}`,
  age: 28,
  gender: 'Female',
  symptoms: 'Migraine and nausea',
});
check('patient 1 submitted via link (received 201)', sub1.status === 201);
check('patient 1 appointment number is 001', sub1.data.appointmentNumber === '001', `Got: ${sub1.data.appointmentNumber}`);
check('patient 1 confirmation message shows Appointment Number 001',
  sub1.data.message?.includes('Your Appointment Number is 001'), `Message: ${sub1.data.message}`);

// Patient 2: Nurse manually adds patient on Doctor A
const man2 = await call('POST', '/clinic/visits', {
  patient: {
    name: 'Patient Two (Manual)',
    phone: `97${String(Date.now()).slice(-8)}`,
    age: 45,
    gender: 'Male',
  },
  visitDate: new Date().toISOString().slice(0, 10),
  symptoms: 'Fever and chills',
  diagnosis: 'Malaria',
  recordedBy: 'Nurse Alice',
}, docA.token);
check('nurse manually added patient 2', man2.status === 201);
check('patient 2 appointment number is 002', man2.data.appointmentNumber === '002', `Got: ${man2.data.appointmentNumber}`);

// Patient 3: Registers through shared link on Doctor A
const link3 = await call('POST', '/clinic/registration-links', {
  patientName: 'Patient Three (Link)',
  patientPhone: `96${String(Date.now()).slice(-8)}`,
  recordedBy: 'Nurse Alice',
}, docA.token);
const sub3 = await call('POST', `/clinic/public/register/${link3.data.link.token}`, {
  name: 'Patient Three (Link)',
  phone: `96${String(Date.now()).slice(-8)}`,
  age: 32,
  gender: 'Female',
  symptoms: 'Cough and throat irritation',
});
check('patient 3 submitted via link', sub3.status === 201);
check('patient 3 appointment number is 003', sub3.data.appointmentNumber === '003', `Got: ${sub3.data.appointmentNumber}`);

// Patient 4: Nurse manually adds patient on Doctor A
const man4 = await call('POST', '/clinic/visits', {
  patient: {
    name: 'Patient Four (Manual)',
    phone: `95${String(Date.now()).slice(-8)}`,
    age: 50,
    gender: 'Female',
  },
  visitDate: new Date().toISOString().slice(0, 10),
  symptoms: 'Back pain',
  diagnosis: 'Lumbar Strain',
  recordedBy: 'Nurse Alice',
}, docA.token);
check('nurse manually added patient 4', man4.status === 201);
check('patient 4 appointment number is 004', man4.data.appointmentNumber === '004', `Got: ${man4.data.appointmentNumber}`);

console.log('\n--- 3. Doctor-Wise Independence: Doctor B Starts from 001 on the Same Date ---');
// Doctor B receives a registration on the same day
const linkB = await call('POST', '/clinic/registration-links', {
  patientName: 'Patient Beta 1',
  patientPhone: `94${String(Date.now()).slice(-8)}`,
  recordedBy: 'Nurse Bob',
}, docB.token);
const subB = await call('POST', `/clinic/public/register/${linkB.data.link.token}`, {
  name: 'Patient Beta 1',
  phone: `94${String(Date.now()).slice(-8)}`,
  age: 22,
  gender: 'Male',
  symptoms: 'Sports injury sprain',
});
check('Doctor B patient registered', subB.status === 201);
check('Doctor B starts from 001 independently (not continuing Doctor A sequence)',
  subB.data.appointmentNumber === '001', `Got: ${subB.data.appointmentNumber}`);

console.log('\n--- 4. Daily Reset: Next Day Sequence Automatically Starts at 001 ---');
// Add a visit for Doctor A on tomorrow's date
const tomorrowStr = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const tomVisit = await call('POST', '/clinic/visits', {
  patient: {
    name: 'Tomorrow Patient',
    phone: `93${String(Date.now()).slice(-8)}`,
    age: 38,
    gender: 'Male',
  },
  visitDate: tomorrowStr,
  symptoms: 'Follow-up consultation',
  diagnosis: 'Routine Checkup',
  recordedBy: 'Nurse Alice',
}, docA.token);
check('visit recorded on next date', tomVisit.status === 201);
check('appointment number resets to 001 on the next date',
  tomVisit.data.appointmentNumber === '001', `Expected 001 on ${tomorrowStr}, got: ${tomVisit.data.appointmentNumber}`);

// Second patient on tomorrow gets 002
const tomVisit2 = await call('POST', '/clinic/visits', {
  patient: {
    name: 'Tomorrow Patient Two',
    phone: `92${String(Date.now()).slice(-8)}`,
    age: 41,
    gender: 'Female',
  },
  visitDate: tomorrowStr,
  symptoms: 'Allergy testing',
  diagnosis: 'Seasonal Allergy',
  recordedBy: 'Nurse Alice',
}, docA.token);
check('second patient on next date receives 002',
  tomVisit2.data.appointmentNumber === '002', `Got: ${tomVisit2.data.appointmentNumber}`);

console.log('\n--- 5. Concurrency Test: 5 Simultaneous Submissions on Doctor A ---');
const batchLinks = [];
for (let i = 1; i <= 5; i++) {
  const l = await call('POST', '/clinic/registration-links', {
    patientName: `Parallel Patient ${i}`,
    patientPhone: `910000000${i}`,
    recordedBy: 'Nurse Alice',
  }, docA.token);
  batchLinks.push(l);
}
check('all 5 concurrent test links generated', batchLinks.every((l) => l.status === 201));

const parallelSubmissions = await Promise.all(batchLinks.map((l, i) =>
  call('POST', `/clinic/public/register/${l.data.link.token}`, {
    name: `Parallel Patient ${i + 1}`,
    phone: `910000000${i + 1}`,
    age: 26 + i,
    gender: i % 2 === 0 ? 'Male' : 'Female',
    symptoms: `Simultaneous test symptoms ${i + 1}`,
  })
));

const parallelNumbers = parallelSubmissions.map((s) => s.data.appointmentNumber);
const uniqueParallel = new Set(parallelNumbers);
check('all 5 concurrent submissions succeeded', parallelSubmissions.every((s) => s.status === 201));
check('no duplicate appointment numbers under concurrency (all 5 unique)',
  uniqueParallel.size === 5, `Got: ${parallelNumbers.join(', ')}`);

// Doctor A had 4 visits today (001-004), so these 5 should be 005, 006, 007, 008, 009
const sortedNumbers = [...parallelNumbers].sort();
check('concurrent numbers continue contiguous sequence 005 to 009',
  JSON.stringify(sortedNumbers) === JSON.stringify(['005', '006', '007', '008', '009']),
  `Got: ${sortedNumbers.join(', ')}`);

console.log('\n--- 6. Doctor Dashboard Search Bar: Patient Name and Appointment Number ---');
// Search by Patient Name
const nameSearch = await call('GET', '/clinic/visits?search=Patient%20One', null, docA.token);
check('search by patient name returns matching visit',
  nameSearch.status === 200 && nameSearch.data.visits?.some((v) => v.appointmentNumber === '001'));

// Search by Appointment Number: "001"
const apptSearch = await call('GET', '/clinic/visits?search=001', null, docA.token);
check('search by appointment number "001" returns appointment 001',
  apptSearch.status === 200 && apptSearch.data.visits?.some((v) => v.appointmentNumber === '001'));

// Search by Appointment Number: "1" (single digit query)
const singleDigitSearch = await call('GET', '/clinic/visits?search=1', null, docA.token);
check('search by appointment number "1" finds appointment 001',
  singleDigitSearch.status === 200 && singleDigitSearch.data.visits?.some((v) => v.appointmentNumber === '001'));

// Patient List Search by Appointment Number
const patientApptSearch = await call('GET', '/clinic/patients?search=003', null, docA.token);
check('patient search by appointment number "003" returns Patient Three',
  patientApptSearch.status === 200 && patientApptSearch.data.patients?.some((p) => p.name === 'Patient Three (Link)'));

console.log('\n--- 7. Date-Wise Filtering & Counts in Doctor Dashboard and Admin Panel ---');
const todayStr = new Date().toISOString().slice(0, 10);
const todayVisitsDoc = await call('GET', `/clinic/visits?from=${todayStr}&to=${todayStr}`, null, docA.token);
check('doctor dashboard date filter returns today visits (9 total: 4 alternating + 5 parallel)',
  todayVisitsDoc.status === 200 && todayVisitsDoc.data.visits?.length === 9);

const tomVisitsDoc = await call('GET', `/clinic/visits?from=${tomorrowStr}&to=${tomorrowStr}`, null, docA.token);
check('doctor dashboard date filter returns tomorrow visits (2 total)',
  tomVisitsDoc.status === 200 && tomVisitsDoc.data.visits?.length === 2);

const reportDoc = await call('GET', `/clinic/report?from=${todayStr}&to=${tomorrowStr}`, null, docA.token);
check('doctor report includes separate daily counts for each date',
  reportDoc.status === 200 &&
  reportDoc.data.daily?.find((d) => d.date === todayStr)?.visits === 9 &&
  reportDoc.data.daily?.find((d) => d.date === tomorrowStr)?.visits === 2
);

const adminReportDoc = await call('GET', `/admin/clinic/report?from=${todayStr}&to=${tomorrowStr}&providerId=${docA.providerId}`, null, adminToken);
check('admin panel report displays date-wise appointment counts for doctor',
  adminReportDoc.status === 200 &&
  adminReportDoc.data.daily?.find((d) => d.date === todayStr)?.visits === 9 &&
  adminReportDoc.data.daily?.find((d) => d.date === tomorrowStr)?.visits === 2
);

console.log(`\n========================================`);
console.log(`Daily Appointment Numbering Test: ${passed} passed, ${failed} failed`);
console.log(`========================================\n`);

process.exit(failed ? 1 : 0);
