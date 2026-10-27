// One-time switch to the short running IDs (ENQ-0001, APT-0001, DOC-0001).
// Existing requests, appointments and professionals are numbered in the order they were created;
// the appointment ID shown on requests and payments is updated to match. Runs once per series.
import Counter, { nextCode } from '../models/Counter.js';
import Enquiry from '../models/Enquiry.js';
import Appointment from '../models/Appointment.js';
import Provider from '../models/Provider.js';
import Payment from '../models/Payment.js';

const code = (prefix, n) => `${prefix}-${String(n).padStart(4, '0')}`;

async function renumber(series, prefix, Model, onChange) {
  if (await Counter.exists({ _id: series })) {
    // anything saved without an ID (e.g. imported) gets the next number
    const missing = await Model.find({ $or: [{ code: { $exists: false } }, { code: null }, { code: '' }] }).select('_id').sort({ createdAt: 1, _id: 1 }).lean();
    for (const d of missing) await Model.updateOne({ _id: d._id }, { $set: { code: await nextCode(series, prefix) } });
    return;
  }
  const docs = await Model.find().select('_id code createdAt').sort({ createdAt: 1, _id: 1 }).lean();
  let n = 0;
  for (const d of docs) {
    n += 1;
    const next = code(prefix, n);
    if (d.code === next) continue;
    await Model.updateOne({ _id: d._id }, { $set: { code: next } });
    if (onChange && d.code) await onChange(d.code, next);
  }
  await Counter.updateOne({ _id: series }, { $set: { seq: n } }, { upsert: true });
  if (n) console.log(`[ids] ${n} ${series} record(s) renumbered from ${code(prefix, 1)}`);
}

export async function renumberCodesOnce() {
  await renumber('enquiry', 'ENQ', Enquiry);
  await renumber('appointment', 'APT', Appointment, async (oldCode, newCode) => {
    await Enquiry.updateMany({ appointmentCode: oldCode }, { $set: { appointmentCode: newCode } });
    await Payment.updateMany({ appointmentCode: oldCode }, { $set: { appointmentCode: newCode } });
  });
  await renumber('provider', 'DOC', Provider);
}
