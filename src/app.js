import express from 'express';
import cors from 'cors';
import routes from './routes/index.js';
import { notFound, errorHandler } from './middleware/error.js';

const app = express();
app.set('trust proxy', 1); // behind Render's proxy: use the visitor's IP for rate limits

// the live website is always allowed; add more origins (comma separated) in CLIENT_URL
const allowed = [...new Set([
  'https://www.carevaa.com',
  'https://carevaa.com',
  ...(process.env.CLIENT_URL || 'http://localhost:5173').split(',').map((o) => o.trim().replace(/\/$/, '')),
])].filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      // allow tools like curl/Postman (no origin), configured origins, and any localhost port in development
      if (!origin || allowed.includes(origin) || (process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) {
        return cb(null, true);
      }
      return cb(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '4mb' }));

app.get('/', (_req, res) => res.json({ name: 'Carevaa API', status: 'running', docs: '/api/health' }));
app.use('/api', routes);
app.use(notFound);
app.use(errorHandler);

export default app;
