// End-to-end API smoke test. Start the server first (npm run dev), then: npm run test:api
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
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.log(`  ✗ ${name} ${extra}`); }
}

const stamp = Date.now();
// pick a random future day so the test can be re-run without slot clashes
const tomorrow = new Date(Date.now() + (1 + (stamp % 300)) * 86400000).toISOString();

console.log('Auth');
const admin = await call('POST', '/auth/login', { identifier: 'admin@carevia.com', password: 'Admin@123', role: 'admin' });
check('admin login', admin.status === 200 && admin.data.token, JSON.stringify(admin.data));
const wrongRole = await call('POST', '/auth/login', { identifier: 'admin@carevia.com', password: 'Admin@123', role: 'patient' });
check('role mismatch rejected', wrongRole.status === 403);
const badPw = await call('POST', '/auth/login', { identifier: 'admin@carevia.com', password: 'nope' });
check('wrong password rejected', badPw.status === 401);
const reg = await call('POST', '/auth/register', { name: 'Test Patient', identifier: `p${stamp}@test.com`, password: 'secret12', role: 'patient' });
check('patient register', reg.status === 201 && reg.data.user.role === 'patient', JSON.stringify(reg.data));
const dup = await call('POST', '/auth/register', { name: 'Again', identifier: `p${stamp}@test.com`, password: 'secret12' });
check('duplicate register rejected', dup.status === 409);
const P = reg.data.token;
const me = await call('GET', '/auth/me', null, P);
check('auth/me', me.data.user?.name === 'Test Patient');
const noAuth = await call('GET', '/appointments');
check('protected route needs token', noAuth.status === 401);

console.log('Providers (test doctors are created through the real onboarding flow)');
const A0 = admin.data.token;
const WEEK = Object.fromEntries(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => [d, ['10:00 AM', '11:00 AM', '02:00 PM', '04:00 PM']]));
async function makeDoctor(name, email) {
  const r = await call('POST', '/auth/register', { name, identifier: email, password: 'Doctor@123', role: 'doctor' });
  const o = await call('POST', '/providers/onboarding', {
    name, profession: 'MBBS Doctor', specialization: 'General Physician', experience: 12, languages: 'English, Tamil',
    onlineFee: 400, clinicFee: 600, city: 'Chennai', state: 'Tamil Nadu', schedule: WEEK,
    bank: { holderName: name, bankName: 'SBI', accountNumber: '123412341234', ifsc: 'SBIN0001234' },
  }, r.data.token);
  await call('PATCH', `/providers/${o.data.provider.id}/status`, { status: 'ACTIVE' }, A0);
  return { token: r.data.token, id: o.data.provider.id };
}
const docA = await makeDoctor(`Dr. Test Ramesh ${stamp}`, `ramesh${stamp}@test.com`);
const docB = await makeDoctor(`Dr. Test Other ${stamp}`, `other${stamp}@test.com`);
const list = await call('GET', '/providers');
check('public provider list (active only)', list.data.providers?.length > 0 && list.data.providers.every((p) => p.status === 'ACTIVE'));
const ramesh = list.data.providers.find((p) => p.id === docA.id);
check('provider shape has id/exp/loc/fees', ramesh && ramesh.id && ramesh.exp === '12 Years' && ramesh.loc === 'Chennai' && ramesh.onlineFee === 400);

console.log('Booking');
const book = await call('POST', '/appointments', { providerId: ramesh.id, date: tomorrow, time: '10:00 AM', consultationType: 'online', paymentMethod: 'gpay' }, P);
check('patient books online appointment', book.status === 201 && book.data.appointment.fee === 400 && book.data.appointment.paymentStatus === 'Paid', JSON.stringify(book.data));
const clash = await call('POST', '/appointments', { providerId: ramesh.id, date: tomorrow, time: '10:00 AM', consultationType: 'online' }, P);
check('double booking same slot rejected', clash.status === 409);
const guest = await call('POST', '/appointments', { providerId: ramesh.id, date: tomorrow, time: '11:00 AM', consultationType: 'clinic' });
check('guest clinic booking (pay at visit)', guest.status === 201 && guest.data.appointment.fee === 600 && guest.data.appointment.paymentStatus === 'Pending');
const past = await call('POST', '/appointments', { providerId: ramesh.id, date: '2020-01-01', time: '10:00 AM' }, P);
check('past date rejected', past.status === 400);
const mine = await call('GET', '/appointments', null, P);
check('patient sees only own appointments', mine.data.appointments?.length === 1);
const apptId = book.data.appointment.id;

