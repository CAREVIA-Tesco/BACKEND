import Review from '../models/Review.js';
import Appointment from '../models/Appointment.js';
import Provider from '../models/Provider.js';
import { ApiError, asyncHandler } from '../middleware/error.js';
import { notifyProvider, LINKS } from '../services/notify.js';

// Recalculate a provider's average rating and review count
export async function refreshProviderRating(providerId) {
  const reviews = await Review.find({ provider: providerId }).select('rating').lean();
  const count = reviews.length;
  const avg = count ? reviews.reduce((t, r) => t + r.rating, 0) / count : 0;
  const provider = await Provider.findById(providerId);
  if (!provider) return;
  provider.reviews = count;
  if (count) provider.rating = Math.round(avg * 10) / 10;
  await provider.save();
}

// POST /api/reviews  { appointmentId, rating, comment }  (patient, own completed appointment)
export const createReview = asyncHandler(async (req, res) => {
  const { appointmentId, comment } = req.body;
  const rating = Number(req.body.rating);
  if (!appointmentId) throw new ApiError(400, 'Appointment is required');
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new ApiError(400, 'Rating must be between 1 and 5');

  const appt = await Appointment.findById(appointmentId);
  if (!appt || !appt.patientUser?.equals(req.user._id)) throw new ApiError(404, 'Appointment not found');
  if (appt.status !== 'Completed') throw new ApiError(400, 'You can only review a completed visit');
  if (appt.reviewed || (await Review.findOne({ appointment: appt._id }))) throw new ApiError(409, 'You have already reviewed this visit');

  const review = await Review.create({
    appointment: appt._id,
    provider: appt.provider,
    patientUser: req.user._id,
    patientName: req.user.name,
    rating,
    comment: comment ? String(comment).trim() : undefined,
  });
  appt.reviewed = true;
  await appt.save();
  await refreshProviderRating(appt.provider);
  await notifyProvider(appt.provider, { type: 'review', title: `New ${rating}-star review`, body: `${String(req.user.name).split(' ')[0]} reviewed visit ${appt.code}${review.comment ? `: "${review.comment.slice(0, 120)}"` : '.'}`, link: LINKS.doctor('Reviews') });
  res.status(201).json({ success: true, message: 'Thank you for your feedback', review });
});

// GET /api/reviews?providerId=&limit=   (public)
export const listReviews = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.providerId) filter.provider = req.query.providerId;
  if (req.query.spec) {
    const specs = String(req.query.spec).split(',').map((x) => x.trim()).filter(Boolean);
    const ids = await Provider.find({ spec: { $in: specs } }).select('_id').lean();
    filter.provider = { $in: ids.map((p) => p._id) };
  }
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const reviews = await Review.find(filter).sort({ createdAt: -1 }).limit(limit).populate('provider', 'name spec city');
  const all = await Review.find(filter).select('rating').lean();
  const distribution = [5, 4, 3, 2, 1].map((stars) => {
    const count = all.filter((r) => r.rating === stars).length;
    return { stars, count, pct: all.length ? Math.round((count / all.length) * 100) : 0 };
  });
  const average = all.length ? Math.round((all.reduce((t, r) => t + r.rating, 0) / all.length) * 10) / 10 : 0;
  res.json({ success: true, reviews, summary: { count: all.length, average, distribution } });
});
