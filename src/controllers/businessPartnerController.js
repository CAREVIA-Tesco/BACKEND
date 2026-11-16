import BusinessPartner, { PARTNER_STATUSES, BUSINESS_CATEGORIES } from '../models/BusinessPartner.js';
import { nextCode } from '../models/Counter.js';
import { ApiError, asyncHandler } from '../middleware/error.js';
import { notifyAdmins } from '../services/notify.js';

const clean = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const digits = (v) => String(v || '').replace(/\D/g, '').slice(-10);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PARTNER_SERVICES = [
  'Doctor consultations', 'Home visits', 'Nursing care', 'Caretaker / attendant services', 'Physiotherapy',
  'Lab tests & sample collection', 'Scans & imaging', 'Pharmacy & medicine delivery', 'Ambulance',
  'Medical equipment rental', 'Ayurveda / Homeopathy', 'Health checkup packages',
];

// GET /api/business-partners/options – lists used by the registration form
export const partnerOptions = (_req, res) => res.json({ success: true, categories: BUSINESS_CATEGORIES, services: PARTNER_SERVICES });

// POST /api/business-partners  (public) – a business applies to partner with Carevaa
export const registerPartner = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const f = {
    businessName: clean(b.businessName, 150),
    category: clean(b.category, 80),
    categoryOther: clean(b.categoryOther, 80),
    contactPerson: clean(b.contactPerson, 100),
    designation: clean(b.designation, 80),
    phone: digits(b.phone),
    email: clean(b.email, 120).toLowerCase(),
    website: clean(b.website, 200),
    address: clean(b.address, 300),
    pincode: clean(b.pincode, 6),
    city: clean(b.city, 80),
    district: clean(b.district, 80),
    state: clean(b.state, 80),
    locality: clean(b.locality, 120),
    services: (Array.isArray(b.services) ? b.services : []).map((s) => clean(s, 80)).filter((s) => PARTNER_SERVICES.includes(s)),
    servicesOther: clean(b.servicesOther, 300),
    registrationNumber: clean(b.registrationNumber, 80),
    gstNumber: clean(b.gstNumber, 20).toUpperCase(),
    message: clean(b.message, 1500),
  };
  if (b.yearsInBusiness !== undefined && b.yearsInBusiness !== '') f.yearsInBusiness = Math.max(0, Math.min(200, Number(b.yearsInBusiness) || 0));

  if (!f.businessName) throw new ApiError(400, 'Please enter your business name');
  if (!BUSINESS_CATEGORIES.includes(f.category)) throw new ApiError(400, 'Please choose your business category');
  if (f.category === 'Other' && !f.categoryOther) throw new ApiError(400, 'Please type your business category');
  if (!f.contactPerson) throw new ApiError(400, 'Please enter the contact person’s name');
  if (!/^[6-9]\d{9}$/.test(f.phone)) throw new ApiError(400, 'Please enter a valid 10-digit mobile number');
  if (!EMAIL.test(f.email)) throw new ApiError(400, 'Please enter a valid email address');
  if (!f.address) throw new ApiError(400, 'Please enter the business address');
  if (!/^[1-9]\d{5}$/.test(f.pincode)) throw new ApiError(400, 'Please enter a valid 6-digit PIN code');
  if (!f.city) throw new ApiError(400, 'Please enter the city');
  if (!f.services.length && !f.servicesOther) throw new ApiError(400, 'Please choose the services you offer');

  // the same business applying again while its application is open is not a new application
  const open = await BusinessPartner.findOne({ phone: f.phone, status: 'Pending', businessName: new RegExp(`^${f.businessName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
  if (open) return res.status(200).json({ success: true, duplicate: true, partner: { code: open.code, businessName: open.businessName, status: open.status }, message: `We already have your application ${open.code}. Our partnerships team will contact you soon.` });

  const partner = await BusinessPartner.create({ ...f, code: await nextCode('businessPartner', 'BP') });
  await notifyAdmins({ type: 'account', title: 'New business partner application', body: `${partner.code}: ${partner.businessName} (${partner.category === 'Other' ? partner.categoryOther : partner.category}${partner.city ? `, ${partner.city}` : ''}) wants to partner with Carevaa. Review and approve or reject.`, link: `/admin/business-partners?q=${partner.code}` });
  res.status(201).json({ success: true, partner: { code: partner.code, businessName: partner.businessName, status: partner.status }, message: 'Thank you! Your application has been received. Our partnerships team will review it and contact you.' });
});

// GET /api/admin/business-partners
export const listPartners = asyncHandler(async (_req, res) => {
  const partners = await BusinessPartner.find().sort({ createdAt: -1 });
  res.json({ success: true, partners });
});

// PATCH /api/admin/business-partners/:id  { status?, note? }
export const updatePartner = asyncHandler(async (req, res) => {
  const partner = await BusinessPartner.findById(req.params.id).catch(() => null);
  if (!partner) throw new ApiError(404, 'Application not found');
  const by = req.user?.name || 'Admin';
  const { status } = req.body || {};
  const note = clean(req.body?.note, 1000);
  if (status !== undefined) {
    if (!PARTNER_STATUSES.includes(status)) throw new ApiError(400, 'Invalid status');
    if (status !== partner.status) {
      partner.status = status;
      partner.reviewedBy = by;
      partner.reviewedAt = new Date();
      partner.notes.push({ text: `Marked ${status}`, by });
    }
  }
  if (note) partner.notes.push({ text: note, by });
  await partner.save();
  res.json({ success: true, partner });
});

// DELETE /api/admin/business-partners/:id
export const deletePartner = asyncHandler(async (req, res) => {
  const partner = await BusinessPartner.findByIdAndDelete(req.params.id).catch(() => null);
  if (!partner) throw new ApiError(404, 'Application not found');
  res.json({ success: true });
});
