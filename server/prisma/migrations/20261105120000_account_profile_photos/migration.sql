ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "profileImageBytes" BYTEA,
  ADD COLUMN IF NOT EXISTS "profileImageContentType" TEXT;
