import mongoose from 'mongoose';

// Editable website content (testimonials, service cities, job openings ...) stored in the DB
const siteContentSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    items: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { timestamps: true }
);

siteContentSchema.set('toJSON', {
  transform: (_doc, ret) => ({ key: ret.key, items: ret.items, updatedAt: ret.updatedAt }),
});

export default mongoose.model('SiteContent', siteContentSchema);
