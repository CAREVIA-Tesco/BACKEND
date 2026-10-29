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

console.log('\n=== RUNNING ROLE-BASED AUTHENTICATION & PORTAL TEST SUITE ===\n');

// 1. Health check
const health = await req('/health');
check('Server is online and healthy', health.status === 200 && health.data.success);

// 2. Admin Authentication
console.log('\n--- 1. Admin Authentication & Role Enforcement ---');
const adminLogin = await req('/auth/login', {
  method: 'POST',
  body: { identifier: 'admin@carevia.com', password: 'Admin@123', role: 'admin' }
});
check('Admin successfully logs in with role admin', adminLogin.status === 200 && adminLogin.data.user?.role === 'admin');
const adminToken = adminLogin.data.token;

// Admin access to admin-only endpoint
const adminStats = await req('/admin/stats', { token: adminToken });
check('Admin token accesses /api/admin/stats (200 OK)', adminStats.status === 200);

// 3. Doctor Registration & Authentication
console.log('\n--- 2. Doctor Authentication & Role Enforcement ---');
const docEmail = `doc_auth_${Date.now()}@carevia.com`;
const WEEK = Object.fromEntries(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => [d, ['10:00 AM']]));
const docReg = await req('/auth/register', {
  method: 'POST',
  body: {
    name: 'Dr. Portal Test',
    identifier: docEmail,
    password: 'Doctor@123',
    role: 'doctor',
    profile: {
      name: 'Dr. Portal Test',
      profession: 'MBBS Doctor',
      specialization: 'General Physician',
      qualification: 'MBBS, MD',
      experience: 10,
      languages: 'English, Hindi',
      city: 'Chennai',
      state: 'Tamil Nadu',
      pincode: '600001',
      schedule: WEEK,
      clinicFee: 500,
      onlineFee: 300,
      clinic: { name: 'Dr. Portal Clinic', address: '12 Marina Road' },
      aadhaar: { number: '367598342159', photo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' },
      bank: { holderName: 'Dr. Portal Test', bankName: 'HDFC', accountNumber: '123456789012', ifsc: 'HDFC0001234' }
    }
  }
});
check('Doctor account registered', docReg.status === 201 && docReg.data.user?.role === 'doctor');
const docToken = docReg.data.token;

const docLogin = await req('/auth/login', {
  method: 'POST',
  body: { identifier: docEmail, password: 'Doctor@123', role: 'doctor' }
});
check('Doctor successfully logs in with role doctor', docLogin.status === 200 && docLogin.data.user?.role === 'doctor');

const docProfile = await req('/providers/me', { token: docToken });
check('Doctor token accesses /api/providers/me (200 OK)', docProfile.status === 200 && docProfile.data.provider);

// 4. Patient Registration & Authentication
console.log('\n--- 3. Patient Authentication & Retention of Existing System ---');
const patEmail = `pat_auth_${Date.now()}@carevia.com`;
const patReg = await req('/auth/register', {
  method: 'POST',
  body: {
    name: 'Patient Portal Test',
    identifier: patEmail,
    password: 'Patient@123',
    role: 'patient',
    careFor: 'Myself',
    age: 30,
    gender: 'Male',
    city: 'Chennai'
  }
});
check('Patient account registered via existing flow', patReg.status === 201 && patReg.data.user?.role === 'patient');
const patToken = patReg.data.token;

const patLogin = await req('/auth/login', {
  method: 'POST',
  body: { identifier: patEmail, password: 'Patient@123', role: 'patient' }
});
check('Patient logs in with role patient via existing login', patLogin.status === 200 && patLogin.data.user?.role === 'patient');

// 5. Cross-Role Security Rejection Tests
console.log('\n--- 4. Cross-Role Security & Isolation Rejection Tests ---');

// Doctor cannot log in with role: 'admin'
const docAsAdmin = await req('/auth/login', {
  method: 'POST',
  body: { identifier: docEmail, password: 'Doctor@123', role: 'admin' }
});
check('Doctor rejected from admin login (403 Forbidden)', docAsAdmin.status === 403);

// Patient cannot log in with role: 'admin'
const patAsAdmin = await req('/auth/login', {
  method: 'POST',
  body: { identifier: patEmail, password: 'Patient@123', role: 'admin' }
});
check('Patient rejected from admin login (403 Forbidden)', patAsAdmin.status === 403);

// Patient cannot log in with role: 'doctor'
const patAsDoc = await req('/auth/login', {
  method: 'POST',
  body: { identifier: patEmail, password: 'Patient@123', role: 'doctor' }
});
check('Patient rejected from doctor login (403 Forbidden)', patAsDoc.status === 403);

// Admin cannot log in with role: 'doctor'
const adminAsDoc = await req('/auth/login', {
  method: 'POST',
  body: { identifier: 'admin@carevia.com', password: 'Admin@123', role: 'doctor' }
});
check('Admin rejected from doctor login (403 Forbidden)', adminAsDoc.status === 403);

// Doctor cannot access Admin Dashboard API
const docAccessAdminApi = await req('/admin/stats', { token: docToken });
check('Doctor token denied access to /api/admin/stats (403 Forbidden)', docAccessAdminApi.status === 403);

// Patient cannot access Admin Dashboard API
const patAccessAdminApi = await req('/admin/stats', { token: patToken });
check('Patient token denied access to /api/admin/stats (403 Forbidden)', patAccessAdminApi.status === 403);

// Patient cannot access Doctor Provider API
const patAccessDocApi = await req('/providers/me', { token: patToken });
check('Patient token denied access to /api/providers/me (403 Forbidden)', patAccessDocApi.status === 403);

// Unauthorized (no token) access to admin API
const unauthAdminApi = await req('/admin/stats');
check('Unauthenticated request denied access to /api/admin/stats (401 Unauthorized)', unauthAdminApi.status === 401);

// Unauthorized (no token) access to doctor API
const unauthDocApi = await req('/providers/me');
check('Unauthenticated request denied access to /api/providers/me (401 Unauthorized)', unauthDocApi.status === 401);

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('All Role-Based Authentication & Portal Security tests PASSED successfully!\n');
  process.exit(0);
}
