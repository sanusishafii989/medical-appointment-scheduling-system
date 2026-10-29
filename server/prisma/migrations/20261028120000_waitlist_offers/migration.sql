-- Extend waitlist entries with a specific offered slot and claim deadline.
ALTER TYPE "WaitlistStatus" ADD VALUE 'CANCELLED';

ALTER TABLE "Waitlist"
  ADD COLUMN "offeredStartAt" TIMESTAMP(3),
  ADD COLUMN "offerExpiresAt" TIMESTAMP(3);

CREATE INDEX "Waitlist_status_offerExpiresAt_idx"
  ON "Waitlist"("status", "offerExpiresAt");

-- A patient may rejoin after withdrawing or expiring, but cannot hold duplicate active entries.
CREATE UNIQUE INDEX "Waitlist_active_patient_doctor_date_key"
  ON "Waitlist"("patientId", "doctorId", "date")
  WHERE "status" IN ('WAITING', 'NOTIFIED');

CREATE UNIQUE INDEX "Waitlist_active_offered_slot_key"
  ON "Waitlist"("doctorId", "offeredStartAt")
  WHERE "status" = 'NOTIFIED';
