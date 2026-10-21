import mongoose from 'mongoose';
import { shortDate } from '../utils/format.js';

// Leads from the public website: "Request a callback", care-plan enquiries,
// "Post your requirement", Contact Us and Partner With Us forms, and the 2-step "Book Now" request.
export const ENQUIRY_TYPES = ['booking', 'callback', 'plan', 'requirement', 'contact', 'partner', 'referral'];
export const ENQUIRY_STATUSES = ['New', 'Contacted', 'Scheduled', 'Converted', 'Closed'];

const timelineSchema = new mongoose.Schema(
  {
    status: String,
    note: String, // shown to the customer on the tracking page
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const noteSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    by: String,
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const enquirySchema = new mongoose.Schema(
  {
    code: { type: String, unique: true },
    type: { type: String, enum: ENQUIRY_TYPES, default: 'callback' },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    city: { type: String, trim: true },
    pincode: { type: String, trim: true },
    service: { type: String, trim: true },
    plan: { type: String, trim: true },
    subject: { type: String, trim: true },
    organisation: { type: String, trim: true },
    referrer: { name: { type: String, trim: true }, phone: { type: String, trim: true } }, // 'Refer a friend'
    preferredDate: Date,
    preferredTime: { type: String, trim: true },
    message: { type: String, trim: true, maxlength: 2000 },
    source: { type: String, trim: true },
    patientUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ENQUIRY_STATUSES, default: 'New' },
    timeline: [timelineSchema],
    notes: [noteSchema], // internal, admin only
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider' },
    providerName: String,
    appointment: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment' },
    appointmentCode: String,
    followUpAt: Date,
    broadcast: { type: Boolean, default: false }, // visible to matching professionals as an open request
    broadcastAt: Date,
    declinedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Provider' }],
    closedReason: String,
  },
  { timestamps: true }
);

enquirySchema.index({ phone: 1, createdAt: -1 });

enquirySchema.pre('save', async function assignCode(next) {
  if (this.code) return next();
  const count = await this.constructor.countDocuments();
  this.code = `ENQ-${50101 + count}`;
  next();
});

const STATUS_TEXT = {
  New: 'Request received – a care advisor will call you shortly.',
  Contacted: 'Our care advisor has spoken with you.',
  Scheduled: 'Your care visit has been scheduled.',
  Converted: 'Booking confirmed.',
  Closed: 'Request closed.',
};
export const statusText = (s) => STATUS_TEXT[s] || s;

const base = (ret) => ({
  id: ret._id.toString(),
  code: ret.code,
  type: ret.type,
  name: ret.name,
  phone: ret.phone,
  email: ret.email,
  city: ret.city,
  pincode: ret.pincode,
  service: ret.service,
  plan: ret.plan,
  subject: ret.subject,
  organisation: ret.organisation,
  preferredDate: ret.preferredDate,
  preferredDateLabel: ret.preferredDate ? shortDate(ret.preferredDate) : '',
  preferredTime: ret.preferredTime,
  message: ret.message,
  status: ret.status,
  statusText: statusText(ret.status),
  timeline: (ret.timeline || []).map((t) => ({ status: t.status, note: t.note, at: t.at })),
  provider: ret.providerName,
  providerId: ret.provider?.toString(),
  appointmentCode: ret.appointmentCode,
  closedReason: ret.closedReason,
  referrerName: ret.referrer?.name,
  createdAt: ret.createdAt,
  createdLabel: shortDate(ret.createdAt),
});

enquirySchema.set('toJSON', {
  transform: (_doc, ret) => ({
    ...base(ret),
    source: ret.source,
    referrerPhone: ret.referrer?.phone,
    broadcast: !!ret.broadcast,
    declinedCount: (ret.declinedBy || []).length,
    followUpAt: ret.followUpAt,
    notes: (ret.notes || []).map((n) => ({ text: n.text, by: n.by, at: n.at })),
    patientUser: ret.patientUser?.toString(),
    updatedAt: ret.updatedAt,
  }),
});

// What a customer may see (no internal notes)
enquirySchema.methods.toPublic = function toPublic() {
  return base(this.toObject());
};

export default mongoose.model('Enquiry', enquirySchema);
