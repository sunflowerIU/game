ALTER TYPE "LoginOutcome" ADD VALUE 'LOGOUT';

ALTER TABLE "PlayerProfile"
ADD COLUMN "lastLoginAt" TIMESTAMPTZ(3);

CREATE INDEX "PlayerProfile_lastLoginAt_idx"
ON "PlayerProfile"("lastLoginAt");
