import 'dotenv/config';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import User from '../models/User.js';
import Provider from '../models/Provider.js';
import Appointment from '../models/Appointment.js';
import Payment from '../models/Payment.js';
import JobApplication from '../models/JobApplication.js';
import { Specialization, Service } from '../models/Catalog.js';
import Review from '../models/Review.js';
import SiteContent from '../models/SiteContent.js';
import EmergencyRequest from '../models/EmergencyRequest.js';
import { refreshProviderRating } from '../controllers/reviewController.js';

const WEEK = {
  Mon: ['09:00 AM', '10:00 AM', '11:00 AM', '02:00 PM', '04:00 PM', '05:00 PM'],
  Tue: ['10:00 AM', '02:00 PM'],
  Wed: ['09:00 AM', '11:00 AM', '04:00 PM'],
  Thu: ['10:00 AM', '02:00 PM', '05:00 PM'],
  Fri: ['09:00 AM', '10:00 AM', '02:00 PM'],
  Sat: ['10:00 AM', '11:00 AM'],
  Sun: [],
};

// Same professionals that were hard-coded in the frontend
export const PROVIDERS = [
  { name: 'Dr. Priya Sharma', profession: 'Homeopathy Doctor', specialization: 'General Homeopathy', spec: 'Homeopathy Doctor', isDoctor: true, experience: 8, city: 'Chennai', state: 'Tamil Nadu', clinicFee: 700, onlineFee: 500, gender: 'Female', img: 'https://randomuser.me/api/portraits/women/44.jpg', email: 'doctor@carevia.com', phone: '9876543210', clinic: { name: 'Carevaa Health Clinic', address: '12 Anna Salai, T. Nagar', phone: '+91 98765 43210' } },
  { name: 'Dr. Ramesh Kumar', profession: 'MBBS Doctor', specialization: 'General Physician', spec: 'General Physician', isDoctor: true, experience: 12, city: 'Chennai', state: 'Tamil Nadu', clinicFee: 600, onlineFee: 400, gender: 'Male', img: 'https://randomuser.me/api/portraits/men/32.jpg', email: 'ramesh@carevia.com' },
  { name: 'Dr. Ananya Iyer', profession: 'MBBS Doctor', specialization: 'Pediatrics', spec: 'Pediatrician', isDoctor: true, experience: 10, city: 'Bangalore', state: 'Karnataka', clinicFee: 900, onlineFee: 700, gender: 'Female', img: 'https://randomuser.me/api/portraits/women/68.jpg' },
  { name: 'Dr. Sarah Johnson', profession: 'MBBS Doctor', specialization: 'Cardiology', spec: 'Cardiologist', isDoctor: true, experience: 15, city: 'Virtual', clinicFee: 1400, onlineFee: 1200, gender: 'Female', img: 'https://randomuser.me/api/portraits/women/33.jpg' },
  { name: 'Dr. Sanjay Gupta', profession: 'Physiotherapist', specialization: 'Orthopedic Physiotherapy', spec: 'Physiotherapist', isDoctor: false, experience: 6, city: 'Mumbai', state: 'Maharashtra', fee: 800, gender: 'Male', img: 'https://randomuser.me/api/portraits/men/45.jpg' },
  { name: 'Dr. Neha Verma', profession: 'Ayurveda Doctor', specialization: 'General Ayurveda', spec: 'Ayurveda Doctor', isDoctor: true, experience: 14, city: 'Pune', state: 'Maharashtra', clinicFee: 500, onlineFee: 300, gender: 'Female', img: 'https://randomuser.me/api/portraits/women/22.jpg' },
  { name: 'Nurse Anita', profession: 'Nurse', specialization: 'General Nursing', spec: 'Nurse', isDoctor: false, experience: 5, city: 'Delhi', state: 'Delhi', fee: 400, gender: 'Female', img: 'https://randomuser.me/api/portraits/women/12.jpg' },
  { name: 'Rahul Singh', profession: 'Caretaker', specialization: 'Elderly Care', spec: 'Care Taker', isDoctor: false, experience: 3, city: 'Chennai', state: 'Tamil Nadu', fee: 300, gender: 'Male', img: 'https://randomuser.me/api/portraits/men/11.jpg' },
  { name: 'Dr. Meena Iyer', profession: 'BHS', specialization: 'Community Health', spec: 'BHS', isDoctor: false, experience: 9, city: 'Bangalore', state: 'Karnataka', fee: 500, gender: 'Female', img: 'https://randomuser.me/api/portraits/women/33.jpg' },
  { name: 'Dr. Kavita Reddy', profession: 'MBBS Doctor', specialization: 'Dermatology', spec: 'Dermatologist', isDoctor: true, experience: 6, city: 'Hyderabad', state: 'Telangana', clinicFee: 700, onlineFee: 500, gender: 'Female', img: 'https://randomuser.me/api/portraits/women/32.jpg' },
  { name: 'Dr. Vikram Singh', profession: 'MBBS Doctor', specialization: 'Orthopedics', spec: 'Orthopedic', isDoctor: true, experience: 11, city: 'Delhi NCR', state: 'Delhi', clinicFee: 1000, onlineFee: 800, gender: 'Male', img: 'https://randomuser.me/api/portraits/men/68.jpg' },
  { name: 'Dr. Neha Patel', profession: 'MBBS Doctor', specialization: 'Gynecology', spec: 'Gynecologist', isDoctor: true, experience: 9, city: 'Pune', state: 'Maharashtra', clinicFee: 800, onlineFee: 600, gender: 'Female', img: 'https://randomuser.me/api/portraits/women/24.jpg' },
  { name: 'Dr. Arjun Menon', profession: 'MBBS Doctor', specialization: 'Neurology', spec: 'Neurologist', isDoctor: true, experience: 14, city: 'Kochi', state: 'Kerala', clinicFee: 1500, onlineFee: 1200, gender: 'Male', img: 'https://randomuser.me/api/portraits/men/22.jpg' },
  { name: 'Carevaa Diagnostics', profession: 'Lab Centre', specialization: 'General Diagnostic Tests', spec: 'Lab Centre', isDoctor: false, experience: 7, city: 'Chennai', state: 'Tamil Nadu', fee: 499, img: 'https://ui-avatars.com/api/?name=Carevaa+Diagnostics&background=5A2F8F&color=fff&size=128' },
  { name: 'Dr. Rohit Desai', profession: 'MBBS Doctor', specialization: 'Cardiology', spec: 'Cardiologist', isDoctor: true, experience: 4, city: 'Ahmedabad', state: 'Gujarat', clinicFee: 900, onlineFee: 700, gender: 'Male', img: 'https://randomuser.me/api/portraits/men/52.jpg', status: 'PENDING' },
];

