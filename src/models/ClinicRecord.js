import mongoose from 'mongoose';
import { nextCode, nextDailyAppointmentNumber, isoDayIST } from './Counter.js';

// Walk-in clinic patients and their visits, entered by the doctor or the doctor's nurse
// (Doctor Dashboard → Patient Visits; a nurse uses the doctor's dashboard and adds her name). One patient record per doctor per (mobile + name),
// so the same person is never saved twice; every visit is a separate record linked to it.
const actor = { user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, name: String, role: String };

const clinicPatientSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true }, // CP-10001
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider', required: true, index: true },
    providerName: String,
    name: { type: String, required: true, trim: true, maxlength: 100 },
    nameKey: { type: String, required: true }, // lower-case name, used to avoid duplicates
    age: Number,
    gender: { type: String, enum: ['Male', 'Female', 'Other', null], default: null },
    phone: { type: String, required: true }, // 10 digits
    email: { type: String, trim: true, lowercase: true, maxlength: 120 },
    address: { type: String, trim: true, maxlength: 300 },
    city: { type: String, trim: true, maxlength: 100 },
    visitCount: { type: Number, default: 0 },
    firstVisitAt: Date,
    lastVisitAt: Date,
    createdBy: actor,
  },
  { timestamps: true }
);
clinicPatientSchema.index({ provider: 1, phone: 1, nameKey: 1 }, { unique: true });

clinicPatientSchema.pre('save', async function assignCode(next) {
  if (this.code) return next();
  this.code = await nextCode('clinic_patient', 'CP', 5, 10001);
  next();
});

clinicPatientSchema.set('toJSON', {
  transform: (_doc, ret) => ({
    id: ret._id.toString(),
    code: ret.code,
    providerId: ret.provider?.toString(),
    doctor: ret.providerName,
    name: ret.name,
    age: ret.age,
    gender: ret.gender,
    phone: ret.phone,
    email: ret.email || '',
    address: ret.address || '',
    city: ret.city || '',
    visitCount: ret.visitCount,
    firstVisitAt: ret.firstVisitAt,
    lastVisitAt: ret.lastVisitAt,
    createdBy: ret.createdBy?.name,
    createdAt: ret.createdAt,
  }),
});

const clinicVisitSchema = new mongoose.Schema(
  {
    appointmentNumber: { type: String, index: true },
    dailySequence: { type: Number, index: true }, // 1, 2, 3... resets to 1 daily per doctor
    appointmentDate: { type: String, index: true }, // YYYY-MM-DD in Asia/Kolkata
    code: { type: String, index: true }, // alias for appointmentNumber
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider', required: true, index: true },
    providerName: String,
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'ClinicPatient', required: true, index: true },
    patientName: String,
    visitDate: { type: Date, required: true, index: true },
    symptoms: { type: String, maxlength: 2000 },
    diagnosis: { type: String, maxlength: 2000 },
    treatment: { type: String, maxlength: 2000 },
    prescription: { type: String, maxlength: 3000 },
    nurseNotes: { type: String, maxlength: 2000 },
    source: { type: String, enum: ['manual', 'shared_link'], default: 'manual' },
    link: { type: mongoose.Schema.Types.ObjectId, ref: 'ClinicRegistrationLink' },
    medicalHistory: { type: String, maxlength: 2000 },
    allergies: { type: String, maxlength: 1000 },
    currentMedications: { type: String, maxlength: 1000 },
    recordedBy: { type: String, trim: true, maxlength: 80 }, // nurse who typed it in on the doctor's dashboard or link
    enteredBy: actor,
    updatedBy: { ...actor, at: Date },
  },
  { timestamps: true }
);
clinicVisitSchema.index({ provider: 1, visitDate: -1 });
clinicVisitSchema.index({ provider: 1, appointmentDate: 1, dailySequence: 1 }, { unique: true, sparse: true });

clinicVisitSchema.pre('save', async function assignAppointmentNumber(next) {
  if (!this.appointmentDate) {
    this.appointmentDate = isoDayIST(this.visitDate || new Date());
  }
  if (!this.dailySequence || !this.appointmentNumber) {
    const { dailySeq, appointmentNumber } = await nextDailyAppointmentNumber(this.provider, this.appointmentDate);
    this.dailySequence = dailySeq;
    this.appointmentNumber = appointmentNumber;
    this.code = appointmentNumber;
  } else if (!this.code) {
    this.code = this.appointmentNumber;
  }
  next();
});

