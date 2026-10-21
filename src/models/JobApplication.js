import mongoose from 'mongoose';

const jobApplicationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    role: String,
    city: String,
    experience: String,
    about: String,
    source: { type: String, default: 'jobs' }, // jobs | careers
    status: { type: String, enum: ['New', 'Contacted', 'Hired', 'Rejected'], default: 'New' },
  },
  { timestamps: true }
);

jobApplicationSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export default mongoose.model('JobApplication', jobApplicationSchema);
