CREATE TYPE "AdminAuditAction" AS ENUM ('PLAYER_CREATED', 'PLAYER_ENABLED', 'PLAYER_DISABLED', 'PLAYER_PASSWORD_RESET');

CREATE TABLE "AdminAuditLog" (
    "id" BIGSERIAL NOT NULL,
    "adminId" UUID NOT NULL,
    "action" "AdminAuditAction" NOT NULL,
    "targetId" UUID NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" VARCHAR(500) NOT NULL,
    "ipAddress" VARCHAR(45) NOT NULL,
    "userAgent" VARCHAR(512),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AdminAuditLog_reason_check" CHECK (char_length(trim("reason")) BETWEEN 3 AND 500)
);

CREATE INDEX "AdminAuditLog_adminId_createdAt_idx" ON "AdminAuditLog"("adminId", "createdAt");
CREATE INDEX "AdminAuditLog_targetId_createdAt_idx" ON "AdminAuditLog"("targetId", "createdAt");
CREATE INDEX "AdminAuditLog_action_createdAt_idx" ON "AdminAuditLog"("action", "createdAt");

ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_adminId_fkey"
FOREIGN KEY ("adminId") REFERENCES "AdminProfile"("accountId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_targetId_fkey"
FOREIGN KEY ("targetId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_admin_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AdminAuditLog records are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AdminAuditLog_immutable"
BEFORE UPDATE OR DELETE ON "AdminAuditLog"
FOR EACH ROW EXECUTE FUNCTION prevent_admin_audit_mutation();
