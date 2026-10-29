# Medical Appointment Scheduling System

A free-to-run appointment scheduling system for patients, doctors and administrators. The project is organized as a monorepo with an Express API and a React client.

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- PostgreSQL (required when database-backed features are added)

## Getting started

1. Copy `server/.env.example` to `server/.env` and set `DATABASE_URL` and `JWT_SECRET`. See [docs/database-setup.md](docs/database-setup.md) for the Neon setup steps.
2. Install dependencies from the repository root with `pnpm install`.
3. Start both apps with `pnpm dev`.
4. Open the Vite URL printed in the terminal. The API health check is at `http://localhost:4000/api/health`.

For deployment preparation, see [docs/deployment.md](docs/deployment.md). The root-level `render.yaml` describes a single-service Render deployment; it does not publish the project by itself.

The API and client can also be started separately with `pnpm dev:server` and `pnpm dev:client`.

## Authentication

- `POST /api/auth/register` creates a patient account and returns a one-day bearer token.
- `POST /api/auth/login` signs in an existing patient, doctor, or administrator.
- `GET /api/auth/me` returns the signed-in user's safe profile; send `Authorization: Bearer <token>`.
- Patient registration creates email and in-app notification preferences enabled by default. Passwords are bcrypt-hashed, and authentication attempts are rate-limited.

## Scheduling

- `GET /api/doctors` lists doctors and accepts optional `search` and `departmentId` filters; `GET /api/doctors/departments` lists departments.
- `GET /api/doctors/:doctorId/slots?date=YYYY-MM-DD` returns future open slots up to 90 days ahead, with slot times shown in Nigeria time (`Africa/Lagos`) and ISO timestamps for booking.
- Doctors can read or replace their weekly schedule with `GET` or `PUT /api/doctors/me/availability`.
- Authenticated patients can book with `POST /api/appointments`, list their own visits with `GET /api/appointments`, and cancel or reschedule with the corresponding `PATCH /api/appointments/:appointmentId/cancel` or `/reschedule` route.
- Booking rejects times outside published availability, checks for overlapping appointments in a serializable transaction, and relies on the database's active-slot uniqueness constraint for concurrent requests. Cancellation and rescheduling require at least two hours' notice.

## Reminders and appointment actions

- A successful booking creates an in-app confirmation, attempts an email confirmation with an ICS calendar attachment, and schedules enabled email/in-app reminders 24 hours and two hours before the visit.
- The reminder worker runs every minute, records delivery state and errors, retries failures up to three attempts, and cancels pending reminders when an appointment is cancelled or rescheduled.
- Email links open a safe appointment summary. The patient must press Confirm or Cancel on that page; automated link previews do not change appointment state.
- `GET /api/notifications` lists the signed-in user's notifications. `PATCH /api/notifications/:notificationId/read` and `PATCH /api/notifications/read-all` mark them read.
- Email delivery is optional for local use. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `EMAIL_FROM` in `server/.env`; see [docs/reminders-setup.md](docs/reminders-setup.md). Never commit `server/.env`.

## Waitlist and calendar support

- Patients can join the waitlist for a fully booked doctor/date, withdraw while waiting, and claim a 30-minute slot offer from their dashboard or a private email link.
- Expired offers move to the next eligible patient. An offered slot is held from normal booking until claimed or expired.
- Each appointment has an **Add to calendar** download in the patient dashboard. Confirmation emails also include an ICS calendar attachment.
- The `20261028120000_waitlist_offers` migration adds offer fields, cancellation support, and indexes. Apply it with `pnpm --filter medical-appointment-server prisma:migrate:deploy` before using waitlist routes. If the CLI cannot reach Neon, use the one-time [Neon SQL Editor script](docs/apply-waitlist-migration-in-neon.sql).

## Doctor and admin dashboards

- Doctors can review their appointments by Nigeria-local date and record completed or no-show outcomes after the visit ends. The API scopes both schedule and outcome changes to the signed-in doctor's profile.
- Administrators can filter appointment activity by date and status and browse the result pages. Account management remains planned work.
- `GET /api/appointments?date=YYYY-MM-DD&status=PENDING&page=1` supports the dashboard filters; `PATCH /api/appointments/:appointmentId/outcome` accepts `COMPLETED` or `NO_SHOW` for the owning doctor.

## Admin appointment analytics

- `GET /api/analytics/summary?from=YYYY-MM-DD&to=YYYY-MM-DD` returns status counts, cancellation rate, and no-show rates overall and by patient confirmation status. The route is restricted to administrators and accepts ranges up to 366 days.
- `GET /api/analytics/patterns?from=YYYY-MM-DD&to=YYYY-MM-DD` groups appointments by Nigeria-local weekday, starting hour, doctor, and department. The admin dashboard displays these groupings and includes a CSV download for the selected date range.
- Waitlist slot-fill rate is claimed offers divided by resolved offers (claimed, expired, or withdrawn); active offers are shown separately. Waitlist offers are grouped by the date they were sent.
- Dates use `Africa/Lagos`. Cancellation rate divides cancelled appointments by all appointments in the selected period; no-show rate divides no-shows by visits marked completed or no-show. The dashboard defaults to the latest 30 days.

## Admin reminder monitoring

- `GET /api/reminders?from=YYYY-MM-DD&to=YYYY-MM-DD&status=FAILED&type=EMAIL&page=1` lists paginated reminder delivery records for administrators, including channel, attempts, sent time, and bounded error text. Date filters use scheduled time in `Africa/Lagos`.

## Account and department management

- Admins can search and page through accounts, deactivate/reactivate access, create doctor accounts with a department and profile, add or rename departments, and reassign doctors.
- Inactive accounts are rejected at login and on authenticated requests; inactive doctors are hidden from booking, and inactive patients cannot claim waitlist or email action links.
- The `20261028150000_admin_accounts` migration adds `User.isActive`. Apply it with Prisma migrate deploy, or run the one-time [`apply-admin-accounts-migration-in-neon.sql`](docs/apply-admin-accounts-migration-in-neon.sql) in Neon SQL Editor if the local CLI cannot connect. Then run `pnpm --filter medical-appointment-server prisma:generate`.

## Work plan

Development follows the project brief in order: setup, requirements and design, database, authentication, scheduling, reminders and appointment actions, waitlist and calendar support, patient and staff interfaces, analytics, testing, deployment, report writing and defence preparation. See `docs/` as project documentation is added.