const SPECIALIZATIONS = [
  { name: 'General Medicine', icon: 'Stethoscope', matches: ['General Physician', 'Family Medicine'] },
  { name: 'Cardiology', icon: 'Heart', matches: ['Cardiologist'] },
  { name: 'Dermatology', icon: 'Droplet', matches: ['Dermatologist'] },
  { name: 'Pediatrics', icon: 'Baby', matches: ['Pediatrician'] },
  { name: 'Orthopedics', icon: 'Bone', matches: ['Orthopedic', 'Orthopedic Physiotherapy'] },
  { name: 'Neurology', icon: 'Brain', matches: ['Neurologist'] },
  { name: 'Ophthalmology', icon: 'Eye', matches: ['Ophthalmologist'] },
  { name: 'Psychiatry', icon: 'Activity', matches: ['Psychiatrist'] },
];

// The services listed on the website (Home, Our Services, Book Now). Admin can add, edit, hide or re-order them.
// "key" is the web address: built-in keys open their own page, new ones open /services/<key>.
const SERVICES = [
  { key: 'physiotherapy', name: 'Physiotherapy', short: 'Pain relief & rehab', desc: 'Recover from pain, injury or surgery with certified physios at home.', price: '₹800', icon: 'Activity', image: '/service-physio.png', matches: ['Physiotherapist'], order: 1 },
  { key: 'nurse-care', name: 'Nurse Care', short: 'Skilled nursing at home', desc: 'Injections, IVs, wound care and post-hospital nursing by trained nurses.', price: '₹1,200', icon: 'Syringe', image: '/nurse-hero.jpg', matches: ['Nurse'], order: 2 },
  { key: 'home-doctor', name: 'Home Doctor', short: 'Doctor at your doorstep', desc: 'General physicians who visit, diagnose and treat you at home.', price: '', icon: 'House', image: '/doctor-hero.png', matches: ['General Physician'], order: 3 },
  { key: 'doctor-visit', name: 'Doctor Visit', short: 'Online & clinic consults', desc: 'Expert consultations online or at the clinic, with digital prescriptions.', price: '₹499', icon: 'Stethoscope', image: '/home-hero.jpg', matches: ['General Physician', 'Pediatrician', 'Cardiologist', 'Dermatologist', 'Orthopedic', 'Gynecologist', 'Neurologist'], order: 4 },
  { key: 'care-taker', name: 'Care Taker', short: 'Elder & post-op care', desc: 'Trained attendants for elderly, post-operative and bedridden patients.', price: '', icon: 'Users', image: '/caretaker-section.png', matches: ['Care Taker'], order: 5 },
  { key: 'baby-care', name: 'Baby Care', short: 'Mother & baby support', desc: 'Paediatric care and daily support for newborns, babies and new mothers.', price: '', icon: 'Baby', image: '/service-homecare.png', matches: ['Pediatrician'], order: 6 },
  { key: 'ayurveda', name: 'Ayurveda', short: 'Natural healing', desc: 'Traditional Ayurvedic consultations and therapies at your doorstep.', price: '₹499', icon: 'Leaf', image: '/hero.png', matches: ['Ayurveda Doctor'], order: 7 },
  { key: 'bhs', name: 'BHS', short: 'Basic health services', desc: 'Vitals monitoring, sample collection and essential health checks.', price: '', icon: 'HeartPulse', image: '/caretaker-hero.png', matches: ['BHS'], order: 8 },
  { key: 'lab-tests', name: 'Lab Tests', short: 'Home sample collection', desc: 'Blood tests and diagnostics with home sample collection and quick, accurate reports from partner labs.', price: '', icon: 'FlaskConical', image: '/service-homecare.png', matches: ['Lab Centre'], order: 9 },
];
// Names used by the first version of the catalog -> the website service they became
const OLD_SERVICE_NAMES = { 'Doctor Consultation': 'doctor-visit', 'Home Nursing': 'nurse-care', Physiotherapy: 'physiotherapy', 'Lab Tests': 'lab-tests', Ayurveda: 'ayurveda', Homeopathy: 'homeopathy' };

