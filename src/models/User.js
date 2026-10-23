import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true, sparse: true, unique: true },
    phone: { type: String, trim: true, sparse: true, unique: true },
    password: { type: String, required: true, minlength: 6, select: false },
    role: { type: String, enum: ['patient', 'doctor', 'admin'], default: 'patient' },
    age: Number,
    gender: String,
    city: String,
    pincode: String,
    district: String,
    state: String,
    locality: String,
    careFor: { type: String, enum: ['Myself', 'Parent', 'Spouse', 'Child', 'Other', null], default: null }, // who the patient account books care for
    bloodGroup: String,
    allergies: [String],
    conditions: [String],
    emergencyContact: {
      name: String,
      relation: String,
      phone: String,
    },
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider' },
    lastLoginAt: Date,
    // forgot password by SMS OTP (only used when Twilio Verify is not configured)
    resetOtp: { type: new mongoose.Schema({ hash: String, expiresAt: Date, attempts: Number }, { _id: false }), select: false, default: undefined },
    resetOtpSentAt: { type: [Date], select: false, default: undefined }, // recent sends, for rate limits
  },
  { timestamps: true }
);

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.matchPassword = function matchPassword(plain) {
  return bcrypt.compare(plain, this.password);
};

userSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.password;
    delete ret.resetOtp;
    delete ret.resetOtpSentAt;
    return ret;
  },
});

export default mongoose.model('User', userSchema);
