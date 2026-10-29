import { Specialization, Service } from '../models/Catalog.js';
import Provider from '../models/Provider.js';
import Appointment from '../models/Appointment.js';
import { ApiError, asyncHandler } from '../middleware/error.js';

async function specializationCounts(spec) {
  const names = [spec.name, ...(spec.matches || [])];
  const [providers, appointments] = await Promise.all([
    Provider.countDocuments({ $or: [{ spec: { $in: names } }, { specialization: { $in: names } }] }),
    Appointment.countDocuments({ providerSpec: { $in: names } }),
  ]);
  return { ...spec.toJSON(), providers, appointments };
}

export const listSpecializations = asyncHandler(async (_req, res) => {
  const specs = await Specialization.find().sort({ createdAt: 1 });
  res.json({ success: true, specializations: await Promise.all(specs.map(specializationCounts)) });
});

export const createSpecialization = asyncHandler(async (req, res) => {
  const { name, description, icon, status, matches } = req.body;
  if (!name) throw new ApiError(400, 'Specialization name is required');
  const spec = await Specialization.create({ name, description, icon, status, matches });
  res.status(201).json({ success: true, specialization: await specializationCounts(spec) });
});

export const updateSpecialization = asyncHandler(async (req, res) => {
  const spec = await Specialization.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!spec) throw new ApiError(404, 'Specialization not found');
  res.json({ success: true, specialization: await specializationCounts(spec) });
});

export const deleteSpecialization = asyncHandler(async (req, res) => {
  const spec = await Specialization.findByIdAndDelete(req.params.id);
  if (!spec) throw new ApiError(404, 'Specialization not found');
  res.json({ success: true, message: 'Specialization deleted' });
});

async function serviceCounts(svc) {
  const bookings = await Appointment.countDocuments({ providerSpec: { $in: [svc.name, ...(svc.matches || [])] } });
  return { ...svc.toJSON(), bookings };
}

const slugify = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const SERVICE_FIELDS = ['name', 'key', 'short', 'desc', 'price', 'image', 'order', 'icon', 'matches', 'professions', 'status'];
function serviceBody(body) {
  const f = Object.fromEntries(SERVICE_FIELDS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));
  if (typeof f.name === 'string') f.name = f.name.trim();
  if (f.key !== undefined) f.key = slugify(f.key);
  if (f.matches !== undefined) f.matches = (Array.isArray(f.matches) ? f.matches : String(f.matches).split(',')).map((m) => String(m).trim()).filter(Boolean);
  if (f.professions !== undefined) f.professions = (Array.isArray(f.professions) ? f.professions : String(f.professions).split(',')).map((m) => String(m).trim()).filter(Boolean);
  if (f.order !== undefined) f.order = Number(f.order) || 100;
  if (f.image && !/^(https?:\/\/|\/|data:image\/(jpeg|png|webp);base64,)/.test(f.image)) throw new ApiError(400, 'Image must be a link (https://...) or an uploaded picture');
  if (f.image && f.image.length > 900000) throw new ApiError(400, 'Image is too large – please use one under 600 KB');
  return f;
}
const duplicate = (err) => {
  if (err?.code === 11000) throw new ApiError(409, 'A service with this name or web address already exists');
  throw err;
};

export const listServices = asyncHandler(async (req, res) => {
  const { profession, status } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (profession) {
    filter.$or = [
      { professions: profession },
      { matches: profession },
    ];
  }
  const services = await Service.find(filter).sort({ order: 1, createdAt: 1 });
  res.json({ success: true, services: await Promise.all(services.map(serviceCounts)) });
});

export const createService = asyncHandler(async (req, res) => {
  const body = serviceBody(req.body);
  if (!body.name) throw new ApiError(400, 'Service name is required');
  if (!body.key) body.key = slugify(body.name);
  if (body.order === undefined) body.order = (await Service.countDocuments()) + 1;
  const svc = await Service.create(body).catch(duplicate);
  res.status(201).json({ success: true, service: await serviceCounts(svc) });
});

export const updateService = asyncHandler(async (req, res) => {
  const body = serviceBody(req.body);
  if (body.name === '') throw new ApiError(400, 'Service name is required');
  if (body.key === '') delete body.key;
  const svc = await Service.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true }).catch(duplicate);
  if (!svc) throw new ApiError(404, 'Service not found');
  res.json({ success: true, service: await serviceCounts(svc) });
});

export const deleteService = asyncHandler(async (req, res) => {
  const svc = await Service.findByIdAndDelete(req.params.id);
  if (!svc) throw new ApiError(404, 'Service not found');
  res.json({ success: true, message: 'Service deleted' });
});
