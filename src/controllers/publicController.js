import Provider from '../models/Provider.js';
import Appointment from '../models/Appointment.js';
import Review from '../models/Review.js';
import { asyncHandler } from '../middleware/error.js';

const round1 = (n) => Math.round(n * 10) / 10;

// GET /api/public/stats – real numbers for the marketing pages (no hard-coded "500+")
export const publicStats = asyncHandler(async (_req, res) => {
  const [providers, completed, reviews] = await Promise.all([
    Provider.find({ status: 'ACTIVE' }).select('spec isDoctor city fee clinicFee onlineFee').lean(),
    Appointment.find({ status: 'Completed' }).select('providerSpec patientUser patientName patientPhone').lean(),
    Review.find().select('rating provider').lean(),
  ]);

  const bySpec = {};
  providers.forEach((p) => {
    bySpec[p.spec] = bySpec[p.spec] || { providers: 0, completedVisits: 0, rating: null, reviews: 0, minFee: null, ids: [] };
    bySpec[p.spec].providers += 1;
    const fees = [p.fee, p.clinicFee, p.onlineFee].filter((f) => f > 0);
    if (fees.length) bySpec[p.spec].minFee = Math.min(bySpec[p.spec].minFee ?? Infinity, ...fees);
    bySpec[p.spec].ids.push(p._id.toString());
  });
  completed.forEach((a) => {
    if (bySpec[a.providerSpec]) bySpec[a.providerSpec].completedVisits += 1;
  });
  Object.values(bySpec).forEach((s) => {
    const rs = reviews.filter((r) => s.ids.includes(r.provider.toString()));
    s.reviews = rs.length;
    s.rating = rs.length ? round1(rs.reduce((t, r) => t + r.rating, 0) / rs.length) : null;
    delete s.ids;
  });

  const patientKeys = new Set(completed.map((a) => (a.patientUser ? a.patientUser.toString() : `${a.patientName}|${a.patientPhone}`)));
  res.json({
    success: true,
    stats: {
      providers: providers.length,
      doctors: providers.filter((p) => p.isDoctor).length,
      cities: new Set(providers.map((p) => p.city).filter((c) => c && c !== 'Virtual')).size,
      completedVisits: completed.length,
      patientsServed: patientKeys.size,
      reviews: reviews.length,
      rating: reviews.length ? round1(reviews.reduce((t, r) => t + r.rating, 0) / reviews.length) : null,
      bySpec,
    },
  });
});
