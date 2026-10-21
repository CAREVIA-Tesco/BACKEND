import mongoose from 'mongoose';
import { dateLabel, shortDate, STATUS_COLORS } from '../utils/format.js';

const appointmentSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true }, // APT-10284
    patientUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    patientName: { type: String, default: 'Guest Patient' },
    patientPhone: String,
    patientEmail: String,
    reason: String,
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider', required: true },
    providerName: String,
    providerSpec: String,
    scheduledAt: { type: Date, required: true },
    timeSlot: { type: String, required: true }, // "09:00 AM"
    duration: String, // "12 Hours" for care services
    consultationType: { type: String, enum: ['online', 'clinic', 'home'], default: 'online' },
    serviceType: String, // physiotherapy, home-doctor, ...
    title: String,
    location: String,
    fee: { type: Number, default: 0 },
    status: { type: String, enum: ['Waiting', 'Confirmed', 'Completed', 'Cancelled'], default: 'Waiting' },
    paymentStatus: { type: String, enum: ['Paid', 'Pending', 'Refunded'], default: 'Pending' },
    paymentMethod: String,
    rescheduled: { type: Boolean, default: false },
    visitNotes: {
      symptoms: String,
      prescription: String,
      bloodPressure: String, // e.g. "120/80"
      weight: Number, // kg
      completedAt: Date,
    },
    cancelledBy: String,
    enquiry: { type: mongoose.Schema.Types.ObjectId, ref: 'Enquiry' }, // created from a website request
    assignedBy: String, // 'admin' (care team assigned) | 'provider' (professional accepted an open request)
    reviewed: { type: Boolean, default: false },
  },
  { timestamps: true }
);

appointmentSchema.pre('save', async function assignCode(next) {
  if (this.code) return next();
  const count = await this.constructor.countDocuments();
  this.code = `APT-${10284 + count}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  next();
});

const TYPE_LABEL = { online: 'Online', clinic: 'In-Clinic', home: 'Home Visit' };

appointmentSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    const id = ret._id.toString();
    const provider = ret.provider && typeof ret.provider === 'object' && ret.provider._id ? ret.provider : null;
    return {
      id,
      code: ret.code,
      // fields used by doctor & patient dashboards
      date: dateLabel(ret.scheduledAt),
      time: ret.rescheduled
        ? `${ret.timeSlot} - Rescheduled`
        : ret.duration
          ? `${ret.timeSlot} (${ret.duration})`
          : ret.timeSlot,
      title: ret.title,
      status: ret.status,
      statusColor: STATUS_COLORS[ret.status] || 'gray',
      patient: ret.patientName,
      phone: ret.patientPhone || '-',
      location: ret.location,
      // extra fields used by the admin panel
      patientId: ret.patientUser ? ret.patientUser.toString() : null,
      patientEmail: ret.patientEmail,
      providerId: provider ? provider._id.toString() : ret.provider?.toString(),
      provider: ret.providerName,
      providerImg: provider?.img,
      specialization: ret.providerSpec,
      shortDate: shortDate(ret.scheduledAt),
      scheduledAt: ret.scheduledAt,
      timeSlot: ret.timeSlot,
      duration: ret.duration,
      consultationType: ret.consultationType,
      type: TYPE_LABEL[ret.consultationType] || ret.consultationType,
      serviceType: ret.serviceType,
      fee: ret.fee,
      payment: `₹${ret.fee || 0}`,
      paymentStatus: ret.paymentStatus,
      paymentMethod: ret.paymentMethod,
      rescheduled: ret.rescheduled,
      reason: ret.reason,
      fromRequest: !!ret.enquiry,
      enquiryId: ret.enquiry ? ret.enquiry.toString() : null,
      assignedBy: ret.assignedBy,
      visitNotes: ret.visitNotes,
      reviewed: !!ret.reviewed,
      reason: ret.reason,
      createdAt: ret.createdAt,
    };
  },
});

export default mongoose.model('Appointment', appointmentSchema);
