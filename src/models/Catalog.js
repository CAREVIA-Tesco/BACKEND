import mongoose from 'mongoose';

const toJSON = {
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
};

const specializationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    description: String,
    icon: { type: String, default: 'Stethoscope' },
    // provider "spec"/"specialization" values that belong to this specialization (used for live counts)
    matches: [String],
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  },
  { timestamps: true }
);
specializationSchema.set('toJSON', toJSON);

const serviceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    // URL slug: the website page is /services/<key> (or the service's own page for the built-in ones)
    key: { type: String, trim: true, lowercase: true, unique: true, sparse: true },
    short: String, // one-line tagline on the website cards
    desc: String,
    price: String,
    image: String, // website card / page image (URL or /public path)
    order: { type: Number, default: 100 },
    icon: { type: String, default: 'Stethoscope' },
    // provider "spec" values whose bookings count towards this service
    matches: [String],
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  },
  { timestamps: true }
);
serviceSchema.set('toJSON', toJSON);

export const Specialization = mongoose.model('Specialization', specializationSchema);
export const Service = mongoose.model('Service', serviceSchema);
