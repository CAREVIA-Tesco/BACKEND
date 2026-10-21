# Carevia Backend (Express + MongoDB)

See the main `../README.md` for setup and run steps.

## Structure

```
Backend/
├── server.js                 # entry: loads .env, connects DB, seeds first run, starts server
├── .env / .env.example       # configuration
├── scripts/smoke-test.mjs    # end-to-end API test (npm run test:api)
└── src/
    ├── app.js                # express app, CORS, routes, error handler
    ├── config/db.js          # MongoDB connection
    ├── middleware/           # auth (JWT, roles) + error handling
    ├── models/               # User, Provider, Appointment, Payment, JobApplication, Specialization/Service
    ├── controllers/          # business logic
    ├── routes/index.js       # all /api routes
    ├── seed/seed.js          # admin account, catalog, site content (+ optional demo data)
    ├── seed/removeDemo.js    # removes sample doctors/patients (runs once automatically)
    └── utils/format.js       # shapes data for the existing frontend
```

## API (all under `/api`)

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/auth/register` | public | Register patient / doctor |
| POST | `/auth/login` | public | Login (email or phone) |
| GET/PUT | `/auth/me` | logged in | Current user / update profile & password |
| GET | `/providers` | public (admin sees all with `?status=ALL`) | List doctors & care professionals |
| GET | `/providers/me` | doctor | Own professional profile |
| POST | `/providers/onboarding` | doctor | Submit / update onboarding (goes to PENDING) |
| GET/PUT/DELETE | `/providers/:id` | public / admin+owner / admin | Provider detail, edit, delete |
| PATCH | `/providers/:id/status` | admin | Approve / reject / suspend |
| POST | `/appointments` | public (patient linked when logged in) | Book appointment + payment |
| GET | `/appointments` | logged in | Own (patient/doctor) or all (admin) |
| PATCH | `/appointments/:id/reschedule` | owner / admin | Reschedule |
| PATCH | `/appointments/:id/complete` | doctor / admin | Complete with visit notes |
| PATCH | `/appointments/:id/cancel` | owner / admin | Cancel (auto refund if paid) |
| GET | `/admin/stats` | admin | Dashboard KPIs, charts, recent appointments |
| GET/PATCH | `/admin/patients[/:id]` | admin | Patients list / detail / update |
| GET | `/admin/payments` | admin | Payments, refunds, payouts |
| POST | `/admin/payments/:id/refund` | admin | Refund a payment |
| GET/POST | `/admin/payouts[/:providerId]` | admin | Provider earnings / process payout |
| CRUD | `/specializations`, `/services` | read public, write admin | Catalog |
| POST/GET | `/applications` | public / admin | Job applications |
| GET | `/health` | public | Health check |
