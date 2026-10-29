import mongoose from 'mongoose';
import { nextCode } from './Counter.js';
import { offersOf, modesOf } from '../utils/slots.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const providerServiceSchema = new mongoose.Schema(
  {
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service' },
    serviceKey: String,
    name: { type: String, required: true },
    description: String,
    price: Number,
    homeAvailable: { type: Boolean, default: false },
    onlineAvailable: { type: Boolean, default: false },
    clinicAvailable: { type: Boolean, default: false },
  },
  { _id: true }
);

const providerSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    code: { type: String, unique: true, sparse: true }, // DOC-0001
    name: { type: String, required: true, trim: true },
    profession: { type: String, default: 'MBBS Doctor' }, // MBBS Doctor, Nurse, Caretaker, Lab Centre ...
    specialization: String, // sub-specialization chosen during onboarding
    qualification: String,
    registrationNumber: String,
    registrationCouncil: String,
    contactPerson: String, // Lab Centre: Owner or contact person name
    centreType: String, // Lab Centre: Diagnostic Lab, Pathology, Imaging, etc.
    servicesOffered: [String], // Array of active service names offered
    services: [providerServiceSchema], // Structured services offered by this professional
    accreditation: String, // Lab Centre: NABL, ICMR, ISO, etc.
    careTypes: [String], // Caretaker: Types of care provided (Elderly, Bedridden, etc.)
    trainingCertificates: String, // Caretaker: Training certificates / details
    bio: { type: String, maxlength: 600 },
    pincode: String,
    homeVisitRadiusKm: Number,
    gender: { type: String, enum: ['Male', 'Female', 'Other', null], default: null },
    spec: { type: String, required: true }, // canonical label used across the UI ("General Physician")
    isDoctor: { type: Boolean, default: true },
    experience: { type: Number, default: 0 },
    languages: [String],
    rating: { type: Number, default: 0 }, // average of real patient reviews
    reviews: { type: Number, default: 0 },
    city: String,
    state: String,
    district: String,
    locality: String,
    email: String,
    phone: String,
    img: String,
    fee: Number, // home / visit fee (care professionals)
    clinicFee: Number,
    onlineFee: Number,
    // which consultations the doctor offers – shown on the website and used by booking
    consultTypes: {
      home: Boolean,
      clinic: Boolean,
      online: Boolean,
    },
    clinic: {
      name: String,
      address: String,
      phone: String,
      website: String,
    },
    // timings per consultation type: { clinic: { days: ['Mon'], sessions: [{ from: '10:00', to: '13:00' }], slotMins: 30 }, online: {...}, home: {...} }
    hours: { type: Object, default: undefined },
    // identity proof: the number and photo are only sent to the Carevaa admin team (never public)
    aadhaar: {
      number: { type: String, select: false },
      last4: String,
      photo: { type: String, select: false }, // data:image/... (JPG / PNG / WebP)
      photoUploaded: { type: Boolean, default: false },
      updatedAt: Date,
    },
    bank: {
      holderName: String,
      bankName: String,
      accountNumber: { type: String, select: false },
      accountLast4: String,
      ifsc: String,
    },
    schedule: {
      type: Object,
      default: () => Object.fromEntries(DAYS.map((d) => [d, []])),
    },
    status: { type: String, enum: ['PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED'], default: 'PENDING' },
    verifiedAt: Date,
  },
  { timestamps: true }
);

providerSchema.pre('save', async function assignCode(next) {
  if (!this.code) this.code = await nextCode('provider', 'DOC');
  next();
});

providerSchema.index({ name: 'text', spec: 'text', specialization: 'text' });

providerSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    ret.exp = `${ret.experience || 0} Years`;
    ret.loc = ret.city || '';
    ret.rating = ret.reviews ? Number(ret.rating || 0).toFixed(1) : 'New'; // no reviews yet -> no rating
    if (ret.bank) delete ret.bank.accountNumber;
    if (ret.aadhaar && !Object.keys(ret.aadhaar).length) delete ret.aadhaar;
    if (ret.user) ret.user = ret.user.toString();
    ret.offers = offersOf(ret);
    ret.modes = modesOf(ret);
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export { DAYS };
export default mongoose.model('Provider', providerSchema);
