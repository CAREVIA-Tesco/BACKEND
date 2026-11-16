import JobApplication from '../models/JobApplication.js';
import { ApiError, asyncHandler } from '../middleware/error.js';
import { notifyAdmins } from '../services/notify.js';
import { cleanMobile, isEmail, isName } from '../utils/validate.js';

const clean = (v, max = 200) => String(v ?? '').trim().slice(0, max);

// POST /api/applications  (public "Find Jobs" / "Careers" forms)
export const createApplication = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const name = clean(b.name, 100);
  const phone = cleanMobile(b.phone);
  const email = clean(b.email, 120).toLowerCase();
  const role = clean(b.role, 100);
  const city = clean(b.city, 80);
  const experience = clean(b.experience, 20);
  const about = clean(b.about, 2000);
  const source = clean(b.source, 60);
  if (!isName(name)) throw new ApiError(400, 'Please enter your full name (letters only)');
  if (!phone) throw new ApiError(400, 'Please enter a valid 10-digit mobile number');
  if (email && !isEmail(email)) throw new ApiError(400, 'Please enter a valid email address');
  if (!role || role === 'Select Role') throw new ApiError(400, 'Please select the role you are applying for');
  if (!city) throw new ApiError(400, 'Please enter your city');
  if (experience && !/^\d{1,2}(\.\d)?$/.test(experience)) throw new ApiError(400, 'Experience must be a number of years, e.g. 5');
  const application = await JobApplication.create({ name, phone, email: email || undefined, role, city, experience, about, source });
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
