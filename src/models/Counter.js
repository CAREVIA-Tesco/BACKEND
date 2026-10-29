import mongoose from 'mongoose';

// Running numbers for readable IDs: ENQ-0001, APT-0001, DOC-0001 …
const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false });
const Counter = mongoose.model('Counter', counterSchema);

// next code for a series, e.g. nextCode('appointment', 'APPT', 3) -> 'APPT-001'
export async function nextCode(series, prefix, minDigits = (prefix === 'APPT' ? 3 : 4), startAt = 0) {
  let c = await Counter.findOneAndUpdate(
    { _id: series },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  if (startAt > 0 && c.seq < startAt) {
    c = await Counter.findOneAndUpdate(
      { _id: series },
      { $max: { seq: startAt } },
      { new: true }
    );
  }
  return `${prefix}-${String(c.seq).padStart(minDigits, '0')}`;
}

export default Counter;

export const IST_OFFSET_MS = 5.5 * 3600 * 1000;
export const isoDayIST = (d = new Date()) =>
  new Date(new Date(d).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

// Daily sequence per doctor per date (Asia/Kolkata timezone: 12:00 AM to 11:59 PM)
// series format: "daily_appt:<providerId>:<YYYY-MM-DD>"
export async function nextDailyAppointmentNumber(providerId, dateStr) {
  const day = dateStr || isoDayIST(new Date());
  const series = `daily_appt:${providerId}:${day}`;
  const c = await Counter.findOneAndUpdate(
    { _id: series },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const dailySeq = c.seq;
  const appointmentNumber = String(dailySeq).padStart(3, '0');
  return { dailySeq, appointmentNumber, appointmentDate: day };
}

