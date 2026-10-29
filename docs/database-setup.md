# Neon Database Setup

Use Neon for the development PostgreSQL database so the project does not need a local database installation. `DATABASE_URL` is the pooled URL for app traffic; `DIRECT_URL` is the direct URL used by Prisma migrations and the seed script.

For this project in Nigeria, choose **AWS Europe Central 1 (Frankfurt)**. It is the closest region currently listed by Neon to Nigeria among the available choices; this is a geography-based estimate, not a measured latency guarantee. Neon's current region list includes Frankfurt and London among its European options. [Neon region availability](https://neon.com/blog/category/changelog)

## Create the database

1. Open the [Neon Console](https://console.neon.tech/) and sign in or create an account.
2. Create a PostgreSQL project. Choose **AWS Europe Central 1 (Frankfurt)**.
3. Open **Connect** for the project and copy both connection strings: with pooling enabled for `DATABASE_URL`, and with pooling disabled for `DIRECT_URL`. The pooled hostname contains `-pooler`; the direct hostname does not.
4. Check Neon's current [pricing and plan limits](https://neon.com/pricing) before creating the project; free plan limits can change.

Neon documents the Connect modal as the place to copy a project's connection string; the pooling toggle adds `-pooler` to the hostname. Prisma's Neon guide explains when to use direct and pooled connections. See [Neon's connection details guide](https://neon.com/docs/connect/connect-from-any-app) and [Prisma ORM's Neon guide](https://www.prisma.io/docs/orm/v6/overview/databases/neon).

## Connect this local project

GitHub is not needed to connect the database. The app connects directly from this local project using the environment file; create a GitHub repository later if you want version control or deployment integration.

## Configure the project

1. Copy `server/.env.example` to `server/.env`.
2. Set `DATABASE_URL` to the pooled Neon connection string and `DIRECT_URL` to the direct connection string.
3. Replace `JWT_SECRET` with a long random secret.
4. Keep `server/.env` private. It is ignored by Git; do not paste credentials into chat or commit them.

For local PostgreSQL, use its connection string in both `DATABASE_URL` and `DIRECT_URL`. No `sslmode=require` is needed for a typical local database.

## Apply the migration and seed demo data

From the repository root, run:

```powershell
pnpm --filter medical-appointment-server prisma:generate
pnpm --filter medical-appointment-server prisma:migrate:deploy
pnpm --filter medical-appointment-server prisma:seed
```

If your environment cannot reach Neon from Prisma CLI, open Neon SQL Editor and run [`apply-waitlist-migration-in-neon.sql`](apply-waitlist-migration-in-neon.sql) once. It applies the waitlist migration and records its checksum in Prisma's migration table. Do not run it if the migration is already listed as applied.

The seed creates demo accounts with the password `Password123!`. Its historical appointment data replaces appointments belonging to the dedicated demo patient accounts, so use a development database only.
