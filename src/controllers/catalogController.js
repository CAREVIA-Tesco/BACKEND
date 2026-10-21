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

export const listServices = asyncHandler(async (_req, res) => {
  const services = await Service.find().sort({ createdAt: 1 });
  res.json({ success: true, services: await Promise.all(services.map(serviceCounts)) });
});

export const createService = asyncHandler(async (req, res) => {
  if (!req.body.name) throw new ApiError(400, 'Service name is required');
  const svc = await Service.create(req.body);
  res.status(201).json({ success: true, service: await serviceCounts(svc) });
});

export const updateService = asyncHandler(async (req, res) => {
  const svc = await Service.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!svc) throw new ApiError(404, 'Service not found');
  res.json({ success: true, service: await serviceCounts(svc) });
});

export const deleteService = asyncHandler(async (req, res) => {
  const svc = await Service.findByIdAndDelete(req.params.id);
  if (!svc) throw new ApiError(404, 'Service not found');
  res.json({ success: true, message: 'Service deleted' });
});
