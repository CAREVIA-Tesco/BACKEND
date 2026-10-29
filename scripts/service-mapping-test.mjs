// Automated test for Dynamic Services Mapping between Admin and Professional Onboarding
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

console.log('\n--- 1. Testing Catalog Services Filtering by Profession ---');
const adminLogin = await call('POST', '/auth/login', {
  identifier: 'admin@carevia.com',
  password: 'Admin@123',
  role: 'admin',
});
check('Admin logged in successfully', adminLogin.status === 200 && adminLogin.data.token);
const adminToken = adminLogin.data.token;

// Test MBBS Doctor filter
const mbbsServices = await call('GET', '/services?profession=MBBS Doctor');
check('MBBS Doctor services retrieved', mbbsServices.status === 200 && Array.isArray(mbbsServices.data.services));
const mbbsNames = (mbbsServices.data.services || []).map((s) => s.name);
check('MBBS services include Doctor Visit / Home Doctor', mbbsNames.some((n) => /Doctor Visit|Home Doctor/i.test(n)));
check('MBBS services do NOT include Caretaker Service', !mbbsNames.some((n) => /Caretaker Service/i.test(n)));

// Test Physiotherapist filter
const physioServices = await call('GET', '/services?profession=Physiotherapist');
check('Physiotherapist services retrieved', physioServices.status === 200 && Array.isArray(physioServices.data.services));
const physioNames = (physioServices.data.services || []).map((s) => s.name);
check('Physiotherapist services include Physiotherapy', physioNames.some((n) => /Physiotherapy/i.test(n)));
check('Physiotherapist services do NOT include Lab Tests', !physioNames.some((n) => /Lab Test/i.test(n)));

console.log('\n--- 2. Testing Admin Adding a New Service With Profession Mapping ---');
const customServiceName = `Neuro Rehab Test ${stamp}`;
const createServiceRes = await call(
  'POST',
  '/services',
  {
    name: customServiceName,
    category: 'Therapy',
    professions: ['Physiotherapist'],
    price: 1800,
    shortDescription: 'Advanced neuro-rehabilitation therapy sessions',
    homeVisitAvailable: true,
    onlineConsultationAvailable: false,
    status: 'Active',
  },
  adminToken
);
const newServiceId = createServiceRes.data.service?.id || createServiceRes.data.service?._id;
check('Admin created new service with professions', createServiceRes.status === 201 && !!newServiceId, JSON.stringify(createServiceRes.data));

// Check that Physiotherapist now automatically sees the new service
const updatedPhysioServices = await call('GET', '/services?profession=Physiotherapist');
const hasNewService = (updatedPhysioServices.data.services || []).some((s) => s.name === customServiceName);
check('New service dynamically appears in Physiotherapist services list', hasNewService);

// Check that MBBS Doctor does NOT see the new Physiotherapy service
const updatedMbbsServices = await call('GET', '/services?profession=MBBS Doctor');
const mbbsHasPhysioService = (updatedMbbsServices.data.services || []).some((s) => s.name === customServiceName);
check('New Physiotherapist service is NOT shown to MBBS Doctor', !mbbsHasPhysioService);

