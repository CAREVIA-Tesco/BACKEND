import { Router } from 'express';
import { protect, optionalAuth, authorize } from '../middleware/auth.js';
import { ApiError } from '../middleware/error.js';
import * as auth from '../controllers/authController.js';
import * as providers from '../controllers/providerController.js';
import * as appointments from '../controllers/appointmentController.js';
import * as admin from '../controllers/adminController.js';
import * as catalog from '../controllers/catalogController.js';
import * as applications from '../controllers/applicationController.js';
import * as reviews from '../controllers/reviewController.js';
import * as content from '../controllers/contentController.js';
import * as emergency from '../controllers/emergencyController.js';
import * as publicApi from '../controllers/publicController.js';
import * as enquiries from '../controllers/enquiryController.js';
import * as pincode from '../controllers/pincodeController.js';
import * as notifications from '../controllers/notificationController.js';
import * as clinic from '../controllers/clinicController.js';
import * as passwordReset from '../controllers/passwordResetController.js';

const router = Router();
const adminOnly = [protect, authorize('admin')];

router.get('/health', (_req, res) => res.json({ success: true, status: 'ok', time: new Date().toISOString() }));

// Public numbers for the marketing pages
router.get('/public/stats', publicApi.publicStats);

// PIN code -> city, district, state and post offices (any PIN code in India)
router.get('/pincode/:pin', pincode.lookupPincode);

// Auth
router.post('/auth/register', auth.register);
router.post('/auth/login', auth.login);
router.get('/auth/me', protect, auth.me);
router.put('/auth/me', protect, auth.updateMe);

// Patient Visit Management (walk-in clinic visits): the doctor's dashboard (doctor or their nurse), admin sees all
const clinicTeam = [protect, authorize('doctor', 'admin')];
router.get('/clinic/summary', ...clinicTeam, clinic.summary);
router.get('/clinic/report', ...clinicTeam, clinic.report);
router.get('/clinic/patients', ...clinicTeam, clinic.listPatients);
router.get('/clinic/patients/match', ...clinicTeam, clinic.matchPatients);
router.get('/clinic/patients/:id', ...clinicTeam, clinic.getPatient);
router.put('/clinic/patients/:id', ...clinicTeam, clinic.updatePatient);
router.get('/clinic/visits', ...clinicTeam, clinic.listVisits);
router.post('/clinic/visits', ...clinicTeam, clinic.createVisit);
router.put('/clinic/visits/:id', ...clinicTeam, clinic.updateVisit);
router.delete('/clinic/visits/:id', ...clinicTeam, clinic.deleteVisit);
router.get('/admin/clinic/report', protect, authorize('admin'), clinic.adminReport);

// Notifications (bell icon in every dashboard)
router.get('/notifications', protect, notifications.listNotifications);
router.post('/notifications/read-all', protect, notifications.markAllRead);
router.patch('/notifications/:id/read', protect, notifications.markRead);
router.delete('/notifications', protect, notifications.clearNotifications);
// Forgot password: SMS OTP through Twilio (patients and professionals only)
router.post('/auth/forgot-password', passwordReset.forgotPassword);
router.post('/auth/verify-otp', passwordReset.verifyOtp);
router.post('/auth/reset-password', passwordReset.resetPassword);

// Providers (doctors & care professionals)
router.get('/providers', optionalAuth, providers.listProviders);
router.get('/providers/me', protect, authorize('doctor'), providers.myProvider);
router.post('/providers/onboarding', protect, authorize('doctor'), providers.submitOnboarding);
router.post('/providers', ...adminOnly, providers.createProvider);
router.get('/providers/:id/slots', optionalAuth, providers.providerSlots);
router.get('/providers/:id', optionalAuth, providers.getProvider);
router.put('/providers/:id', protect, authorize('admin', 'doctor'), providers.updateProvider);
router.patch('/providers/:id/status', ...adminOnly, providers.updateProviderStatus);
router.delete('/providers/:id', ...adminOnly, providers.deleteProvider);

