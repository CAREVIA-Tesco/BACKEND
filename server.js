import 'dotenv/config';
import app from './src/app.js';
import { connectDB } from './src/config/db.js';
import { seedDatabase } from './src/seed/seed.js';
import { removeDemoDataOnce } from './src/seed/removeDemo.js';
import { renumberCodesOnce } from './src/seed/renumberCodes.js';

const PORT = process.env.PORT || 5000;

if (!process.env.JWT_SECRET) {
  console.warn('[warn] JWT_SECRET is not set – using an insecure development secret. Set it in Backend/.env');
  process.env.JWT_SECRET = 'carevia_insecure_dev_secret';
}

try {
  await connectDB();
  await renumberCodesOnce(); // one-time switch to ENQ-0001 / APT-0001 / DOC-0001 IDs
  await seedDatabase({ silent: true }); // creates the admin account, catalog and site content when missing
  await removeDemoDataOnce(); // one-time cleanup of the old sample doctors/patients
  // new doctor registrations stay PENDING until an admin approves them (Admin → Doctors & Providers)
  app.listen(PORT, () => console.log(`Carevaa API running on http://localhost:${PORT}`));
} catch (err) {
  console.error('Failed to start server:', err.message);
  process.exit(1);
}
