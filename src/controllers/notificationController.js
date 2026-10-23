import Notification from '../models/Notification.js';
import { ApiError, asyncHandler } from '../middleware/error.js';

// GET /api/notifications?limit=30  -> latest notifications + unread count (logged-in user)
export const listNotifications = asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  const [list, unread] = await Promise.all([
    Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(limit),
    Notification.countDocuments({ user: req.user._id, readAt: null }),
  ]);
  res.json({ success: true, notifications: list, unread });
});

// PATCH /api/notifications/:id/read
export const markRead = asyncHandler(async (req, res) => {
  const n = await Notification.findOne({ _id: req.params.id, user: req.user._id }).catch(() => null);
  if (!n) throw new ApiError(404, 'Notification not found');
  if (!n.readAt) { n.readAt = new Date(); await n.save(); }
  res.json({ success: true, notification: n });
});

// POST /api/notifications/read-all
export const markAllRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ user: req.user._id, readAt: null }, { readAt: new Date() });
  res.json({ success: true, unread: 0 });
});

// DELETE /api/notifications  (clear all of mine)
export const clearNotifications = asyncHandler(async (req, res) => {
  await Notification.deleteMany({ user: req.user._id });
  res.json({ success: true });
});
