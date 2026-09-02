-- Identity enums
CREATE TYPE "PrincipalType" AS ENUM ('PLAYER', 'ADMIN');
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "SessionRevocationReason" AS ENUM ('LOGOUT', 'PASSWORD_CHANGED', 'ACCOUNT_DISABLED', 'ADMIN_REVOKED', 'SECURITY_EVENT');
CREATE TYPE "LoginOutcome" AS ENUM ('SUCCESS', 'INVALID_CREDENTIALS', 'ACCOUNT_DISABLED', 'RATE_LIMITED');

-- Account and credential roots
CREATE TABLE "Account" (
    "id" UUID NOT NULL,
    "username" VARCHAR(32) NOT NULL,
    "usernameNormalized" VARCHAR(32) NOT NULL,
    "type" "PrincipalType" NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "disabledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Account_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Account_username_length_check" CHECK (char_length("username") BETWEEN 3 AND 32),
    CONSTRAINT "Account_normalized_username_check" CHECK (
      "usernameNormalized" = lower("usernameNormalized")
      AND "usernameNormalized" ~ '^[a-z0-9_.-]{3,32}$'
    ),
    CONSTRAINT "Account_disabled_state_check" CHECK (
      ("status" = 'ACTIVE' AND "disabledAt" IS NULL)
      OR ("status" = 'DISABLED' AND "disabledAt" IS NOT NULL)
    )
);

CREATE TABLE "Credential" (
    "accountId" UUID NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "passwordVersion" INTEGER NOT NULL DEFAULT 1,
    "passwordChangedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Credential_pkey" PRIMARY KEY ("accountId"),
    CONSTRAINT "Credential_password_version_check" CHECK ("passwordVersion" > 0),
    CONSTRAINT "Credential_argon2id_check" CHECK ("passwordHash" LIKE '$argon2id$%')
);

CREATE TABLE "PlayerProfile" (
    "accountId" UUID NOT NULL,
    CONSTRAINT "PlayerProfile_pkey" PRIMARY KEY ("accountId")
);

CREATE TABLE "AdminProfile" (
    "accountId" UUID NOT NULL,
    "mfaRequired" BOOLEAN NOT NULL DEFAULT false,
    "mfaEnrolledAt" TIMESTAMPTZ(3),
    CONSTRAINT "AdminProfile_pkey" PRIMARY KEY ("accountId")
);

-- Centralized role and permission model
CREATE TABLE "Role" (
    "id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "description" VARCHAR(255),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Permission" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "description" VARCHAR(255),
    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminRoleAssignment" (
    "adminId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "grantedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminRoleAssignment_pkey" PRIMARY KEY ("adminId", "roleId")
);

CREATE TABLE "RolePermissionGrant" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,
    CONSTRAINT "RolePermissionGrant_pkey" PRIMARY KEY ("roleId", "permissionId")
);

-- Opaque, revocable sessions. Only token digests are stored.
CREATE TABLE "AuthSession" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),
    "revokeReason" "SessionRevocationReason",
    "ipAddress" VARCHAR(45) NOT NULL,
    "userAgent" VARCHAR(512),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuthSession_token_hash_check" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "AuthSession_expiry_check" CHECK ("expiresAt" > "createdAt"),
    CONSTRAINT "AuthSession_revocation_check" CHECK (
      ("revokedAt" IS NULL AND "revokeReason" IS NULL)
      OR ("revokedAt" IS NOT NULL AND "revokeReason" IS NOT NULL)
    )
);

-- Append-only login history. UPDATE/DELETE privileges are removed later in
-- production role provisioning; application code exposes inserts only.
CREATE TABLE "LoginEvent" (
    "id" BIGSERIAL NOT NULL,
    "accountId" UUID,
    "usernameNormalized" VARCHAR(32) NOT NULL,
    "outcome" "LoginOutcome" NOT NULL,
    "ipAddress" VARCHAR(45) NOT NULL,
    "userAgent" VARCHAR(512),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoginEvent_pkey" PRIMARY KEY ("id")
);