console.log('Doctor');
const doc = await call('POST', '/auth/login', { identifier: `ramesh${stamp}@test.com`, password: 'Doctor@123', role: 'doctor' });
check('doctor login', doc.status === 200 && doc.data.user.providerId === ramesh.id);
const D = doc.data.token;
const docList = await call('GET', '/appointments?scope=upcoming', null, D);
check('doctor sees new booking', docList.data.appointments?.some((a) => a.id === apptId));
const resch = await call('PATCH', `/appointments/${apptId}/reschedule`, { date: 'Thu, May 22', time: '04:00 PM' }, D);
check('doctor reschedules', resch.status === 200 && resch.data.appointment.time === '04:00 PM - Rescheduled', JSON.stringify(resch.data));
const done = await call('PATCH', `/appointments/${apptId}/complete`, { symptoms: 'Cough', prescription: 'Rest', bloodPressure: '124/82', weight: 70 }, D);
check('visit vitals saved', done.data.appointment?.visitNotes?.bloodPressure === '124/82' && done.data.appointment.visitNotes.weight === 70);
check('doctor completes visit with notes', done.data.appointment?.status === 'Completed' && done.data.appointment.visitNotes.prescription === 'Rest');
const patientComplete = await call('PATCH', `/appointments/${apptId}/complete`, {}, P);
check('patient cannot complete visit', patientComplete.status === 403);
const foreign = await call('PATCH', `/appointments/${apptId}/cancel`, null, docB.token);
check("other doctor can't touch appointment", foreign.status === 403);

console.log('Reviews');
const rev = await call('POST', '/reviews', { appointmentId: apptId, rating: 4, comment: 'Helpful doctor' }, P);
check('patient reviews completed visit', rev.status === 201, JSON.stringify(rev.data));
const rev2 = await call('POST', '/reviews', { appointmentId: apptId, rating: 5 }, P);
check('only one review per visit', rev2.status === 409);
const provReviews = await call('GET', `/reviews?providerId=${ramesh.id}`);
check('provider reviews + distribution', provReviews.data.reviews?.some((r) => r.comment === 'Helpful doctor') && provReviews.data.summary?.distribution?.length === 5);
const rated = await call('GET', `/providers/${ramesh.id}`);
check('provider rating updated from reviews', Number(rated.data.provider.reviews) >= 1);

console.log('Patient cancel');
const b2 = await call('POST', '/appointments', { providerId: ramesh.id, date: tomorrow, time: '02:00 PM', consultationType: 'online', paymentMethod: 'upi' }, P);
const cancel = await call('PATCH', `/appointments/${b2.data.appointment.id}/cancel`, null, P);
check('patient cancels paid booking -> refunded', cancel.data.appointment?.status === 'Cancelled' && cancel.data.appointment.paymentStatus === 'Refunded');

console.log('Onboarding & approval');
const docReg = await call('POST', '/auth/register', { name: 'Dr. New', identifier: `d${stamp}@test.com`, password: 'secret12', role: 'doctor' });
const N = docReg.data.token;
const onboard = await call('POST', '/providers/onboarding', {
  name: 'Dr. New Physio', profession: 'Physiotherapist', specialization: 'Sports Physiotherapy', experience: 7, languages: 'English, Tamil',
  homeFee: 900, onlineFee: 500, clinicFee: 700, city: 'Chennai', state: 'Tamil Nadu',
  bank: { holderName: 'Dr New', bankName: 'HDFC', accountNumber: '123456789012', ifsc: 'hdfc0001234' },
  schedule: { Mon: ['09:00 AM'], Tue: [] },
}, N);
check('doctor onboarding -> live immediately', onboard.status === 201 && onboard.data.provider.status === 'ACTIVE' && onboard.data.provider.spec === 'Physiotherapist', JSON.stringify(onboard.data));
check('bank account number is masked', onboard.data.provider?.bank?.accountLast4 === '9012' && !onboard.data.provider.bank.accountNumber);
const newId = onboard.data.provider.id;
const shown = await call('GET', '/providers');
check('newly registered doctor appears in patient Find Doctors list', shown.data.providers.some((p) => p.id === newId));
const A = admin.data.token;
const rej = await call('PATCH', `/providers/${newId}/status`, { status: 'REJECTED' }, A);
const hidden = await call('GET', '/providers');
check('admin can still reject -> hidden from patients', rej.data.provider?.status === 'REJECTED' && !hidden.data.providers.some((p) => p.id === newId));
const all = await call('GET', '/providers?status=ALL', null, A);
check('admin still sees rejected provider', all.data.providers.some((p) => p.id === newId && p.status === 'REJECTED'));
const approve = await call('PATCH', `/providers/${newId}/status`, { status: 'ACTIVE' }, A);
check('admin re-approves provider', approve.data.provider?.status === 'ACTIVE');
const visible = await call('GET', '/providers?spec=Physiotherapist');
check('approved provider bookable', visible.data.providers.some((p) => p.id === newId));
const edit = await call('PUT', `/providers/${newId}`, { experience: 9, city: 'Coimbatore' }, A);
check('admin edits provider', edit.data.provider?.exp === '9 Years' && edit.data.provider.loc === 'Coimbatore');
const notAdmin = await call('PATCH', `/providers/${newId}/status`, { status: 'REJECTED' }, P);
check('patient cannot approve providers', notAdmin.status === 403);

