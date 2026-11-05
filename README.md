# Medical Appointment Scheduling System

A full-stack appointment scheduling system for patients, doctors, and administrators. It supports appointment booking, automated reminders, a waitlist, and appointment analytics.

## Features

- **Patients:** create an account, find doctors, book or manage appointments, join a waitlist, and download calendar events.
- **Doctors:** manage weekly availability, review appointments, and record visit outcomes.
- **Administrators:** manage accounts and departments, review appointments, and monitor reminder delivery and analytics.
- **Notifications:** in-app updates and optional email confirmations and reminders.
- **Time zone:** appointment dates and times use `Africa/Lagos`.

## Technology

React, Vite, Express, Prisma ORM, and PostgreSQL. The project uses Neon PostgreSQL and Prisma's Neon adapter for runtime database access.

## Run locally

Requirements: Node.js 20 or newer and pnpm.

1. Copy `server/.env.example` to `server/.env`.
2. Set `DATABASE_URL` to Neon’s pooled connection string, `DIRECT_URL` to its direct connection string, and `JWT_SECRET` to a long private value.
3. From the project root, install and start the app:

   ```powershell
   pnpm install
   pnpm dev
   ```

4. Open the Vite URL shown in the terminal. The API health check is `http://localhost:4000/api/health`.

For mobile testing on the same Wi-Fi network, open the Vite network URL shown in the terminal (or use `http://<computer-LAN-IP>:5173`). API requests are proxied through Vite to the local backend, so the frontend does not need a device-specific API URL. Allow port 5173 through the computer's firewall if prompted.

Keep `server/.env` private. It is excluded by `.gitignore`.

## Tests and build

```powershell
pnpm --filter medical-appointment-server test
pnpm --filter medical-appointment-client test
pnpm --filter medical-appointment-client build
```

## Database setup

See [Neon database setup](docs/database-setup.md). Apply database migrations before using the features that depend on them. If Prisma CLI cannot reach Neon from your network, the one-time SQL scripts in `docs/` can be run from Neon’s SQL Editor.

The demo seed script is for development only. Do not run it against a production database.

## Deployment

The root `render.yaml` describes a single Render web service that serves the API and built frontend together. See [deployment instructions](docs/deployment.md) for GitHub setup, environment variables, and the limits of the free hosting plan. The Blueprint does not publish the project automatically.

## Project documentation

- [Requirements and system design](docs/requirements.md)
- [Entity relationship diagram](docs/er-diagram.md)
- [Email reminder setup](docs/reminders-setup.md)
- [Deployment guide](docs/deployment.md)
