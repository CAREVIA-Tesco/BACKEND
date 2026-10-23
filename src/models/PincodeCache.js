import mongoose from 'mongoose';

// Results from the India Post PIN code lookup, kept so each PIN is fetched from the outside service only once.
const officeSchema = new mongoose.Schema(
  { name: String, district: String, state: String, block: String, branchType: String, delivery: String },
  { _id: false }
);

const pincodeCacheSchema = new mongoose.Schema(
  {
    pincode: { type: String, required: true, unique: true },
    found: { type: Boolean, default: true },
    district: String,
    state: String,
    offices: [officeSchema],
    source: String, // 'indiapost' | 'zippopotam'
  },
  { timestamps: true }
);

export default mongoose.model('PincodeCache', pincodeCacheSchema);