console.log('Admin');
const stats = await call('GET', '/admin/stats', null, A);
check('dashboard stats', stats.data.stats?.patients >= 1 && stats.data.revenueSeries?.length === 7 && stats.data.recentAppointments?.length > 0, JSON.stringify(stats.data).slice(0, 300));
const pats = await call('GET', '/admin/patients', null, A);
const tp = pats.data.patients?.find((p) => p.email === `p${stamp}@test.com`);
check('patients list with appointment count', tp && tp.appointments === 2);
const pd = await call('GET', `/admin/patients/${tp.id}`, null, A);
check('patient detail with history', pd.data.appointments?.length === 2 && pd.data.payments?.length >= 2);
const pays = await call('GET', '/admin/payments', null, A);
check('payments list', pays.data.payments?.length > 0);
const successPay = pays.data.payments.find((p) => p.type === 'Payment' && p.status === 'Success');
const refund = await call('POST', `/admin/payments/${successPay.id}/refund`, null, A);
check('admin refund', refund.data.payment?.status === 'Refunded' && refund.data.refund?.type === 'Refund');
const payouts = await call('GET', '/admin/payouts', null, A);
check('provider payouts', Array.isArray(payouts.data.payouts) && typeof payouts.data.summary?.pending === 'number');
const due = payouts.data.payouts.find((p) => p.pending > 0);
if (due) {
  const paid = await call('POST', `/admin/payouts/${due.providerId}`, null, A);
  check('process payout', paid.status === 201 && paid.data.payout.amount === due.pending, JSON.stringify(paid.data));
  const again = await call('POST', `/admin/payouts/${due.providerId}`, null, A);
  check('no double payout', again.status === 400);
}
const adminProviders = await call('GET', '/providers?status=ALL', null, A);
check('admin provider list has booking counts', typeof adminProviders.data.providers?.[0]?.bookings === 'number');
const refunds = await call('GET', '/admin/payments?type=Refund', null, A);
check('refunds have a reason', refunds.data.payments?.length > 0 && refunds.data.payments.every((r) => r.note));
const growthStats = await call('GET', '/admin/stats', null, A);
check('stats include growth', typeof growthStats.data.growth?.patients === 'number');
const upd = await call('PATCH', `/admin/patients/${tp.id}`, { status: 'Inactive', age: 30 }, A);
check('admin updates patient', upd.data.patient?.status === 'Inactive' && upd.data.patient.age === 30);
const blocked = await call('GET', '/auth/me', null, P);
check('inactive patient is blocked', blocked.status === 403);
const sp = await call('POST', '/specializations', { name: `Spec ${stamp}`, icon: 'Heart' }, A);
check('create specialization', sp.status === 201);
const spDel = await call('DELETE', `/specializations/${sp.data.specialization.id}`, null, A);
check('delete specialization', spDel.status === 200);
const svc = await call('GET', '/services');
check('services with live booking counts', svc.data.services?.length >= 6 && typeof svc.data.services[0].bookings === 'number');

console.log('Content & emergency');
const jobs = await call('GET', '/content/jobs');
check('job openings from DB', jobs.data.items?.length >= 1);
const testi = await call('GET', '/content/testimonials');
check('testimonials from DB', testi.data.items?.length >= 1);
const saved = await call('PUT', '/content/cities', { items: [...(await call('GET', '/content/cities')).data.items] }, A);
check('admin can update content', saved.status === 200);
const notAdminContent = await call('PUT', '/content/cities', { items: [] }, P);
check('non-admin cannot edit content', notAdminContent.status === 403);
const em = await call('POST', '/emergency', { patientName: 'Urgent Person', phone: '9876543210', location: 'Chennai', priority: 'CRITICAL' });
check('emergency request created', em.status === 201 && /EMR-/.test(em.data.request.code));
const emAssign = await call('PATCH', `/emergency/${em.data.request.id}`, { providerId: ramesh.id }, A);
check('admin assigns emergency', emAssign.data.request?.status === 'Assigned' && emAssign.data.request.provider === ramesh.name);
const emList = await call('GET', '/emergency', null, A);
check('admin lists emergencies', emList.data.requests?.length >= 1);
const medical = await call('PATCH', `/admin/patients/${tp.id}`, { bloodGroup: 'B+', allergies: 'Dust, Pollen', emergencyContact: { name: 'Mom', phone: '9000000000' } }, A);
check('patient medical info saved', medical.data.patient?.bloodGroup === 'B+' && medical.data.patient.allergies?.length === 2);

