import JobApplication from '../models/JobApplication.js';
import { ApiError, asyncHandler } from '../middleware/error.js';
import { notifyAdmins } from '../services/notify.js';

// POST /api/applications  (public "Find Jobs" / "Careers" forms)
export const createApplication = asyncHandler(async (req, res) => {
  const { name, phone, email, role, city, experience, about, source } = req.body;
  if (!name || !String(name).trim()) throw new ApiError(400, 'Full name is required');
  if (!phone || String(phone).replace(/\D/g, '').length < 10) throw new ApiError(400, 'A valid 10-digit mobile number is required');
  const application = await JobApplication.create({ name, phone, email, role, city, experience, about, source });
  await notifyAdmins({ type: 'account', title: 'New job application', body: `${name}${role ? ` applied for ${role}` : ' applied'}${city ? ` (${city})` : ''}.`, link: '/admin/applications' });
  res.status(201).json({ success: true, message: 'Application submitted successfully', application });
});

// GET /api/applications  (admin)
export const listApplications = asyncHandler(async (_req, res) => {
  const applications = await JobApplication.find().sort({ createdAt: -1 });
  res.json({ success: true, applications });
});

// PATCH /api/applications/:id  { status }  (admin)
export const updateApplication = asyncHandler(async (req, res) => {
  const application = await JobApplication.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true, runValidators: true });
  if (!application) throw new ApiError(404, 'Application not found');
  res.json({ success: true, application });
});
