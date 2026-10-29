-- One-time fallback for applying the waitlist migration in Neon SQL Editor
-- when Prisma CLI cannot reach the database. Run the whole file once.
BEGIN;

ALTER TYPE "WaitlistStatus" ADD VALUE 'CANCELLED';

ALTER TABLE "Waitlist"
  ADD COLUMN "offeredStartAt" TIMESTAMP(3),
  ADD COLUMN "offerExpiresAt" TIMESTAMP(3);

CREATE INDEX "Waitlist_status_offerExpiresAt_idx"
  ON "Waitlist"("status", "offerExpiresAt");

CREATE UNIQUE INDEX "Waitlist_active_patient_doctor_date_key"
  ON "Waitlist"("patientId", "doctorId", "date")
  WHERE "status" IN ('WAITING', 'NOTIFIED');

CREATE UNIQUE INDEX "Waitlist_active_offered_slot_key"
  ON "Waitlist"("doctorId", "offeredStartAt")
  WHERE "status" = 'NOTIFIED';

-- Record the exact migration checksum so Prisma will not try to apply it again.
INSERT INTO "_prisma_migrations"
  ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
VALUES
  ('d0a63989-7a56-411a-9370-6738edbbbc7b',
   'a861807d839c3c3769ad08d837bfd0162537bc3193d406d88fde423993f8a783',
   now(),
   '20261028120000_waitlist_offers',
   NULL,
   NULL,
   now(),
   1);

COMMIT;
