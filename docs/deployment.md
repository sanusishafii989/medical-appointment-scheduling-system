# Deployment preparation

The repository includes a Render Blueprint for a single web service. The service builds the React client and Express API together, then serves both from one HTTPS URL. This keeps the browser and API on the same origin.

## Before connecting Render

1. The project folder has a local Git repository. Create a **private GitHub repository** and push this project to it if you have not already done so.
2. Confirm that `server/.env` is not included in the repository. The project `.gitignore` excludes `.env` files.
3. Confirm that the Neon database already has the required migrations. Do not run the demo seed script on a live database.

## Connect the Blueprint

1. In Render, create a new **Blueprint** and connect the private repository.
2. Render reads `render.yaml` and builds the client and API as one web service.
3. Enter the current pooled Neon connection string as `DATABASE_URL` and the unpooled string as `DIRECT_URL`. Keep both private. Render generates `JWT_SECRET` for the deployed service.
4. Wait for the deployment and open `/api/health` on the Render URL. It should return `{"success":true,"status":"ok"}`. Open the root URL to use the app.

## Demo and production limits

- The Blueprint selects Render's free web plan to avoid selecting a paid plan without the owner's choice. Free web services spin down after inactivity. Since reminders are processed by a worker inside the API process, reminders are not reliable while that service is asleep. Choose an always-on plan before relying on reminders for real appointments.
- Email reminders require SMTP settings (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `EMAIL_FROM`) in the Render service environment. Without these, email delivery is disabled; in-app reminders still use the API worker.
- The project contains demo seed accounts. The deployment build does not seed the database. Before sharing a public deployment, review the accounts already in Neon and replace any demo credentials with private credentials.
- Apply future database migrations before deploying code that depends on them. The API's Neon adapter is for runtime queries; Prisma migration commands use the direct database connection.
