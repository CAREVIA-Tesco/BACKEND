import SiteContent from '../models/SiteContent.js';
import { ApiError, asyncHandler } from '../middleware/error.js';

const KEY = /^[a-z0-9-]{2,40}$/;

// GET /api/content/:key   (public) – e.g. testimonials, cities, jobs
export const getContent = asyncHandler(async (req, res) => {
  if (!KEY.test(req.params.key)) throw new ApiError(400, 'Invalid content key');
  const doc = await SiteContent.findOne({ key: req.params.key });
  res.json({ success: true, key: req.params.key, items: doc?.items || [] });
});

// PUT /api/content/:key  { items: [...] }  (admin)
export const saveContent = asyncHandler(async (req, res) => {
  if (!KEY.test(req.params.key)) throw new ApiError(400, 'Invalid content key');
  if (!Array.isArray(req.body.items)) throw new ApiError(400, 'items must be an array');
  let doc = await SiteContent.findOne({ key: req.params.key });
  if (!doc) doc = new SiteContent({ key: req.params.key });
  doc.items = req.body.items;
  doc.markModified('items');
  await doc.save();
  res.json({ success: true, key: doc.key, items: doc.items });
});