clinicVisitSchema.set('toJSON', {
  transform: (_doc, ret) => ({
    id: ret._id.toString(),
    appointmentNumber: ret.appointmentNumber || (ret.dailySequence ? String(ret.dailySequence).padStart(3, '0') : '') || ret.code || '',
    dailySequence: ret.dailySequence,
    appointmentDate: ret.appointmentDate,
    code: ret.code || ret.appointmentNumber || '',
    provider: ret.provider?.toString(),
    providerId: ret.provider?.toString(),
    providerName: ret.providerName,
    doctor: ret.providerName,
    // patient is either an id or (when populated) the patient record, possibly already converted
    patientId: ret.patient?.name ? String(ret.patient.id || ret.patient._id) : ret.patient?.toString(),
    patient: ret.patient?.name ? { id: String(ret.patient.id || ret.patient._id), code: ret.patient.code, name: ret.patient.name, age: ret.patient.age, gender: ret.patient.gender, phone: ret.patient.phone } : undefined,
    patientName: ret.patientName,
    visitDate: ret.visitDate,
    symptoms: ret.symptoms || '',
    diagnosis: ret.diagnosis || '',
    treatment: ret.treatment || '',
    prescription: ret.prescription || '',
    nurseNotes: ret.nurseNotes || '',
    source: ret.source || 'manual',
    linkId: ret.link?.toString(),
    medicalHistory: ret.medicalHistory || '',
    allergies: ret.allergies || '',
    currentMedications: ret.currentMedications || '',
    recordedBy: ret.recordedBy || '',
    enteredBy: ret.recordedBy ? `${ret.recordedBy} (nurse)` : ret.enteredBy?.name ? `${ret.enteredBy.name}${ret.enteredBy.role === 'nurse' ? ' (nurse)' : ''}` : '',
    updatedBy: ret.updatedBy?.name ? `${ret.updatedBy.name}${ret.updatedBy.role === 'nurse' ? ' (nurse)' : ''}` : '',
    updatedAt: ret.updatedBy?.at || ret.updatedAt,
    createdAt: ret.createdAt,
  }),
});

const clinicRegistrationLinkSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true }, // RL-10001
    token: { type: String, required: true, unique: true, index: true },
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider', required: true, index: true },
    providerName: String,
    doctorSpecialization: String,
    clinicName: String,
    patientName: { type: String, trim: true, maxlength: 100 },
    patientPhone: { type: String, trim: true },
    notes: { type: String, maxlength: 1000 },
    recordedBy: { type: String, trim: true, maxlength: 80 }, // Nurse who created the link
    status: {
      type: String,
      enum: ['Pending', 'Submitted', 'Expired', 'Cancelled'],
      default: 'Pending',
      index: true,
    },
    submittedAt: Date,
    expiresAt: { type: Date, index: true },
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'ClinicPatient' },
    visit: { type: mongoose.Schema.Types.ObjectId, ref: 'ClinicVisit' },
    appointmentNumber: { type: String, trim: true },
    dailySequence: { type: Number },
    appointmentDate: { type: String },
    createdBy: actor,
  },
  { timestamps: true }
);
clinicRegistrationLinkSchema.index({ provider: 1, createdAt: -1 });

clinicRegistrationLinkSchema.pre('save', async function assignCode(next) {
  if (!this.code) {
    this.code = await nextCode('reglink', 'RL', 5, 10001);
  }
  if (!this.expiresAt) {
    this.expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  }
  next();
});

clinicRegistrationLinkSchema.set('toJSON', {
  transform: (_doc, ret) => ({
    id: ret._id.toString(),
    code: ret.code,
    token: ret.token,
    appointmentNumber: ret.appointmentNumber || ret.visit?.appointmentNumber || (ret.dailySequence ? String(ret.dailySequence).padStart(3, '0') : '') || ret.visit?.code || '',
    dailySequence: ret.dailySequence || ret.visit?.dailySequence,
    appointmentDate: ret.appointmentDate || ret.visit?.appointmentDate,
    provider: ret.provider?.toString(),
    providerId: ret.provider?.toString(),
    providerName: ret.providerName,
    doctor: ret.providerName,
    doctorSpecialization: ret.doctorSpecialization,
    clinicName: ret.clinicName,
    patientName: ret.patientName || '',
    patientPhone: ret.patientPhone || '',
    notes: ret.notes || '',
    recordedBy: ret.recordedBy || '',
    status: ret.status,
    submittedAt: ret.submittedAt,
    expiresAt: ret.expiresAt,
    patientId: ret.patient?._id ? ret.patient._id.toString() : ret.patient?.toString(),
    patient: ret.patient?.name ? {
      id: String(ret.patient._id || ret.patient.id),
      code: ret.patient.code,
      name: ret.patient.name,
      phone: ret.patient.phone,
    } : ret.patient?._id ? { id: ret.patient._id.toString() } : undefined,
    visitId: ret.visit?._id ? ret.visit._id.toString() : ret.visit?.toString(),
    visit: ret.visit?._id ? {
      id: ret.visit._id.toString(),
      appointmentNumber: ret.visit.appointmentNumber || ret.visit.code || '',
      code: ret.visit.code || ret.visit.appointmentNumber || '',
      visitDate: ret.visit.visitDate,
      symptoms: ret.visit.symptoms,
      diagnosis: ret.visit.diagnosis,
    } : ret.visit ? { id: ret.visit.toString() } : undefined,
    createdAt: ret.createdAt,
    createdBy: ret.createdBy?.name,
  }),
});

export const ClinicPatient = mongoose.model('ClinicPatient', clinicPatientSchema);
export const ClinicVisit = mongoose.model('ClinicVisit', clinicVisitSchema);
export const ClinicRegistrationLink = mongoose.model('ClinicRegistrationLink', clinicRegistrationLinkSchema);
