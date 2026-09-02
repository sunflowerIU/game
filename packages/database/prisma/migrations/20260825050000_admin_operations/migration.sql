ALTER TYPE "AdminAuditAction" ADD VALUE 'GAME_STATUS_CHANGED';
ALTER TYPE "AdminAuditAction" ADD VALUE 'GAME_CONFIG_UPDATED';
CREATE TYPE "AdminAuditTargetType" AS ENUM ('ACCOUNT', 'GAME');

ALTER TABLE "AdminAuditLog" DROP CONSTRAINT "AdminAuditLog_targetId_fkey";
DROP INDEX "AdminAuditLog_targetId_createdAt_idx";
ALTER TABLE "AdminAuditLog" RENAME COLUMN "targetId" TO "targetAccountId";
ALTER TABLE "AdminAuditLog" ALTER COLUMN "targetAccountId" DROP NOT NULL;
ALTER TABLE "AdminAuditLog" ADD COLUMN "targetType" "AdminAuditTargetType" NOT NULL DEFAULT 'ACCOUNT';
ALTER TABLE "AdminAuditLog" ALTER COLUMN "targetType" DROP DEFAULT;
ALTER TABLE "AdminAuditLog" ADD COLUMN "targetGameId" UUID;
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_targetAccountId_fkey" FOREIGN KEY ("targetAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_targetGameId_fkey" FOREIGN KEY ("targetGameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_target_check" CHECK (
  ("targetType" = 'ACCOUNT' AND "targetAccountId" IS NOT NULL AND "targetGameId" IS NULL) OR
  ("targetType" = 'GAME' AND "targetGameId" IS NOT NULL AND "targetAccountId" IS NULL)
);
CREATE INDEX "AdminAuditLog_targetAccountId_createdAt_idx" ON "AdminAuditLog"("targetAccountId", "createdAt");
CREATE INDEX "AdminAuditLog_targetGameId_createdAt_idx" ON "AdminAuditLog"("targetGameId", "createdAt");

ALTER TABLE "GameVersion" ADD COLUMN "configurationRevision" INTEGER NOT NULL DEFAULT 1;
DROP INDEX "GameVersion_gameId_version_key";
CREATE UNIQUE INDEX "GameVersion_gameId_version_configurationRevision_key" ON "GameVersion"("gameId", "version", "configurationRevision");
