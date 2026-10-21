import mongoose from 'mongoose';
import { shortDate } from '../utils/format.js';

const paymentSchema = new mongoose.Schema(
  {
    txnId: { type: String, unique: true },
    appointment: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment' },
    appointmentCode: String,
    patientUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    patientName: String,
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider' },
    providerName: String,
    amount: { type: Number, required: true },
    method: { type: String, default: 'upi' }, // gpay | phonepe | upi | cash
    status: { type: String, enum: ['Success', 'Pending', 'Failed', 'Refunded'], default: 'Pending' },
    type: { type: String, enum: ['Payment', 'Refund', 'Payout'], default: 'Payment' },
    paidAt: Date,
    note: String, // refund reason / payout note
  },
  { timestamps: true }
);

paymentSchema.pre('save', function assignTxn(next) {
  if (!this.txnId) this.txnId = `TXN${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
  next();
});

const METHOD_LABEL = { gpay: 'Google Pay', phonepe: 'PhonePe', upi: 'UPI', cash: 'Pay at Visit', bank: 'Bank Transfer' };

paymentSchema.set('toJSON', {
  transform: (_doc, ret) => ({
    id: ret._id.toString(),
    txnId: ret.txnId,
    appointmentId: ret.appointment?.toString(),
    appointmentCode: ret.appointmentCode,
    patient: ret.patientName,
    provider: ret.providerName,
    amount: ret.amount,
    amountLabel: `₹${Number(ret.amount || 0).toLocaleString('en-IN')}`,
    method: METHOD_LABEL[ret.method] || ret.method,
    status: ret.status,
    type: ret.type,
    providerId: ret.provider?.toString(),
    note: ret.note,
    date: shortDate(ret.paidAt || ret.createdAt),
    createdAt: ret.createdAt,
  }),
});

export default mongoose.model('Payment', paymentSchema);
