-- Allow administrators to deactivate accounts without deleting history.
ALTER TABLE "User"
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
