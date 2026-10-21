import mongoose from 'mongoose';
import { shortDate } from '../utils/format.js';

const reviewSchema = new mongoose.Schema(
  {
    appointment: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', unique: true, sparse: true },
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider', required: true },
    patientUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    patientName: String,
    rating: { type: Number, min: 1, max: 5, required: true },
    comment: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true }
);

reviewSchema.set('toJSON', {
  transform: (_doc, ret) => ({
    id: ret._id.toString(),
    appointmentId: ret.appointment?.toString(),
    providerId: (ret.provider?._id || ret.provider)?.toString(),
    providerName: ret.provider?.name,
    providerSpec: ret.provider?.spec,
    providerCity: ret.provider?.city,
    patient: ret.patientName,
    rating: ret.rating,
    comment: ret.comment,
    date: shortDate(ret.createdAt),
    createdAt: ret.createdAt,
  }),
});

export default mongoose.model('Review', reviewSchema);