// Appointments
// Only the care team books appointments directly. Patients send a request (Book Now / Book on a
// doctor's card -> /api/enquiries) and the admin arranges it with the doctor.
const careTeamBooking = (req, _res, next) => (req.user?.role === 'admin' ? next() : next(new ApiError(403, 'Appointments are arranged by the Carevaa team. Please use Book Now and our care advisor will call you shortly.')));
router.post('/appointments', optionalAuth, careTeamBooking, appointments.createAppointment);
router.get('/appointments', protect, appointments.listAppointments);
router.get('/appointments/:id', protect, appointments.getAppointment);
router.patch('/appointments/:id/reschedule', protect, appointments.rescheduleAppointment);
router.patch('/appointments/:id/complete', protect, authorize('doctor', 'admin'), appointments.completeAppointment);
router.patch('/appointments/:id/cancel', protect, appointments.cancelAppointment);
router.patch('/appointments/:id/status', protect, authorize('doctor', 'admin'), appointments.updateAppointmentStatus);

// Admin
router.get('/admin/stats', ...adminOnly, admin.dashboardStats);
router.get('/admin/patients', ...adminOnly, admin.listPatients);
router.post('/admin/patients', ...adminOnly, admin.createPatient);
router.get('/admin/patients/:id', ...adminOnly, admin.getPatient);
router.patch('/admin/patients/:id', ...adminOnly, admin.updatePatient);
router.get('/admin/payments', ...adminOnly, admin.listPayments);
router.post('/admin/payments/:id/refund', ...adminOnly, admin.refundPayment);
router.get('/admin/payouts', ...adminOnly, admin.providerPayouts);
router.post('/admin/payouts/:providerId', ...adminOnly, admin.processPayout);

// Catalog
router.get('/specializations', catalog.listSpecializations);
router.post('/specializations', ...adminOnly, catalog.createSpecialization);
router.put('/specializations/:id', ...adminOnly, catalog.updateSpecialization);
router.delete('/specializations/:id', ...adminOnly, catalog.deleteSpecialization);
router.get('/services', catalog.listServices);
router.post('/services', ...adminOnly, catalog.createService);
router.put('/services/:id', ...adminOnly, catalog.updateService);
router.delete('/services/:id', ...adminOnly, catalog.deleteService);

// Job applications
router.post('/applications', applications.createApplication);
router.get('/applications', ...adminOnly, applications.listApplications);
router.patch('/applications/:id', ...adminOnly, applications.updateApplication);

// Reviews (patients rate completed visits)
router.get('/reviews', reviews.listReviews);
router.post('/reviews', protect, authorize('patient'), reviews.createReview);

// Website content managed in the database (testimonials, cities, job openings ...)
router.get('/content/:key', content.getContent);
router.put('/content/:key', ...adminOnly, content.saveContent);

// Emergency requests
router.post('/emergency', optionalAuth, emergency.createEmergency);
router.get('/emergency', ...adminOnly, emergency.listEmergencies);
router.patch('/emergency/:id', ...adminOnly, emergency.updateEmergency);

// Enquiries / callback requests (website lead workflow)
router.post('/enquiries', optionalAuth, enquiries.createEnquiry);
router.get('/enquiries/track', enquiries.trackEnquiry);
router.get('/enquiries/mine', protect, enquiries.myEnquiries);
router.get('/enquiries/open', protect, authorize('doctor'), enquiries.openRequests);
router.post('/enquiries/:id/accept', protect, authorize('doctor'), enquiries.acceptRequest);
router.post('/enquiries/:id/decline', protect, authorize('doctor'), enquiries.declineRequest);
router.get('/enquiries/:id/matches', ...adminOnly, enquiries.requestMatches);
router.post('/enquiries/:id/assign', ...adminOnly, enquiries.assignRequest);
router.post('/enquiries/:id/broadcast', ...adminOnly, enquiries.broadcastRequest);
router.patch('/enquiries/:id/cancel', optionalAuth, enquiries.cancelEnquiry);
router.get('/enquiries', ...adminOnly, enquiries.listEnquiries);
router.get('/enquiries/:id', ...adminOnly, enquiries.getEnquiry);
router.patch('/enquiries/:id', ...adminOnly, enquiries.updateEnquiry);

export default router;
