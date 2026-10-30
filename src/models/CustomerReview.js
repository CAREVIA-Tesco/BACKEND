import mongoose from 'mongoose';

// Reviews the admin team adds for the homepage "Happy Customers" section:
// a written review (name + feedback) or a video review (name + uploaded video, stored in GridFS).
const customerReviewSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['text', 'video'], required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    place: { type: String, trim: true, maxlength: 80 }, // optional, e.g. "Chennai" or "Daughter of a patient"
    text: { type: String, trim: true, maxlength: 1200 },
    video: {
      fileId: mongoose.Schema.Types.ObjectId,
      mime: String,
      size: Number,
      fileName: String,
    },
    show: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

customerReviewSchema.set('toJSON', {
  transform: (_doc, ret) => ({
    id: ret._id.toString(),
    type: ret.type,
    name: ret.name,
    place: ret.place || '',
    text: ret.text || '',
    videoId: ret.video?.fileId ? ret.video.fileId.toString() : null,
    videoMime: ret.video?.mime,
    videoSize: ret.video?.size,
    videoFileName: ret.video?.fileName,
    show: ret.show !== false,
    order: ret.order || 0,
    createdAt: ret.createdAt,
    updatedAt: ret.updatedAt,
  }),
});

export default mongoose.model('CustomerReview', customerReviewSchema);