const pub = await call('GET', '/public/stats');
check('public stats', pub.data.stats?.providers >= 1 && typeof pub.data.stats.patientsServed === 'number' && pub.data.stats.bySpec?.['General Physician']?.providers >= 1);

console.log('Job applications');
const app = await call('POST', '/applications', { name: 'Job Seeker', phone: '9876543210', role: 'Nurse', city: 'Chennai' });
check('submit job application', app.status === 201);
const badApp = await call('POST', '/applications', { name: 'X', phone: '12' });
check('invalid phone rejected', badApp.status === 400);
const apps = await call('GET', '/applications', null, A);
check('admin lists applications', apps.data.applications?.length >= 1);

{
console.log('Enquiries / callback workflow');
const ph = `9${String(Date.now()).slice(-9)}`;
const enq = await call('POST', '/enquiries', { name: 'Lead Person', phone: ph, service: 'Physiotherapy', city: 'Chennai', preferredTime: 'Morning (8am – 12pm)' });
check('create callback request', enq.status === 201 && /^ENQ-\d+$/.test(enq.data.enquiry?.code), JSON.stringify(enq.data));
const dupEnq = await call('POST', '/enquiries', { name: 'Lead Person', phone: ph, service: 'Physiotherapy' });
check('duplicate within 10 minutes is merged', dupEnq.data.duplicate === true && dupEnq.data.enquiry.code === enq.data.enquiry.code);
check('service required for callback', (await call('POST', '/enquiries', { name: 'X', phone: ph })).status === 400);
check('message required for contact', (await call('POST', '/enquiries', { type: 'contact', name: 'X', phone: ph })).status === 400);
check('organisation required for partner', (await call('POST', '/enquiries', { type: 'partner', name: 'X', phone: ph })).status === 400);
check('past preferred date rejected', (await call('POST', '/enquiries', { name: 'X', phone: ph, service: 'BHS', preferredDate: '2020-01-01' })).status === 400);
const tr = await call('GET', `/enquiries/track?code=${enq.data.enquiry.code}&phone=${ph}`);
check('track with code + phone', tr.status === 200 && tr.data.enquiry.status === 'New' && tr.data.enquiry.notes === undefined);
check('track with wrong phone fails', (await call('GET', `/enquiries/track?code=${enq.data.enquiry.code}&phone=9000000000`)).status === 404);
check('enquiry list is admin only', (await call('GET', '/enquiries')).status === 401);
const upd = await call('PATCH', `/enquiries/${enq.data.enquiry.id}`, { status: 'Contacted', note: 'internal', publicNote: 'We called you' }, A);
check('admin updates status + notes', upd.status === 200 && upd.data.enquiry.status === 'Contacted' && upd.data.enquiry.notes.length === 1);
const tr2 = await call('GET', `/enquiries/track?code=${enq.data.enquiry.code}&phone=${ph}`);
check('customer sees public update only', tr2.data.enquiry.timeline.some((t) => t.note === 'We called you') && !JSON.stringify(tr2.data).includes('internal'));
check('bad appointment code rejected', (await call('PATCH', `/enquiries/${enq.data.enquiry.id}`, { appointmentCode: 'APT-NOPE' }, A)).status === 404);
const list = await call('GET', '/enquiries?status=Contacted', null, A);
check('admin filter by status', list.data.enquiries.every((e) => e.status === 'Contacted') && list.data.counts.Contacted >= 1);
const cancelGuest = await call('PATCH', `/enquiries/${enq.data.enquiry.id}/cancel`, { phone: '9000000000' });
check('stranger cannot cancel', cancelGuest.status === 403);
const cancelOwn = await call('PATCH', `/enquiries/${enq.data.enquiry.id}/cancel`, { phone: ph });
check('owner cancels with phone', cancelOwn.status === 200 && cancelOwn.data.enquiry.status === 'Closed');
const statsE = await call('GET', '/admin/stats', null, A);
check('admin stats include enquiry counts', typeof statsE.data.stats.newEnquiries === 'number');
const blog = await call('GET', '/content/blog');
check('blog posts have slug + body', blog.data.items.every((p) => p.slug && Array.isArray(p.body) && p.body.length));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
