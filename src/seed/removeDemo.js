import 'dotenv/config';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import User from '../models/User.js';
import Provider from '../models/Provider.js';
import Appointment from '../models/Appointment.js';
import Payment from '../models/Payment.js';
import Review from '../models/Review.js';
import JobApplication from '../models/JobApplication.js';
import EmergencyRequest from '../models/EmergencyRequest.js';
import SiteContent from '../models/SiteContent.js';
import { PROVIDERS } from './seed.js';

// Accounts and records created by the old automatic demo seed
const DEMO_EMAILS = ['doctor@carevia.com', 'ramesh@carevia.com', 'patient@carevia.com', 'arun@example.com', 'sneha@example.com', 'vikram@example.com'];
const DEMO_PROVIDER_NAMES = PROVIDERS.map((p) => p.name);
const FLAG_KEY = 'system-demo-removed';

/**
 * Deletes the sample doctors, sample patients and everything linked to them
 * (appointments, payments, reviews, emergency requests). Real accounts are kept.
 */
export async function removeDemoData({ log = console.log } = {}) {
  const demoUsers = await User.find({ email: { $in: DEMO_EMAILS } }).select('_id');
  const demoUserIds = demoUsers.map((u) => u._id);
  // only providers that were created by the seed: demo name AND (no login, or a demo login)
  const demoProviders = await Provider.find({
    name: { $in: DEMO_PROVIDER_NAMES },
    $or: [{ user: null }, { user: { $exists: false } }, { user: { $in: demoUserIds } }],
  }).select('_id');
  const demoProviderIds = demoProviders.map((p) => p._id);

  const appts = await Appointment.find({ $or: [{ provider: { $in: demoProviderIds } }, { patientUser: { $in: demoUserIds } }] }).select('_id');
  const apptIds = appts.map((a) => a._id);

  const results = await Promise.all([
    Payment.deleteMany({ $or: [{ appointment: { $in: apptIds } }, { provider: { $in: demoProviderIds } }, { patientUser: { $in: demoUserIds } }] }),
    Review.deleteMany({ $or: [{ appointment: { $in: apptIds } }, { provider: { $in: demoProviderIds } }, { patientUser: { $in: demoUserIds } }] }),
    EmergencyRequest.deleteMany({ patientUser: { $in: demoUserIds } }),
    JobApplication.deleteMany({ email: 'lakshmi@example.com', name: 'Lakshmi R' }),
  ]);
  await EmergencyRequest.updateMany({ provider: { $in: demoProviderIds } }, { $unset: { provider: 1, providerName: 1 }, status: 'Waiting' });
  const deletedAppts = await Appointment.deleteMany({ _id: { $in: apptIds } });
  const deletedProviders = await Provider.deleteMany({ _id: { $in: demoProviderIds } });
  const deletedUsers = await User.deleteMany({ _id: { $in: demoUserIds } });

  log(`Demo data removed: ${deletedProviders.deletedCount} providers, ${deletedUsers.deletedCount} demo accounts, ${deletedAppts.deletedCount} appointments, ${results[0].deletedCount} payments, ${results[1].deletedCount} reviews, ${results[2].deletedCount} emergency requests.`);
}

// Runs once automatically on server start so existing databases lose the old demo doctors
export async function removeDemoDataOnce() {
  if (await SiteContent.findOne({ key: FLAG_KEY })) return;
  await removeDemoData();
  await SiteContent.create({ key: FLAG_KEY, items: [{ at: new Date().toISOString() }] });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { connectDB } = await import('../config/db.js');
  try {
    await connectDB();
    await removeDemoData();
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