-- Uniqueness and access-path indexes
CREATE UNIQUE INDEX "Account_usernameNormalized_key" ON "Account"("usernameNormalized");
CREATE INDEX "Account_type_status_idx" ON "Account"("type", "status");
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");
CREATE INDEX "AdminRoleAssignment_roleId_idx" ON "AdminRoleAssignment"("roleId");
CREATE INDEX "RolePermissionGrant_permissionId_idx" ON "RolePermissionGrant"("permissionId");
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");
CREATE INDEX "AuthSession_accountId_expiresAt_idx" ON "AuthSession"("accountId", "expiresAt");
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");
CREATE INDEX "LoginEvent_usernameNormalized_createdAt_idx" ON "LoginEvent"("usernameNormalized", "createdAt");
CREATE INDEX "LoginEvent_ipAddress_createdAt_idx" ON "LoginEvent"("ipAddress", "createdAt");
CREATE INDEX "LoginEvent_accountId_createdAt_idx" ON "LoginEvent"("accountId", "createdAt");

-- Referential integrity
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerProfile" ADD CONSTRAINT "PlayerProfile_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminProfile" ADD CONSTRAINT "AdminProfile_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminRoleAssignment" ADD CONSTRAINT "AdminRoleAssignment_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminProfile"("accountId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminRoleAssignment" ADD CONSTRAINT "AdminRoleAssignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RolePermissionGrant" ADD CONSTRAINT "RolePermissionGrant_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RolePermissionGrant" ADD CONSTRAINT "RolePermissionGrant_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoginEvent" ADD CONSTRAINT "LoginEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Enforce exactly one profile matching Account.type and one credential. These
-- are deferred so Prisma can create the account and nested records in one
-- transaction without temporarily violating the invariant.
CREATE FUNCTION enforce_account_identity_shape() RETURNS trigger AS $$
DECLARE
  target_id UUID;
  account_type "PrincipalType";
BEGIN
  IF TG_TABLE_NAME = 'Account' THEN
    IF TG_OP = 'DELETE' THEN target_id := OLD."id"; ELSE target_id := NEW."id"; END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN target_id := OLD."accountId"; ELSE target_id := NEW."accountId"; END IF;
  END IF;
  SELECT "type" INTO account_type FROM "Account" WHERE "id" = target_id;
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "Credential" WHERE "accountId" = target_id) THEN
    RAISE EXCEPTION 'Account % must have a credential', target_id;
  END IF;

  IF account_type = 'PLAYER' THEN
    IF NOT EXISTS (SELECT 1 FROM "PlayerProfile" WHERE "accountId" = target_id)
       OR EXISTS (SELECT 1 FROM "AdminProfile" WHERE "accountId" = target_id) THEN
      RAISE EXCEPTION 'PLAYER account % must have only a player profile', target_id;
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM "AdminProfile" WHERE "accountId" = target_id)
       OR EXISTS (SELECT 1 FROM "PlayerProfile" WHERE "accountId" = target_id) THEN
      RAISE EXCEPTION 'ADMIN account % must have only an admin profile', target_id;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "Account_identity_shape"
AFTER INSERT OR UPDATE ON "Account"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_account_identity_shape();

CREATE CONSTRAINT TRIGGER "Credential_identity_shape"
AFTER INSERT OR UPDATE OR DELETE ON "Credential"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_account_identity_shape();

CREATE CONSTRAINT TRIGGER "PlayerProfile_identity_shape"
AFTER INSERT OR UPDATE OR DELETE ON "PlayerProfile"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_account_identity_shape();

CREATE CONSTRAINT TRIGGER "AdminProfile_identity_shape"
AFTER INSERT OR UPDATE OR DELETE ON "AdminProfile"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_account_identity_shape();
