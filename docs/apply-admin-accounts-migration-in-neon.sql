-- One-time fallback for applying the admin account migration in Neon SQL Editor
-- when Prisma CLI cannot reach the database. Run the whole file once.
BEGIN;

ALTER TABLE "User"
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

INSERT INTO "_prisma_migrations"
  ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
VALUES
  ('d31a8249-b257-4071-818e-2825b7c432f4',
   '435ba2b3f1eb2ff85d70ab87a7868216a28da83b368329fa46d4c3a0f87e1856',
   now(),
   '20261028150000_admin_accounts',
   NULL,
   NULL,
   now(),
   1);

COMMIT;
