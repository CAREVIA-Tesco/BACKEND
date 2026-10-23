import User from '../models/User.js';
import Provider from '../models/Provider.js';
import Appointment from '../models/Appointment.js';
import Payment from '../models/Payment.js';
import Enquiry from '../models/Enquiry.js';
import JobApplication from '../models/JobApplication.js';
import { ApiError, asyncHandler } from '../middleware/error.js';
import { shortDate } from '../utils/format.js';
import { linkGuestRecords } from './authController.js';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

// GET /api/admin/stats – everything the admin dashboard needs in one call
export const dashboardStats = asyncHandler(async (_req, res) => {
  const today = startOfToday();
  const tomorrow = new Date(today.getTime() + 86400000);
  const sevenMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 6, 1);

  const [
    patients, providers, activeProviders, pendingProviders, rejectedProviders,
    appointments, consultations, byStatus, rescheduled, revenueAgg, todayRevenueAgg,
    pendingAgg, refundAgg, successCount, monthly, recent, todayAppointments,
  ] = await Promise.all([
    User.countDocuments({ role: 'patient' }),
    Provider.countDocuments(),
    Provider.countDocuments({ status: 'ACTIVE' }),
    Provider.countDocuments({ status: 'PENDING' }),
    Provider.countDocuments({ status: { $in: ['REJECTED', 'SUSPENDED'] } }),
    Appointment.countDocuments(),
    Appointment.countDocuments({ consultationType: 'online' }),
    Appointment.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Appointment.countDocuments({ rescheduled: true, status: { $in: ['Waiting', 'Confirmed'] } }),
    Payment.aggregate([{ $match: { type: 'Payment', status: { $in: ['Success', 'Refunded'] } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    Payment.aggregate([{ $match: { type: 'Payment', status: 'Success', paidAt: { $gte: today, $lt: tomorrow } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    Payment.aggregate([{ $match: { type: 'Payment', status: 'Pending' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    Payment.aggregate([{ $match: { type: 'Refund' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    Payment.countDocuments({ type: 'Payment', status: 'Success' }),
    Payment.find({ type: 'Payment', status: { $in: ['Success', 'Refunded'] }, paidAt: { $gte: sevenMonthsAgo } }).select('amount paidAt').lean(),
    Appointment.find().sort({ createdAt: -1 }).limit(5),
    Appointment.countDocuments({ scheduledAt: { $gte: today, $lt: tomorrow } }),
  ]);

  const statusCount = Object.fromEntries(byStatus.map((s) => [s._id, s.count]));
  const refunds = refundAgg[0]?.total || 0;
  const totalRevenue = (revenueAgg[0]?.total || 0) - refunds;

  // last 7 months revenue series for the area chart
  const revenueSeries = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const total = monthly
      .filter((p) => p.paidAt.getFullYear() === d.getFullYear() && p.paidAt.getMonth() === d.getMonth())
      .reduce((sum, p) => sum + (p.amount || 0), 0);
    revenueSeries.push({ name: MONTH_NAMES[d.getMonth()], total });
  }

  const upcoming = (statusCount.Waiting || 0) + (statusCount.Confirmed || 0);
  const pct = (n) => (appointments ? Math.round((n / appointments) * 100) : 0);
  const appointmentBreakdown = [
    { name: 'Completed', value: pct(statusCount.Completed || 0), count: statusCount.Completed || 0, color: '#10b981' },
    { name: 'Upcoming', value: pct(upcoming - rescheduled), count: upcoming - rescheduled, color: '#3b82f6' },
    { name: 'Cancelled', value: pct(statusCount.Cancelled || 0), count: statusCount.Cancelled || 0, color: '#ef4444' },
    { name: 'Rescheduled', value: pct(rescheduled), count: rescheduled, color: '#f59e0b' },
  ];

  // Month-over-month growth for the KPI cards ("+12.4% vs last month")
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const growthOf = async (Model, filter, field = 'createdAt') => {
    const [cur, prev] = await Promise.all([
      Model.countDocuments({ ...filter, [field]: { $gte: thisMonth } }),
      Model.countDocuments({ ...filter, [field]: { $gte: lastMonth, $lt: thisMonth } }),
    ]);
    if (!prev) return cur ? 100 : 0;
    return Math.round(((cur - prev) / prev) * 1000) / 10;
  };
  const sumPaid = async (start, end) => {
    const rows = await Payment.find({ type: 'Payment', status: { $in: ['Success', 'Refunded'] }, paidAt: { $gte: start, ...(end ? { $lt: end } : {}) } }).select('amount').lean();
    return rows.reduce((t, r) => t + (r.amount || 0), 0);
  };
  const [gPatients, gProviders, gAppointments, gConsultations, gPending, revCur, revPrev] = await Promise.all([
    growthOf(User, { role: 'patient' }),
    growthOf(Provider, {}),
    growthOf(Appointment, {}),
    growthOf(Appointment, { consultationType: 'online' }),
    growthOf(Provider, { status: 'PENDING' }),
    sumPaid(thisMonth),
    sumPaid(lastMonth, thisMonth),
  ]);
  const growth = {
    patients: gPatients,
    providers: gProviders,
    appointments: gAppointments,
    consultations: gConsultations,
    pendingApprovals: gPending,
    revenue: revPrev ? Math.round(((revCur - revPrev) / revPrev) * 1000) / 10 : revCur ? 100 : 0,
  };

  const [newEnquiries, openEnquiries, newApplications] = await Promise.all([
    Enquiry.countDocuments({ status: 'New' }),
    Enquiry.countDocuments({ status: { $in: ['New', 'Contacted', 'Scheduled'] } }),
    JobApplication.countDocuments({ status: 'New' }),
  ]);

  res.json({
    success: true,
    growth,
    stats: {
      patients,
      providers,
      activeProviders,
      pendingProviders,
      rejectedProviders,
      appointments,
      todayAppointments,
      upcomingAppointments: upcoming,
      completedAppointments: statusCount.Completed || 0,
      cancelledAppointments: statusCount.Cancelled || 0,
      consultations,
      revenue: totalRevenue,
      todayRevenue: todayRevenueAgg[0]?.total || 0,
      pendingPayments: pendingAgg[0]?.total || 0,
      refunds,
      successfulPayments: successCount,
      newEnquiries,
      openEnquiries,
      newApplications,
    },
    revenueSeries,
    appointmentBreakdown,
    recentAppointments: recent,
  });
});

// GET /api/admin/patients?search=
export const listPatients = asyncHandler(async (req, res) => {
  const filter = { role: 'patient' };
  if (req.query.search) {
    const rx = new RegExp(req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { phone: rx }];
  }
  const users = await User.find(filter).sort({ createdAt: -1 });
  const counts = await Appointment.aggregate([
    { $match: { patientUser: { $in: users.map((u) => u._id) } } },
    { $group: { _id: '$patientUser', count: { $sum: 1 } } },
  ]);
  const countMap = Object.fromEntries(counts.map((c) => [c._id.toString(), c.count]));
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const patients = users.map((u) => ({
    ...u.toJSON(),
    code: `PAT-${u._id.toString().slice(-5).toUpperCase()}`,
    appointments: countMap[u._id.toString()] || 0,
    joined: shortDate(u.createdAt),
  }));
  res.json({
    success: true,
    patients,
    summary: {
      total: patients.length,
      active: patients.filter((p) => p.status === 'Active').length,
      inactive: patients.filter((p) => p.status === 'Inactive').length,
      newThisMonth: users.filter((u) => u.createdAt >= monthStart).length,
    },
  });
});

// GET /api/admin/patients/:id
export const getPatient = asyncHandler(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, role: 'patient' });
  if (!user) throw new ApiError(404, 'Patient not found');
  const [appointments, payments] = await Promise.all([
    Appointment.find({ patientUser: user._id }).sort({ scheduledAt: -1 }),
    Payment.find({ patientUser: user._id }).sort({ createdAt: -1 }),
  ]);
  res.json({
    success: true,
    patient: { ...user.toJSON(), code: `PAT-${user._id.toString().slice(-5).toUpperCase()}`, joined: shortDate(user.createdAt) },
    appointments,
    payments,
  });
});

// PATCH /api/admin/patients/:id  { status, name, phone, age, gender, city }
// POST /api/admin/patients  (admin registers a patient who called in; they can log in with the phone/email + password)
export const createPatient = asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const phone = String(req.body.phone || '').replace(/\D/g, '').slice(-10);
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!name) throw new ApiError(400, 'Patient name is required');
  if (!/^[6-9]\d{9}$/.test(phone)) throw new ApiError(400, 'Please enter a valid 10-digit mobile number');
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new ApiError(400, 'Please enter a valid email address');
  if (await User.findOne({ phone })) throw new ApiError(409, 'A patient with this mobile number already exists');
  if (email && (await User.findOne({ email }))) throw new ApiError(409, 'An account with this email already exists');
  if (req.body.pincode && !/^[1-9]\d{5}$/.test(String(req.body.pincode))) throw new ApiError(400, 'Please enter a valid 6-digit PIN code');
  const age = req.body.age === '' || req.body.age === undefined ? undefined : Number(req.body.age);
  if (age !== undefined && (!Number.isFinite(age) || age < 0 || age > 120)) throw new ApiError(400, 'Please enter a valid age');
  // a temporary password the admin shares with the patient (they can change it from their dashboard)
  const password = String(req.body.password || '') || `Care${Math.floor(100000 + Math.random() * 900000)}`;
  if (password.length < 6) throw new ApiError(400, 'Password must be at least 6 characters');
  const toList = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim()).filter(Boolean);
  const user = await User.create({
    name, phone, email: email || undefined, password, role: 'patient',
    age, gender: req.body.gender || undefined, city: req.body.city || undefined, pincode: req.body.pincode || undefined,
    district: req.body.district || undefined, state: req.body.state || undefined, locality: req.body.locality || undefined,
    conditions: toList(req.body.conditions),
  });
  await linkGuestRecords(user).catch(() => {}); // earlier bookings made with this number now show in the account
  res.status(201).json({ success: true, patient: user, temporaryPassword: req.body.password ? undefined : password });
});

export const updatePatient = asyncHandler(async (req, res) => {
  const allowed = ['status', 'name', 'phone', 'email', 'age', 'gender', 'city', 'pincode', 'district', 'state', 'locality', 'bloodGroup', 'emergencyContact'];
  if (req.body.pincode && !/^[1-9]\d{5}$/.test(String(req.body.pincode))) throw new ApiError(400, 'Please enter a valid 6-digit PIN code');
  const update = Object.fromEntries(allowed.filter((k) => req.body[k] !== undefined).map((k) => [k, req.body[k]]));
  const toList = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim()).filter(Boolean);
  if (req.body.allergies !== undefined) update.allergies = toList(req.body.allergies);
  if (req.body.conditions !== undefined) update.conditions = toList(req.body.conditions);
  const user = await User.findOne({ _id: req.params.id, role: 'patient' });
  if (!user) throw new ApiError(404, 'Patient not found');
  Object.assign(user, update);
  await user.save();
  res.json({ success: true, patient: user });
});

// GET /api/admin/payments?type=&status=&search=
export const listPayments = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.type) filter.type = req.query.type;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.search) {
    const rx = new RegExp(req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ txnId: rx }, { patientName: rx }, { providerName: rx }, { appointmentCode: rx }];
  }
  const payments = await Payment.find(filter).sort({ createdAt: -1 }).limit(500);
  res.json({ success: true, payments });
});

// POST /api/admin/payments/:id/refund
export const refundPayment = asyncHandler(async (req, res) => {
  const payment = await Payment.findById(req.params.id);
  if (!payment || payment.type !== 'Payment') throw new ApiError(404, 'Payment not found');
  if (payment.status !== 'Success') throw new ApiError(400, 'Only successful payments can be refunded');
  payment.status = 'Refunded';
  await payment.save();
  const refund = await Payment.create({
    appointment: payment.appointment,
    appointmentCode: payment.appointmentCode,
    patientUser: payment.patientUser,
    patientName: payment.patientName,
    provider: payment.provider,
    providerName: payment.providerName,
    amount: payment.amount,
    method: payment.method,
    status: 'Success',
    type: 'Refund',
    paidAt: new Date(),
    note: req.body?.reason || 'Refunded by admin',
  });
  if (payment.appointment) {
    await Appointment.findByIdAndUpdate(payment.appointment, { paymentStatus: 'Refunded' });
  }
  res.json({ success: true, message: 'Refund processed', payment, refund });
});

// GET /api/admin/payouts – earnings per provider (successful payments minus 10% platform commission)
export const providerPayouts = asyncHandler(async (_req, res) => {
  const [payments, completedCounts] = await Promise.all([
    Payment.find({ provider: { $ne: null } }).select('provider providerName amount type status paidAt').lean(),
    Appointment.aggregate([{ $match: { status: 'Completed' } }, { $group: { _id: '$provider', count: { $sum: 1 } } }]),
  ]);
  const completedMap = Object.fromEntries(completedCounts.map((c) => [c._id?.toString(), c.count]));
  const map = new Map();
  payments.forEach((p) => {
    const key = p.provider.toString();
    const row = map.get(key) || { providerId: key, provider: p.providerName, gross: 0, refunds: 0, paid: 0, lastPayoutAt: null };
    if (p.type === 'Payment' && p.status === 'Success') row.gross += p.amount || 0;
    if (p.type === 'Payment' && p.status === 'Refunded') row.refunds += p.amount || 0;
    if (p.type === 'Payout') {
      row.paid += p.amount || 0;
      if (!row.lastPayoutAt || p.paidAt > row.lastPayoutAt) row.lastPayoutAt = p.paidAt;
    }
    map.set(key, row);
  });
  const payouts = [...map.values()]
    .map((r) => {
      const commission = Math.round(r.gross * 0.1);
      const net = r.gross - commission;
      const pending = Math.max(net - r.paid, 0);
      return {
        ...r,
        appointments: completedMap[r.providerId] || 0,
        commission,
        net,
        pending,
        status: pending > 0 ? 'Pending' : 'Paid',
        payoutDate: r.lastPayoutAt ? shortDate(r.lastPayoutAt) : '-',
      };
    })
    .sort((a, b) => b.pending - a.pending || b.gross - a.gross);

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const processedThisMonth = payments.filter((p) => p.type === 'Payout' && p.paidAt >= monthStart).reduce((t, p) => t + p.amount, 0);
  res.json({
    success: true,
    payouts,
    summary: {
      pending: payouts.reduce((t, p) => t + p.pending, 0),
      processedThisMonth,
      providersPaid: payouts.filter((p) => p.paid > 0).length,
    },
  });
});

// POST /api/admin/payouts/:providerId  – settle the pending amount for a provider
export const processPayout = asyncHandler(async (req, res) => {
  const provider = await Provider.findById(req.params.providerId);
  if (!provider) throw new ApiError(404, 'Provider not found');
  const payments = await Payment.find({ provider: provider._id }).select('amount type status').lean();
  const gross = payments.filter((p) => p.type === 'Payment' && p.status === 'Success').reduce((t, p) => t + p.amount, 0);
  const paid = payments.filter((p) => p.type === 'Payout').reduce((t, p) => t + p.amount, 0);
  const pending = gross - Math.round(gross * 0.1) - paid;
  if (pending <= 0) throw new ApiError(400, 'No pending payout for this provider');
  const payout = await Payment.create({
    provider: provider._id,
    providerName: provider.name,
    amount: pending,
    method: 'bank',
    status: 'Success',
    type: 'Payout',
    paidAt: new Date(),
    note: provider.bank?.accountLast4 ? `Bank transfer to A/C ••••${provider.bank.accountLast4}` : 'Bank transfer',
  });
  res.status(201).json({ success: true, message: 'Payout processed', payout });
});
