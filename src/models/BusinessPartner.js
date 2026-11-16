import mongoose from 'mongoose';

// Healthcare businesses (clinics, labs, pharmacies, ...) that apply to partner with Carevaa.
// Separate from doctor / professional registration: no login account is created; the admin team
// reviews each application in Admin → Business Partners and approves or rejects it.
export const PARTNER_STATUSES = ['Pending', 'Approved', 'Rejected'];
export const BUSINESS_CATEGORIES = [
  'Hospital', 'Clinic / Polyclinic', 'Diagnostic Laboratory', 'Imaging / Scan Centre', 'Pharmacy',
  'Home Healthcare Agency', 'Nursing / Caretaker Agency', 'Physiotherapy Centre', 'Ambulance Service',
  'Medical Equipment Supplier', 'Wellness / Ayurveda Centre', 'Other',
];

const noteSchema = new mongoose.Schema({ text: String, by: String, at: { type: Date, default: Date.now } }, { _id: false });

const businessPartnerSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, sparse: true }, // BP-0001
    businessName: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    categoryOther: { type: String, trim: true },
    contactPerson: { type: String, required: true, trim: true },
    designation: { type: String, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    website: { type: String, trim: true },
    address: { type: String, required: true, trim: true },
    pincode: { type: String, trim: true },
    city: { type: String, trim: true },
    district: { type: String, trim: true },
    state: { type: String, trim: true },
    locality: { type: String, trim: true },
    services: [{ type: String, trim: true }],
    servicesOther: { type: String, trim: true },
    yearsInBusiness: Number,
    registrationNumber: { type: String, trim: true }, // licence / registration
    gstNumber: { type: String, trim: true },
    message: { type: String, trim: true, maxlength: 1500 },
    status: { type: String, enum: PARTNER_STATUSES, default: 'Pending' },
    reviewedBy: String,
    reviewedAt: Date,
    notes: [noteSchema], // admin only
  },
  { timestamps: true }
);

businessPartnerSchema.set('toJSON', {
  transform: (_doc, ret) => { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret; },
});

export default mongoose.model('BusinessPartner', businessPartnerSchema);
