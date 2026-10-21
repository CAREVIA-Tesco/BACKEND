import mongoose from 'mongoose';
import { shortDate } from '../utils/format.js';

const emergencySchema = new mongoose.Schema(
  {
    code: { type: String, unique: true },
    patientUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    patientName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    location: { type: String, required: true, trim: true },
    type: { type: String, default: 'Emergency Medical Assistance' },
    priority: { type: String, enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'], default: 'HIGH' },
    notes: String,
    status: { type: String, enum: ['Waiting', 'Assigned', 'Resolved'], default: 'Waiting' },
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider' },
    providerName: String,
    resolvedAt: Date,
  },
  { timestamps: true }
);

emergencySchema.pre('save', async function assignCode(next) {
  if (this.code) return next();
  const count = await this.constructor.countDocuments();
  this.code = `EMR-${10284 + count}`;
  next();
});

emergencySchema.set('toJSON', {
  transform: (_doc, ret) => ({
    id: ret._id.toString(),
    code: ret.code,
    patient: ret.patientName,
    phone: ret.phone,
    location: ret.location,
    type: ret.type,
    priority: ret.priority,
    notes: ret.notes,
    status: ret.status,
    providerId: ret.provider?.toString(),
    provider: ret.providerName,
    requestedDate: shortDate(ret.createdAt),
    requestedTime: new Date(ret.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: process.env.TZ_DISPLAY || 'Asia/Kolkata' }).toUpperCase(),
    resolvedAt: ret.resolvedAt,
    createdAt: ret.createdAt,
  }),
});

export default mongoose.model('EmergencyRequest', emergencySchema);
