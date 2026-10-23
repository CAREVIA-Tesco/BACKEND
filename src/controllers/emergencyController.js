import EmergencyRequest from '../models/EmergencyRequest.js';
import Provider from '../models/Provider.js';
import { ApiError, asyncHandler } from '../middleware/error.js';
import { notifyAdmins } from '../services/notify.js';

// POST /api/emergency  (public – logged-in patient is linked automatically)
export const createEmergency = asyncHandler(async (req, res) => {
  const { patientName, phone, location, type, priority, notes } = req.body;
  const name = patientName || req.user?.name;
  if (!name) throw new ApiError(400, 'Patient name is required');
  if (!phone || String(phone).replace(/\D/g, '').length < 10) throw new ApiError(400, 'A valid phone number is required');
  if (!location) throw new ApiError(400, 'Location is required');
  const request = await EmergencyRequest.create({
    patientUser: req.user?.role === 'patient' ? req.user._id : undefined,
    patientName: name,
    phone,
    location,
    type,
    priority,
    notes,
  });
  await notifyAdmins({ type: 'urgent', title: 'Emergency request', body: `${name} (${phone}) – ${type || 'emergency'} at ${location}.`, link: '/admin/emergency' });
  res.status(201).json({ success: true, message: 'Emergency request received. Our team will call you shortly.', request });
});

// GET /api/emergency  (admin)
export const listEmergencies = asyncHandler(async (_req, res) => {
  const requests = await EmergencyRequest.find().sort({ createdAt: -1 }).limit(500);
  res.json({ success: true, requests });
});

// PATCH /api/emergency/:id  { status, providerId }  (admin)
export const updateEmergency = asyncHandler(async (req, res) => {
  const request = await EmergencyRequest.findById(req.params.id);
  if (!request) throw new ApiError(404, 'Emergency request not found');
  if (req.body.providerId) {
    const provider = await Provider.findById(req.body.providerId);
    if (!provider) throw new ApiError(404, 'Provider not found');
    request.provider = provider._id;
    request.providerName = provider.name;
    if (request.status === 'Waiting') request.status = 'Assigned';
  }
  if (req.body.status) {
    if (!['Waiting', 'Assigned', 'Resolved'].includes(req.body.status)) throw new ApiError(400, 'Invalid status');
    request.status = req.body.status;
    if (req.body.status === 'Resolved') request.resolvedAt = new Date();
  }
  await request.save();
  res.json({ success: true, request });
});