console.log('\n--- 3. Testing Validation of Mismatched Services on Registration ---');
// An MBBS Doctor tries to register offering "Neuro Rehab Test" (which is Physiotherapist-only)
const invalidDoctorRegister = await call('POST', '/auth/register', {
  name: `Dr. Invalid ${stamp}`,
  identifier: `invalid${stamp}@test.com`,
  password: 'Doctor@123',
  role: 'doctor',
  profile: {
    name: `Dr. Invalid ${stamp}`,
    profession: 'MBBS Doctor',
    specialization: 'General Physician',
    qualification: 'MBBS',
    experience: 5,
    registrationNumber: 'MCI-12345',
    registrationCouncil: 'Medical Council of India',
    city: 'Chennai',
    state: 'Tamil Nadu',
    pincode: '600001',
    aadhaar: { number: '367598342159', photo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' },
    bank: { holderName: `Dr. Invalid ${stamp}`, bankName: 'SBI', accountNumber: '123412341234', ifsc: 'SBIN0001234' },
    servicesOffered: [customServiceName],
    services: [
      {
        serviceId: newServiceId,
        name: customServiceName,
        price: 2000,
      },
    ],
  },
});
check(
  'Registration fails when selecting service unrelated to profession (400 Bad Request)',
  invalidDoctorRegister.status === 400 && /not available for profession/i.test(invalidDoctorRegister.data.message || ''),
  `Status: ${invalidDoctorRegister.status}, error: ${JSON.stringify(invalidDoctorRegister.data)}`
);

console.log('\n--- 4. Testing Successful Professional Registration with Valid Services ---');
const validPhysioRegister = await call('POST', '/auth/register', {
  name: `Dr. Valid Physio ${stamp}`,
  identifier: `physio${stamp}@test.com`,
  password: 'Doctor@123',
  role: 'doctor',
  profile: {
    name: `Dr. Valid Physio ${stamp}`,
    profession: 'Physiotherapist',
    specialization: 'Neuro Physiotherapist',
    qualification: 'BPT, MPT',
    experience: 8,
    languages: 'English, Tamil',
    registrationNumber: 'IAP-67890',
    registrationCouncil: 'Indian Association of Physiotherapists',
    city: 'Chennai',
    state: 'Tamil Nadu',
    pincode: '600001',
    onlineFee: 800,
    clinicFee: 1200,
    aadhaar: { number: '367598342159', photo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' },
    bank: { holderName: `Dr. Valid Physio ${stamp}`, bankName: 'SBI', accountNumber: '123412341234', ifsc: 'SBIN0001234' },
    servicesOffered: [customServiceName],
    services: [
      {
        serviceId: newServiceId,
        name: customServiceName,
        price: 1750,
        description: 'Specialized at-home neurological rehabilitation.',
        homeAvailable: true,
        onlineAvailable: false,
        clinicAvailable: true,
      },
    ],
  },
});
check('Physiotherapist registered with valid profession service', validPhysioRegister.status === 201, JSON.stringify(validPhysioRegister.data));
const providerId =
  validPhysioRegister.data.provider?._id ||
  validPhysioRegister.data.provider?.id ||
  validPhysioRegister.data.user?.providerId;
check('Provider ID exists', !!providerId);

console.log('\n--- 5. Testing Profile Display & Active Service Listing ---');
// Approve provider
const approveRes = await call('PATCH', `/providers/${providerId}/status`, { status: 'ACTIVE' }, adminToken);
check('Admin approved provider profile', approveRes.status === 200);

// Public profile endpoint
const publicProfile = await call('GET', `/providers/${providerId}`);
check('Public provider profile fetched', publicProfile.status === 200 && publicProfile.data.provider);
const providerServices = publicProfile.data.provider?.services || [];
check('Provider public profile contains configured service', providerServices.some((s) => s.name === customServiceName));
const configuredService = providerServices.find((s) => s.name === customServiceName);
check('Custom service price is preserved (₹1750)', configuredService?.price === 1750);
check('Custom service description preserved', configuredService?.description?.includes('Specialized'));

console.log('\n--- 6. Testing Inactive Service Dynamic Filtering ---');
// Admin sets service to Inactive
const deactivateRes = await call(
  'PATCH',
  `/services/${newServiceId}`,
  {
    status: 'Inactive',
  },
  adminToken
);
check('Admin marked service as Inactive', deactivateRes.status === 200 && deactivateRes.data.service?.status === 'Inactive');

// Public profile should dynamically exclude the inactive service without breaking the provider
const publicProfileAfterDisable = await call('GET', `/providers/${providerId}`);
const activeServicesNow = publicProfileAfterDisable.data.provider?.services || [];
check(
  'Provider public profile dynamically excludes inactive service',
  !activeServicesNow.some((s) => s.name === customServiceName)
);

console.log('\n--- 7. Cleanup ---');
// Delete test service
const deleteRes = await call('DELETE', `/services/${newServiceId}`, null, adminToken);
check('Test service cleaned up', deleteRes.status === 200);

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('All Dynamic Service Mapping tests PASSED!\n');
}
