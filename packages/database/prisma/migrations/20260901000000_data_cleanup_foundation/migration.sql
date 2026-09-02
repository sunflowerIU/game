CREATE TYPE "DataCleanupAction" AS ENUM ('PLAYER_DELETED', 'PLAYER_RECORDS_DELETED', 'INACTIVE_PLAYERS_DELETED');

CREATE TABLE "DataCleanupRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "idempotencyKey" VARCHAR(100) NOT NULL,
    "adminId" UUID NOT NULL,
    "action" "DataCleanupAction" NOT NULL,
    "targetAccountIdSnapshot" UUID,
    "targetUsernameSnapshot" VARCHAR(32),
    "cutoffAt" TIMESTAMPTZ(3),
    "recordCounts" JSONB NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "ipAddress" VARCHAR(45) NOT NULL,
    "userAgent" VARCHAR(512),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DataCleanupRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DataCleanupRun_idempotency_key_check" CHECK ("idempotencyKey" ~ '^[A-Za-z0-9._:-]{16,100}$'),
    CONSTRAINT "DataCleanupRun_reason_check" CHECK (char_length(trim("reason")) BETWEEN 3 AND 500),
    CONSTRAINT "DataCleanupRun_player_target_check" CHECK (
      ("action" = 'PLAYER_DELETED' AND "targetAccountIdSnapshot" IS NOT NULL AND "targetUsernameSnapshot" IS NOT NULL)
      OR "action" <> 'PLAYER_DELETED'
    )
);

CREATE UNIQUE INDEX "DataCleanupRun_idempotencyKey_key" ON "DataCleanupRun"("idempotencyKey");
CREATE INDEX "DataCleanupRun_adminId_createdAt_idx" ON "DataCleanupRun"("adminId", "createdAt");
CREATE INDEX "DataCleanupRun_action_createdAt_idx" ON "DataCleanupRun"("action", "createdAt");
CREATE INDEX "DataCleanupRun_targetAccountIdSnapshot_createdAt_idx" ON "DataCleanupRun"("targetAccountIdSnapshot", "createdAt");

ALTER TABLE "DataCleanupRun" ADD CONSTRAINT "DataCleanupRun_adminId_fkey"
FOREIGN KEY ("adminId") REFERENCES "AdminProfile"("accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Permission" ("id", "code", "description") VALUES
  (gen_random_uuid(), 'PLAYER_DELETE', 'Permanently delete an individual player and all related data'),
  (gen_random_uuid(), 'DATA_RETENTION_MANAGE', 'Preview and execute retention-based data cleanup')
ON CONFLICT ("code") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "RolePermissionGrant" ("roleId", "permissionId")
SELECT role."id", permission."id"
FROM "Role" role
CROSS JOIN "Permission" permission
WHERE role."name" = 'SUPER_ADMIN'
  AND permission."code" IN ('PLAYER_DELETE', 'DATA_RETENTION_MANAGE')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

CREATE FUNCTION data_cleanup_is_authorized() RETURNS boolean AS $$
DECLARE
  cleanup_run_id TEXT;
BEGIN
  cleanup_run_id := current_setting('app.cleanup_run_id', true);
  IF cleanup_run_id IS NULL OR cleanup_run_id = '' THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (SELECT 1 FROM "DataCleanupRun" WHERE "id" = cleanup_run_id::UUID);
EXCEPTION WHEN invalid_text_representation THEN
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_admin_audit_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND data_cleanup_is_authorized() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'AdminAuditLog records are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_ledger_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND data_cleanup_is_authorized() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'LedgerEntry records are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_game_result_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND data_cleanup_is_authorized() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'GameResult records are immutable';
END;
$$ LANGUAGE plpgsql;
