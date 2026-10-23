import mongoose from 'mongoose';

// In-app notifications shown under the bell icon in the patient, doctor and admin dashboards.
const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, default: 'info' }, // appointment | request | account | review | payment | system
    title: { type: String, required: true, maxlength: 140 },
    body: { type: String, maxlength: 400 },
    link: String, // where clicking it should go, e.g. /doctor/dashboard?tab=Appointments
    readAt: Date,
  },
  { timestamps: true }
);
notificationSchema.index({ user: 1, createdAt: -1 });

notificationSchema.set('toJSON', {
  transform: (_doc, ret) => ({
    id: ret._id.toString(),
    type: ret.type,
    title: ret.title,
    body: ret.body,
    link: ret.link,
    read: !!ret.readAt,
    createdAt: ret.createdAt,
  }),
});

export default mongoose.model('Notification', notificationSchema);
