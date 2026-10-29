// One-time switch to the short running IDs (ENQ-0001, APT-0001, DOC-0001).
// Existing requests, appointments and professionals are numbered in the order they were created;
// the appointment ID shown on requests and payments is updated to match. Runs once per series.
import Counter, { nextCode } from '../models/Counter.js';
import Enquiry from '../models/Enquiry.js';
import Appointment from '../models/Appointment.js';
import Provider from '../models/Provider.js';
import Payment from '../models/Payment.js';
import { ClinicVisit, ClinicRegistrationLink, ClinicPatient } from '../models/ClinicRecord.js';

const code = (prefix, n) => `${prefix}-${String(n).padStart(prefix === 'APPT' ? 3 : 4, '0')}`;

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

export async function syncAppointmentNumbers() {
  // 1. Upgrade legacy APT-xxxx codes on Appointment to APPT-xxx
  const legacyApts = await Appointment.find({ code: /^APT-\d+/ }).sort({ createdAt: 1, _id: 1 });
  for (const a of legacyApts) {
    const match = a.code.match(/^APT-0*(\d+)/);
    if (match) {
      const num = parseInt(match[1], 10);
      const newCode = `APPT-${String(num).padStart(3, '0')}`;
      const oldCode = a.code;
      await Appointment.updateOne({ _id: a._id }, { $set: { code: newCode } });
      await Enquiry.updateMany({ appointmentCode: oldCode }, { $set: { appointmentCode: newCode } });
      await Payment.updateMany({ appointmentCode: oldCode }, { $set: { appointmentCode: newCode } });
    }
  }

  // 2. Ensure any unnumbered ClinicVisits get sequential appointment numbers
  const unnumberedVisits = await ClinicVisit.find({
    $or: [{ appointmentNumber: { $exists: false } }, { appointmentNumber: null }, { appointmentNumber: '' }],
  }).sort({ createdAt: 1, _id: 1 });

  for (const v of unnumberedVisits) {
    const apptNum = await nextCode('appointment', 'APPT', 3);
    await ClinicVisit.updateOne({ _id: v._id }, { $set: { appointmentNumber: apptNum, code: apptNum } });
    if (v.link) {
      await ClinicRegistrationLink.updateOne({ _id: v.link }, { $set: { appointmentNumber: apptNum } });
    }
  }

  // 3. Make sure Counter seq is at least the highest number between Appointment and ClinicVisit
  const [allApts, allVisits] = await Promise.all([
    Appointment.find({ code: /^APPT-\d+/ }).select('code').lean(),
    ClinicVisit.find({ appointmentNumber: /^APPT-\d+/ }).select('appointmentNumber').lean(),
  ]);

  let maxNum = 0;
  for (const a of allApts) {
    const m = a.code?.match(/^APPT-(\d+)/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  }
  for (const v of allVisits) {
    const m = v.appointmentNumber?.match(/^APPT-(\d+)/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  }

  if (maxNum > 0) {
    const current = await Counter.findOne({ _id: 'appointment' });
    if (!current || current.seq < maxNum) {
      await Counter.updateOne({ _id: 'appointment' }, { $set: { seq: maxNum } }, { upsert: true });
    }
  }

  // 4. Synchronize reglink and clinic_patient sequences so they never collide with existing records
  const [allLinks, allPatients] = await Promise.all([
    ClinicRegistrationLink.find({ code: /^RL-\d+/ }).select('code').lean(),
    ClinicPatient.find({ code: /^CP-\d+/ }).select('code').lean(),
  ]);

  let maxRL = 10000;
  for (const l of allLinks) {
    const m = l.code?.match(/^RL-(\d+)/);
    if (m) maxRL = Math.max(maxRL, parseInt(m[1], 10));
  }
  const currRL = await Counter.findOne({ _id: 'reglink' });
  if (!currRL || currRL.seq < maxRL) {
    await Counter.updateOne({ _id: 'reglink' }, { $set: { seq: maxRL } }, { upsert: true });
  }

  let maxCP = 10000;
  for (const p of allPatients) {
    const m = p.code?.match(/^CP-(\d+)/);
    if (m) maxCP = Math.max(maxCP, parseInt(m[1], 10));
  }
  const currCP = await Counter.findOne({ _id: 'clinic_patient' });
  if (!currCP || currCP.seq < maxCP) {
    await Counter.updateOne({ _id: 'clinic_patient' }, { $set: { seq: maxCP } }, { upsert: true });
  }

  // 5. Daily Doctor-Wise Appointment Numbering Sync & Index Cleanup
  try {
    const mongoose = (await import('mongoose')).default;
    const coll = mongoose.connection.collection('clinicvisits');
    const indexes = await coll.indexes().catch(() => []);
    const hasOldUnique = indexes.find((i) => i.name === 'appointmentNumber_1' && i.unique);
    if (hasOldUnique) {
      await coll.dropIndex('appointmentNumber_1').catch(() => {});
      console.log('[db] Dropped legacy single-field unique index appointmentNumber_1 on clinicvisits');
    }

    // Backfill appointmentDate and dailySequence for all visits grouped by doctor and date
    const allVisitsList = await coll.find({}).sort({ visitDate: 1, createdAt: 1, _id: 1 }).toArray();
    const doctorDayCounts = {};

    for (const v of allVisitsList) {
      const provId = String(v.provider);
      const dateStr = v.appointmentDate || (v.visitDate ? new Date(new Date(v.visitDate).getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
      const key = `${provId}:${dateStr}`;
      doctorDayCounts[key] = (doctorDayCounts[key] || 0) + 1;
      const seq = doctorDayCounts[key];
      const apptNum = String(seq).padStart(3, '0');

      await coll.updateOne(
        { _id: v._id },
        {
          $set: {
            appointmentDate: dateStr,
            dailySequence: seq,
            appointmentNumber: apptNum,
            code: apptNum,
          },
        }
      );

      if (v.link) {
        await mongoose.connection.collection('clinicregistrationlinks').updateOne(
          { _id: v.link },
          {
            $set: {
              appointmentNumber: apptNum,
              dailySequence: seq,
              appointmentDate: dateStr,
            },
          }
        );
      }
    }

    // Set daily_appt counter for each doctor and date
    for (const [key, maxSeq] of Object.entries(doctorDayCounts)) {
      const [provId, dateStr] = key.split(':');
      const seriesId = `daily_appt:${provId}:${dateStr}`;
      await Counter.updateOne(
        { _id: seriesId },
        { $set: { seq: maxSeq } },
        { upsert: true }
      );
    }
  } catch (err) {
    console.warn('[db] Daily appointment sync notice:', err.message);
  }
}

export async function renumberCodesOnce() {
  await renumber('enquiry', 'ENQ', Enquiry);
  await renumber('appointment', 'APPT', Appointment, async (oldCode, newCode) => {
    await Enquiry.updateMany({ appointmentCode: oldCode }, { $set: { appointmentCode: newCode } });
    await Payment.updateMany({ appointmentCode: oldCode }, { $set: { appointmentCode: newCode } });
  });
  await renumber('provider', 'DOC', Provider);
  await syncAppointmentNumbers();
}
