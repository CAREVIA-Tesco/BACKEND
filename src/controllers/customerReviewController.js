import mongoose from 'mongoose';
import CustomerReview from '../models/CustomerReview.js';
import { ApiError, asyncHandler } from '../middleware/error.js';

// Videos are kept in MongoDB (GridFS), so they survive redeploys on hosts without a permanent disk.
const MAX_VIDEO_BYTES = 60 * 1024 * 1024; // 60 MB
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v', 'video/3gpp'];
const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'reviewVideos' });
const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch { return null; } };
const clean = (v, max) => String(v ?? '').trim().slice(0, max);

async function removeVideo(fileId) {
  if (!fileId) return;
  try { await bucket().delete(oid(fileId)); } catch { /* already gone */ }
}

async function videoInfo(id) {
  const _id = oid(id);
  if (!_id) return null;
  const [file] = await bucket().find({ _id }).toArray();
  return file || null;
}

const ordered = (q) => q.sort({ order: 1, createdAt: -1 });

// GET /api/customer-reviews  (public – only reviews the admin has published)
export const publicReviews = asyncHandler(async (_req, res) => {
  const reviews = await ordered(CustomerReview.find({ show: true }));
  res.json({ success: true, reviews });
});

// videos uploaded in the form but never saved with a review (admin cancelled) are removed after a few hours
async function removeUnusedVideos() {
  const old = await bucket().find({ uploadDate: { $lt: new Date(Date.now() - 6 * 60 * 60 * 1000) } }).toArray();
  if (!old.length) return;
  const used = new Set((await CustomerReview.find({ 'video.fileId': { $in: old.map((f) => f._id) } }).select('video.fileId').lean()).map((r) => String(r.video.fileId)));
  for (const f of old) if (!used.has(String(f._id))) await removeVideo(f._id);
}

// GET /api/admin/customer-reviews
export const adminReviews = asyncHandler(async (_req, res) => {
  removeUnusedVideos().catch(() => {});
  const reviews = await ordered(CustomerReview.find());
  res.json({ success: true, reviews });
});

async function fieldsFrom(body, existing) {
  const type = existing?.type || (body.type === 'video' ? 'video' : body.type === 'text' ? 'text' : null);
  if (!type) throw new ApiError(400, 'Choose a text review or a video review');
  const name = clean(body.name ?? existing?.name, 80);
  if (!name) throw new ApiError(400, "Please enter the customer's name");
  const f = { type, name, place: clean(body.place ?? existing?.place, 80) };
  if (body.show !== undefined) f.show = body.show === true || body.show === 'true' || body.show === 'show';
  if (body.order !== undefined && Number.isFinite(Number(body.order))) f.order = Number(body.order);
  if (type === 'text') {
    f.text = clean(body.text ?? existing?.text, 1200);
    if (f.text.length < 5) throw new ApiError(400, "Please enter the customer's feedback");
  } else {
    const videoId = body.videoId ?? existing?.video?.fileId?.toString();
    if (!videoId) throw new ApiError(400, 'Please upload the review video');
    if (!existing || String(existing.video?.fileId) !== String(videoId)) {
      const file = await videoInfo(videoId);
      if (!file) throw new ApiError(400, 'The uploaded video was not found – please upload it again');
      f.video = { fileId: file._id, mime: file.metadata?.mime || 'video/mp4', size: file.length, fileName: file.filename };
    }
    if (body.text !== undefined) f.text = clean(body.text, 300); // optional caption
  }
  return f;
}

// POST /api/admin/customer-reviews  { type, name, place?, text | videoId, show? }
export const createReview = asyncHandler(async (req, res) => {
  const fields = await fieldsFrom(req.body || {});
  const review = await CustomerReview.create(fields);
  res.status(201).json({ success: true, message: 'Review added – it is now shown on the website', review });
});

// PUT /api/admin/customer-reviews/:id
export const updateReview = asyncHandler(async (req, res) => {
  const review = await CustomerReview.findById(oid(req.params.id));
  if (!review) throw new ApiError(404, 'Review not found');
  const oldVideo = review.video?.fileId;
  const fields = await fieldsFrom(req.body || {}, review);
  Object.assign(review, fields);
  await review.save();
  if (fields.video && oldVideo && String(oldVideo) !== String(fields.video.fileId)) await removeVideo(oldVideo);
  res.json({ success: true, message: 'Review updated', review });
});

// DELETE /api/admin/customer-reviews/:id
export const deleteReview = asyncHandler(async (req, res) => {
  const review = await CustomerReview.findById(oid(req.params.id));
  if (!review) throw new ApiError(404, 'Review not found');
  await CustomerReview.deleteOne({ _id: review._id });
  await removeVideo(review.video?.fileId);
  res.json({ success: true, message: 'Review deleted' });
});

// POST /api/admin/review-videos   (raw video file in the body, Content-Type: video/mp4 …)
export const uploadVideo = (req, res, next) => {
  const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!VIDEO_TYPES.includes(mime)) return next(new ApiError(400, 'Please upload an MP4, MOV or WebM video'));
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > MAX_VIDEO_BYTES) return next(new ApiError(413, 'The video is too large – please upload a video under 60 MB'));
  const fileName = clean(decodeURIComponent(String(req.headers['x-file-name'] || 'review-video')), 120);
  const upload = bucket().openUploadStream(fileName, { metadata: { mime, uploadedBy: req.user?._id } });
  let size = 0;
  let failed = false;
  const fail = (err) => {
    if (failed) return;
    failed = true;
    upload.abort().catch(() => {});
    req.unpipe(upload);
    req.resume();
    next(err);
  };
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_VIDEO_BYTES) fail(new ApiError(413, 'The video is too large – please upload a video under 60 MB'));
  });
  req.on('error', fail);
  upload.on('error', fail);
  upload.on('finish', () => {
    if (failed) return;
    if (!size) { removeVideo(upload.id); return next(new ApiError(400, 'The video file is empty')); }
    res.status(201).json({ success: true, videoId: upload.id.toString(), size, mime, fileName });
  });
  req.pipe(upload);
};

// GET /api/media/review-videos/:id   (public; supports Range so the video can be seeked / played on iPhone)
export const streamVideo = asyncHandler(async (req, res) => {
  const file = await videoInfo(req.params.id);
  if (!file) throw new ApiError(404, 'Video not found');
  // only videos attached to a published review are public
  const used = await CustomerReview.exists({ 'video.fileId': file._id, show: true });
  if (!used && req.query.preview !== '1') throw new ApiError(404, 'Video not found');
  const total = file.length;
  res.setHeader('Content-Type', file.metadata?.mime || 'video/mp4');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  let start = 0;
  let end = total - 1;
  if (range) {
    start = range[1] ? parseInt(range[1], 10) : Math.max(0, total - parseInt(range[2], 10));
    end = range[1] && range[2] ? Math.min(parseInt(range[2], 10), total - 1) : total - 1;
    if (start >= total || start > end) { res.status(416).setHeader('Content-Range', `bytes */${total}`); return res.end(); }
    res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
  }
  res.setHeader('Content-Length', end - start + 1);
  bucket().openDownloadStream(file._id, { start, end: end + 1 }).on('error', () => res.destroy()).pipe(res);
});
