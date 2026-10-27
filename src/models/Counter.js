import mongoose from 'mongoose';

// Running numbers for readable IDs: ENQ-0001, APT-0001, DOC-0001 …
const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false });
const Counter = mongoose.model('Counter', counterSchema);

// next code for a series, e.g. nextCode('enquiry', 'ENQ') -> 'ENQ-0007'
export async function nextCode(series, prefix) {
  const c = await Counter.findOneAndUpdate({ _id: series }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return `${prefix}-${String(c.seq).padStart(4, '0')}`;
}

export default Counter;
