import mongoose from 'mongoose';

// Walk-in clinic patients and their visits, entered by the doctor or the doctor's nurse
// (Doctor Dashboard → Patient Visits). One patient record per doctor per (mobile + name),
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
  const count = await this.constructor.countDocuments();
  this.code = `CP-${10001 + count}`;
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
    visitCount: ret.visitCount,
    firstVisitAt: ret.firstVisitAt,
    lastVisitAt: ret.lastVisitAt,
    createdBy: ret.createdBy?.name,
    createdAt: ret.createdAt,
  }),
});

const clinicVisitSchema = new mongoose.Schema(
  {
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
    enteredBy: actor,
    updatedBy: { ...actor, at: Date },
  },
  { timestamps: true }
);
clinicVisitSchema.index({ provider: 1, visitDate: -1 });

clinicVisitSchema.set('toJSON', {
  transform: (_doc, ret) => ({
    id: ret._id.toString(),
    providerId: ret.provider?.toString(),
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
    enteredBy: ret.enteredBy?.name ? `${ret.enteredBy.name}${ret.enteredBy.role === 'nurse' ? ' (nurse)' : ''}` : '',
    updatedBy: ret.updatedBy?.name ? `${ret.updatedBy.name}${ret.updatedBy.role === 'nurse' ? ' (nurse)' : ''}` : '',
    updatedAt: ret.updatedBy?.at || ret.updatedAt,
    createdAt: ret.createdAt,
  }),
});

export const ClinicPatient = mongoose.model('ClinicPatient', clinicPatientSchema);
export const ClinicVisit = mongoose.model('ClinicVisit', clinicVisitSchema);