// Website content (previously hard-coded in the React pages) – editable via PUT /api/content/:key
const CONTENT = {
  jobs: [
    { category: 'Physiotherapy', accent: 'blue', icon: 'Activity', title: 'Physiotherapy Specialist', loc: 'Bangalore', time: 'Full-Time', desc: 'Spearhead rehabilitation programs for post-surgery and elderly patients. Design custom exercise regimens and track recovery milestones.' },
    { category: 'Baby Care', accent: 'rose', icon: 'Heart', title: 'Baby Care Specialist', loc: 'Chennai', time: 'Full-Time', desc: 'Lead the delivery of high-quality home care, assisting patients with daily activities, monitoring vitals, and ensuring absolute comfort.' },
    { category: 'Care Taker', accent: 'amber', icon: 'User', title: 'Senior Care Taker', loc: 'Hyderabad', time: 'Full-Time', desc: 'Provide compassionate daily assistance, mobility support, and companionship to elderly patients in a home setting.' },
    { category: 'Doctor Visit', accent: 'indigo', icon: 'Stethoscope', title: 'Doctor Visit Specialist', loc: 'Pune', time: 'Part-Time', desc: 'Conduct professional home consultations, diagnose illnesses, prescribe treatments, and review ongoing patient care plans efficiently.' },
    { category: 'Nurse Care', accent: 'rose', icon: 'Heart', title: 'Nurse Care Professional', loc: 'Mumbai', time: 'Full-Time', desc: 'Deliver specialized clinical care at home, administering medications, managing IVs, and providing continuous patient monitoring.' },
    { category: 'Home Doctor', accent: 'indigo', icon: 'Stethoscope', title: 'Home Doctor', loc: 'Delhi NCR', time: 'On-Call', desc: "Provide on-call comprehensive medical consultations and diagnostics at the patient's doorstep for immediate healthcare needs." },
    { category: 'Ayurveda', accent: 'emerald', icon: 'Leaf', title: 'Ayurvedic Doctor', loc: 'Bangalore', time: 'Full-Time', desc: 'Deliver authentic Ayurvedic consultations, prescribe natural remedies, and oversee specialized Panchakarma therapies at home.' },
    { category: 'BHS', accent: 'teal', icon: 'HeartPulse', title: 'BHS Health Professional', loc: 'Chennai', time: 'Part-Time', desc: 'Conduct routine home health screenings, collect samples, monitor patient vitals, and maintain accurate digital health records.' },
  ],
  testimonials: [
    { name: 'SAMMIE', role: 'Patient', quote: 'The physiotherapist was punctual and skilled.', img: 'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=600&h=800&fit=crop' },
    { name: 'KAITY', role: 'Patient', quote: 'Excellent home nursing service.', img: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=600&h=800&fit=crop' },
    { name: 'ANIA', role: 'FASHION DIRECTOR', quote: 'Booking a doctor home visit was seamless. Got the right treatment for my mother without any hassle.', img: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=600&h=800&fit=crop' },
    { name: 'OAKES', role: 'Patient', quote: 'Highly recommended for elderly care.', img: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=600&h=800&fit=crop' },
    { name: 'LAUREN', role: 'Patient', quote: 'Very professional and caring.', img: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=600&h=800&fit=crop' },
  ],
  // pricing rules for the service-page packages (single-session price = lowest live provider fee)
  pricing: [{ packSessions: 10, packDiscountPct: 10, monthlyMultiplier: 16, emiMinimum: 4000, monthly24hrDays: 25 }],
  blog: [
      {
        date: "02-07-2024",
        title: "Boost Immunity with Baby Care",
        slug: "boost-immunity-with-baby-care",
        category: "Baby Care",
        body: ["A newborn's immune system is still learning. Simple daily routines at home – clean feeding practices, timely vaccinations and good sleep – do more for immunity than any supplement.", "Keep a vaccination card handy and follow your paediatrician's schedule. Breastfeeding, when possible, passes on antibodies, and skin-to-skin contact helps babies regulate temperature and stress.", "A trained baby-care nurse at home can help with bathing, cord care, feeding positions and spotting early warning signs such as fever, poor feeding or unusual drowsiness, so new parents get rest and confidence."],
        desc: "Discover how workflow automation and health routines can streamline recovery, reduce stress, and save your family valuable time.",
        img: "https://images.unsplash.com/photo-1581056771107-24ca5f033842?w=800&h=600&fit=crop"
      },
      {
        date: "25-06-2024",
        title: "Securing Health Data in Cloud",
        slug: "securing-health-data-in-cloud",
        category: "Health Records",
        body: ["Digital prescriptions and visit notes are only useful if they are safe and easy to find. At Carevaa every visit summary, vitals reading and prescription is stored against your account.", "Use a strong password, never share one-time codes, and log out on shared devices. Only you, your treating professional and authorised staff can see your records.", "Keeping records in one place means any doctor you see next can understand your history quickly, which leads to safer, faster care."],
        desc: "Learn the best practices for protecting sensitive patient data in digital environments, including encryption and access controls.",
        img: "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=800&h=600&fit=crop"
      },
      {
        date: "10-06-2024",
        title: "Choosing the Right Physio",
        slug: "choosing-the-right-physio",
        category: "Physiotherapy",
        body: ["The right physiotherapist depends on what you are recovering from – back pain, a sports injury, a knee replacement or a stroke all need different expertise.", "Check the therapist's qualification and years of experience, ask how progress will be measured, and make sure the plan includes exercises you can do between sessions.", "Home physiotherapy saves travel for people in pain and lets the therapist adapt exercises to your real environment, such as stairs, bed height and bathroom access."],
        desc: "Explore a strategic approach to selecting medical experts, tools, and platforms that align with your family's recovery goals.",
        img: "https://images.unsplash.com/photo-1579684385127-1ef15d508118?w=800&h=600&fit=crop"
      },
      {
        date: "25-06-2024",
        title: "Choosing Caretakers Wisely",
        slug: "choosing-caretakers-wisely",
        category: "Elder Care",
        body: ["A caretaker spends many hours with your loved one, so trust and training matter as much as availability.", "Decide the level of help needed – companionship, mobility support, personal hygiene or post-operative care – and whether you need day shifts, night shifts or 24-hour support.", "Ask for verified identity, prior experience with similar patients and a clear daily routine. Regular check-ins with the family keep care on track."],
        desc: "Choosing the right care plan is critical to your recovery's long-term success. In this guide, we break down how to evaluate options.",
        img: "https://images.unsplash.com/photo-1581594693702-fbdc51b2763b?w=800&h=600&fit=crop"
      },
      {
        date: "25-06-2024",
        title: "Understanding Patient Culture",
        slug: "understanding-patient-culture",
        category: "Patient Care",
        body: ["Good care is a partnership between the patient, the family and the professional. Clear communication prevents most problems.", "Share the full medical history, current medicines and allergies at the first visit, and ask questions until the plan makes sense to you.", "Families should agree on one point of contact so instructions are not lost, and keep notes of symptoms between visits."],
        desc: "Discover how embracing a compassionate culture can break down silos between families and doctors, fostering seamless collaboration.",
        img: "https://images.unsplash.com/photo-1532938911079-1b06ac7ceec7?w=800&h=600&fit=crop"
      },
      {
        date: "10-06-2024",
        title: "Optimizing Health Infrastructure",
        slug: "optimizing-health-infrastructure",
        category: "Home Health",
        body: ["Small changes at home make recovery safer: good lighting, grab bars in the bathroom, a clear path to the bed and a chair with arm rests.", "Keep a simple health kit with a thermometer, BP monitor, glucometer if needed, and a list of emergency numbers near the phone.", "Regular basic health checks at home – vitals, blood sugar and weight – help catch problems early, before they need a hospital visit."],
        desc: "Explore smart, future-focused strategies to modernize outdated routines, implement real-time monitoring tools, and manage well-being.",
        img: "https://images.unsplash.com/photo-1516549655169-df83a0774514?w=800&h=600&fit=crop"
      }
  ],
  // Homepage FAQ and contact details – editable via PUT /api/content/faqs and /api/content/contact
  faqs: [
    { q: 'What services does Carevaa offer at home?', a: 'Physiotherapy, nursing care, doctor visits (at home or online), care takers for elders and post-surgery patients, baby care, Ayurveda and basic health services (BHS) such as vitals checks and sample collection.' },
    { q: 'How do I book a professional?', a: 'Click "Book Now", pick the service and professional, choose a date and an open time slot, then confirm and pay. Your booking ID appears instantly and the appointment shows up in your dashboard.' },
    { q: 'Can I see the price before I pay?', a: 'Yes. Every professional sets their own fee for home visits, clinic visits and online consults, and the exact amount is shown on the confirmation step before payment. Multi-session packs are cheaper per session.' },
    { q: 'Who are the professionals?', a: 'Doctors, physiotherapists, nurses and caregivers who have registered with Carevaa and submitted their qualification, registration number, experience and clinic details. Our team reviews profiles and can suspend anyone who does not meet our standards.' },
    { q: 'Can I reschedule or cancel?', a: 'Yes. Appointments can be rescheduled to another open slot, and if a paid appointment is cancelled the payment is refunded automatically.' },
    { q: 'Do I get a record of the visit?', a: 'After each visit the professional records your vitals, symptoms and prescription. You can see them any time under My Records in your patient dashboard.' },
    { q: 'Which cities do you serve?', a: 'The cities we currently serve are listed on our homepage, and new cities are added as more professionals join. Online consultations are available from anywhere.' },
    { q: 'How do I join Carevaa as a professional?', a: 'Choose "Doctor" on the login page, register and complete the onboarding form with your profession, fees, clinic and bank details. Our team reviews your details, and your profile goes live for patients once it is approved.' },
  ],
  theme: [{ palette: 'plum' }],
  // Legal pages – plain-language drafts, editable in Admin → Website Content. Have them reviewed before going live.
  'legal-privacy': [{ title: 'Privacy Policy', updated: 'October 2026', body: [
    'This policy explains what personal information Carevaa collects when you use our website and services, why we collect it and how we protect it.',
    '## Information we collect',
    'Account details you give us: name, mobile number, email address, city and password (stored only in encrypted form).',
    'Care details: appointments, the professional you booked, symptoms, vitals, prescriptions and visit notes recorded by your professional, and any medical history you add to your profile.',
    'Requests and messages: callback, care-plan, contact, partnership and referral forms, including the details of anyone you refer.',
    'Payment records: amount, method, status and refunds. Card and UPI credentials are handled by the payment provider and are not stored by Carevaa.',
    '## How we use it',
    'To book, deliver and follow up on your care; to let the professional you booked see the information needed to treat you; to contact you about your requests and appointments; to process payments, refunds and payouts; and to keep our services safe and improve them.',
    '## Who can see it',
    'You, the professional treating you and authorised Carevaa staff. We do not sell your personal information. We share it with others only when required by law or to protect someone’s safety.',
    '## Your choices',
    'You can view and update your profile at any time, ask us for a copy of your data, or ask us to delete your account by writing to the email address on our Contact page. Some records may be kept where the law requires it.',
    '## Security',
    'Access to your data is protected by login and role-based permissions. Please keep your password private and log out on shared devices.',
    '## Contact',
    'Questions about this policy? Contact us using the details on our Contact Us page.',
  ] }],
  'legal-terms': [{ title: 'Terms & Conditions', updated: 'October 2026', body: [
    'By using the Carevaa website or booking a service you agree to these terms.',
    '## Our service',
    'Carevaa connects patients with independent, qualified healthcare professionals for home visits, clinic visits and online consultations. Professionals are responsible for the clinical care they provide.',
    '## Not for emergencies',
    'Carevaa is not an emergency service. In a medical emergency call 108 or go to the nearest hospital.',
    '## Bookings and payments',
    'Prices shown at checkout are set by the professional and are the amount you pay. Package and monthly-plan prices are confirmed by our care advisor before they start.',
    '## Rescheduling, cancellation and refunds',
    'You can reschedule to another open slot. If a paid appointment is cancelled, the payment is refunded to the original payment method.',
    '## Your responsibilities',
    'Give accurate contact and medical information, be available at the booked time and treat professionals with respect. Accounts used for misuse may be suspended.',
    '## Reviews',
    'Reviews must be honest and about your own visit. We may remove reviews that are abusive or unrelated to the care received.',
    '## Changes',
    'We may update these terms. The date at the top shows the latest version.',
  ] }],
  'legal-patient-rights': [{ title: 'Patient Rights & Responsibilities', updated: 'October 2026', body: [
    '## Your rights',
    'To be treated with dignity, respect and without discrimination.',
    'To know the name, qualification and role of the professional caring for you.',
    'To clear information about your condition, treatment options and costs before care begins.',
    'To privacy and confidentiality of your medical information.',
    'To give or refuse consent for any treatment, and to seek a second opinion.',
    'To raise a complaint and have it addressed without it affecting your care.',
    '## Your responsibilities',
    'Share complete and accurate information about your health, medicines and allergies.',
    'Follow the agreed care plan and tell us if you cannot.',
    'Provide a safe environment for the visiting professional.',
    'Pay the agreed fees on time and give notice if you need to reschedule or cancel.',
  ] }],
  contact: [{ phone: '1800-123-4567', email: 'hello@carevaa.com', whatsapp: '', hours: 'Open 24 x 7', address: '123 Health Street, Anna Nagar, Chennai, TN 600040', careersEmail: 'careers@carevaa.com', careersPhone: '+91 98000 28229' }],
  cities: [
    { name: 'Chennai', desc: 'Tamil Nadu', icon: 'Sun', accent: 'amber' },
    { name: 'Bangalore', desc: 'Karnataka', icon: 'Laptop', accent: 'green' },
    { name: 'Hyderabad', desc: 'Telangana', icon: 'Building2', accent: 'blue' },
    { name: 'Kochi', desc: 'Kerala', icon: 'Film', accent: 'purple' },
    { name: 'Madurai', desc: 'Tamil Nadu', icon: 'Landmark', accent: 'red' },
    { name: 'Mysore', desc: 'Karnataka', icon: 'GraduationCap', accent: 'indigo' },
    { name: 'Trivandrum', desc: 'Kerala', icon: 'BookOpen', accent: 'orange' },
    { name: 'Coimbatore', desc: 'Tamil Nadu', icon: 'Factory', accent: 'primary' },
  ],
};

const REVIEW_COMMENTS = [
  [5, 'Very patient and understanding. The online consultation was smooth and helpful. Highly recommended.'],
  [5, 'Highly recommend the doctor. Great experience overall.'],
  [4, 'Explained everything clearly and the follow-up was quick.'],
  [5, 'Punctual and caring. My family felt very comfortable.'],
  [4, 'Good consultation, prescription worked well.'],
  [5, 'Excellent care at home, would book again.'],
];

const daysFromNow = (n, hour = 10) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(hour, 0, 0, 0);
  return d;
};
const slot = (d) => {
  const h = d.getHours();
  return `${String(h % 12 || 12).padStart(2, '0')}:00 ${h >= 12 ? 'PM' : 'AM'}`;
};

async function seedDemoData(log) {
  const doctorUser = await User.create({ name: 'Dr. Priya Sharma', email: 'doctor@carevia.com', phone: '9876543210', password: 'Doctor@123', role: 'doctor' });
  const rameshUser = await User.create({ name: 'Dr. Ramesh Kumar', email: 'ramesh@carevia.com', password: 'Doctor@123', role: 'doctor' });

  const providers = [];
  for (const p of PROVIDERS) {
    const user = p.email === 'doctor@carevia.com' ? doctorUser : p.email === 'ramesh@carevia.com' ? rameshUser : null;
    const provider = await Provider.create({
      ...p,
      user: user?._id,
      languages: ['English', 'Hindi', 'Tamil'],
      schedule: WEEK,
      status: p.status || 'ACTIVE',
      verifiedAt: p.status === 'PENDING' ? undefined : new Date(),
    });
    if (user) await User.updateOne({ _id: user._id }, { provider: provider._id });
    providers.push(provider);
  }
  log(`  ✓ ${providers.length} providers (+2 doctor logins)`);

  const patientDefs = [
    { name: 'Sanjay M.', email: 'patient@carevia.com', phone: '9988776655', age: 34, gender: 'Male', city: 'Chennai' },
    { name: 'Arun Kumar', email: 'arun@example.com', phone: '9876501234', age: 41, gender: 'Male', city: 'Chennai' },
    { name: 'Sneha Patel', email: 'sneha@example.com', phone: '9123456780', age: 29, gender: 'Female', city: 'Pune' },
    { name: 'Vikram Singh', email: 'vikram@example.com', phone: '9012345678', age: 52, gender: 'Male', city: 'Delhi' },
  ];
  const patients = [];
  for (const p of patientDefs) patients.push(await User.create({ ...p, password: 'Patient@123', role: 'patient' }));
  log(`  ✓ ${patients.length} patients`);

  const [priya, ramesh, ananya] = providers;
  const demo = [
    // [patient, provider, daysFromNow, hour, type, status]
    [0, priya, 1, 16, 'online', 'Waiting'],
    [1, priya, 2, 11, 'clinic', 'Confirmed'],
    [2, ramesh, 3, 10, 'online', 'Waiting'],
    [3, ananya, 5, 14, 'clinic', 'Waiting'],
    [0, ramesh, -6, 10, 'online', 'Completed'],
    [1, priya, -15, 14, 'online', 'Completed'],
    [2, priya, -40, 10, 'clinic', 'Completed'],
    [3, ramesh, -70, 11, 'online', 'Completed'],
    [0, ananya, -100, 9, 'online', 'Completed'],
    [1, ramesh, -130, 16, 'clinic', 'Completed'],
    [2, ananya, -160, 10, 'online', 'Completed'],
    [3, priya, -9, 14, 'clinic', 'Cancelled'],
  ];
  const TITLES = { online: 'Online Consultation', clinic: 'Clinic Consultation', home: 'Home Consultation' };
  const LOC = { online: 'Virtual', clinic: 'Main Clinic', home: 'Patient Home' };

  for (const [pi, prov, days, hour, type, status] of demo) {
    const patient = patients[pi];
    const when = daysFromNow(days, hour);
    const fee = type === 'clinic' ? prov.clinicFee : prov.onlineFee;
    const paid = status === 'Completed' || (type === 'online' && status !== 'Cancelled');
    const appt = await Appointment.create({
      patientUser: patient._id,
      patientName: patient.name,
      patientPhone: `+91 ${patient.phone.slice(0, 5)} ${patient.phone.slice(5)}`,
      patientEmail: patient.email,
      provider: prov._id,
      providerName: prov.name,
      providerSpec: prov.spec,
      scheduledAt: when,
      timeSlot: slot(when),
      consultationType: type,
      title: TITLES[type],
      location: LOC[type],
      fee,
      status,
      paymentStatus: paid ? 'Paid' : 'Pending',
      paymentMethod: type === 'online' ? 'gpay' : 'cash',
      visitNotes: status === 'Completed' ? { symptoms: 'Mild fever and fatigue for 3 days.', prescription: 'Paracetamol 650mg SOS, rest and fluids. Review after 1 week.', bloodPressure: ['118/78', '122/80', '126/84', '120/80'][pi], weight: [72, 68, 61, 80][pi], completedAt: when } : undefined,
      createdAt: daysFromNow(Math.min(days, 0) - 2),
    });
    await Payment.create({
      appointment: appt._id,
      appointmentCode: appt.code,
      patientUser: patient._id,
      patientName: patient.name,
      provider: prov._id,
      providerName: prov.name,
      amount: fee,
      method: appt.paymentMethod,
      status: status === 'Cancelled' ? 'Failed' : paid ? 'Success' : 'Pending',
      paidAt: paid ? when : undefined,
    });
  }
  log(`  ✓ ${demo.length} appointments with payments`);

  // reviews for completed visits (also recalculates provider ratings)
  const completedAppts = await Appointment.find({ status: 'Completed' }).sort({ scheduledAt: -1 });
  let r = 0;
  for (const appt of completedAppts) {
    const [rating, comment] = REVIEW_COMMENTS[r % REVIEW_COMMENTS.length];
    r += 1;
    await Review.create({ appointment: appt._id, provider: appt.provider, patientUser: appt.patientUser, patientName: appt.patientName, rating, comment, createdAt: appt.scheduledAt });
    appt.reviewed = true;
    await appt.save();
  }
  for (const id of new Set(completedAppts.map((a) => a.provider.toString()))) await refreshProviderRating(id);
  log(`  ✓ ${completedAppts.length} reviews`);

  // medical info for the demo patient
  await User.updateOne({ _id: patients[0]._id }, { bloodGroup: 'O+', allergies: ['Penicillin', 'Dust'], conditions: [], emergencyContact: { name: 'Rahul Kumar', relation: 'Brother', phone: '+91 98765 12345' } });

  // emergency requests
  await EmergencyRequest.create({ patientUser: patients[1]._id, patientName: patients[1].name, phone: patients[1].phone, location: 'Chennai', type: 'Emergency Medical Assistance', priority: 'HIGH', status: 'Assigned', provider: ramesh._id, providerName: ramesh.name });
  await EmergencyRequest.create({ patientUser: patients[3]._id, patientName: patients[3].name, phone: patients[3].phone, location: 'Delhi', type: 'Ambulance Required', priority: 'CRITICAL', status: 'Waiting' });
  log('  ✓ 2 emergency requests');

  await JobApplication.create({ name: 'Lakshmi R', phone: '9840012345', email: 'lakshmi@example.com', role: 'Nurse', city: 'Chennai', experience: '5', about: 'ICU nurse with 5 years of experience.', source: 'jobs' });
}

export async function seedDatabase({ reset = false, silent = false } = {}) {
  const log = silent ? () => {} : console.log;

  if (reset) {
    await Promise.all([User, Provider, Appointment, Payment, JobApplication, Specialization, Service, Review, SiteContent, EmergencyRequest].map((m) => m.deleteMany({})));
    log('Database cleared.');
  }

  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@carevia.com').toLowerCase();
  if (!(await User.findOne({ role: 'admin' }))) {
    await User.create({ name: 'Super Admin', email: adminEmail, password: process.env.ADMIN_PASSWORD || 'Admin@123', role: 'admin' });
    console.log(`Admin account created: ${adminEmail}`);
  }

  if ((await Specialization.countDocuments()) === 0) {
    await Specialization.insertMany(SPECIALIZATIONS);
    log(`  ✓ ${SPECIALIZATIONS.length} specializations`);
  }
  if ((await Service.countDocuments()) === 0) {
    await Service.insertMany(SERVICES);
    log(`  ✓ ${SERVICES.length} services`);
  }
  for (const [key, items] of Object.entries(CONTENT)) {
    if (!(await SiteContent.findOne({ key }))) {
      await SiteContent.create({ key, items });
      log(`  ✓ content: ${key}`);
    }
  }
  await upgradeBlogPosts(log);
  await renameBrand(log);
  await syncServices(log);
}

// Older databases have a separate admin service list that the website did not use. Give every service a web
// address and make sure the services shown on the website exist, so admin changes appear on the site.
async function syncServices(log) {
  let changed = 0;
  for (const svc of await Service.find({ $or: [{ key: { $exists: false } }, { key: null }, { key: '' }] })) {
    const key = OLD_SERVICE_NAMES[svc.name] || slugify(svc.name);
    const seeded = SERVICES.find((x) => x.key === key);
    if (seeded && (await Service.findOne({ key }))) continue; // already present under its new name
    svc.key = key;
    if (seeded) Object.assign(svc, { name: seeded.name, short: svc.short || seeded.short, image: svc.image || seeded.image, icon: seeded.icon, order: seeded.order, matches: seeded.matches, desc: seeded.desc });
    else if (!svc.order || svc.order === 100) svc.order = 20;
    await svc.save();
    changed += 1;
  }
  for (const seeded of SERVICES) {
    if (await Service.findOne({ key: seeded.key })) continue;
    if (await Service.findOne({ name: seeded.name })) { await Service.updateOne({ name: seeded.name }, { $set: { key: seeded.key } }); changed += 1; continue; }
    await Service.create(seeded);
    changed += 1;
  }
  if (changed) log(`  ✓ website services synced (${changed} updated)`);
}

// The brand was renamed from Carevia to Carevaa: update website text already saved in older databases.
// (Login emails such as admin@carevia.com are left unchanged so existing accounts keep working.)
const rebrand = (text) => text.replace(/Carevia/g, 'Carevaa').replace(/CAREVIA/g, 'CAREVAA').replace(/(hello|careers|info|support)@carevia\.com/g, '$1@carevaa.com');
async function renameBrand(log) {
  let n = 0;
  for (const doc of await SiteContent.find()) {
    const before = JSON.stringify(doc.items);
    const after = rebrand(before);
    if (after !== before) { doc.items = JSON.parse(after); doc.markModified('items'); await doc.save(); n += 1; }
  }
  for (const svc of await Service.find()) {
    const before = JSON.stringify(svc.toObject());
    if (!/Carevia/.test(before)) continue;
    for (const k of ['name', 'title', 'description', 'desc']) if (typeof svc[k] === 'string') svc[k] = rebrand(svc[k]);
    await svc.save(); n += 1;
  }
  if (n) log(`  ✓ renamed Carevia to Carevaa in ${n} saved records`);
}

// Older databases have blog posts without a slug/body: add them so each post gets its own article page.
const slugify = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
async function upgradeBlogPosts(log) {
  const doc = await SiteContent.findOne({ key: 'blog' });
  if (!doc || !doc.items.some((p) => !p.slug || !p.body)) return;
  doc.items = doc.items.map((p) => {
    const seeded = CONTENT.blog.find((b) => b.title === p.title) || {};
    return { ...p, slug: p.slug || seeded.slug || slugify(p.title), category: p.category || seeded.category || 'Health', body: p.body || seeded.body || [p.desc].filter(Boolean) };
  });
  doc.markModified('items');
  await doc.save();
  log('  ✓ blog posts upgraded with article pages');
}

// Optional sample doctors/patients/appointments for local testing only: "npm run seed:demo"
export async function seedDemo() {
  if (await User.findOne({ email: 'doctor@carevia.com' })) {
    console.log('Demo data is already loaded.');
    return;
  }
  await seedDemoData(console.log);
  console.log('Demo data loaded. Remove it any time with "npm run remove-demo".');
}

// "npm run seed" (admin + catalog + site content), "npm run seed:reset" (wipe everything first), "npm run seed:demo" (add sample data)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { connectDB } = await import('../config/db.js');
  try {
    await connectDB();
    await seedDatabase({ reset: process.argv.includes('--reset') });
    if (process.argv.includes('--demo')) await seedDemo();
    console.log('Seeding complete.');
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
