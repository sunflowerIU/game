ALTER TYPE "AdminAuditAction" ADD VALUE 'WALLET_CREDITED';
ALTER TYPE "AdminAuditAction" ADD VALUE 'WALLET_DEBITED';

CREATE TYPE "LedgerEntryType" AS ENUM ('ADMIN_DEPOSIT', 'ADMIN_DEBIT', 'GAME_ENTRY', 'GAME_REWARD', 'REDEMPTION', 'REFUND', 'BONUS', 'ADJUSTMENT');
CREATE TYPE "LedgerActorType" AS ENUM ('ADMIN', 'SYSTEM', 'GAME', 'PLAYER');

CREATE TABLE "Wallet" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Wallet_nonnegative_balance_check" CHECK ("balance" >= 0),
    CONSTRAINT "Wallet_nonnegative_version_check" CHECK ("version" >= 0)
);

CREATE TABLE "LedgerEntry" (
    "id" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "amount" BIGINT NOT NULL,
    "balanceBefore" BIGINT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "referenceType" VARCHAR(64) NOT NULL,
    "referenceId" VARCHAR(128) NOT NULL,
    "idempotencyKey" VARCHAR(100) NOT NULL,
    "createdByType" "LedgerActorType" NOT NULL,
    "createdById" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LedgerEntry_nonzero_amount_check" CHECK ("amount" <> 0),
    CONSTRAINT "LedgerEntry_balance_check" CHECK ("balanceBefore" >= 0 AND "balanceAfter" >= 0 AND "balanceAfter" = "balanceBefore" + "amount"),
    CONSTRAINT "LedgerEntry_idempotency_key_check" CHECK ("idempotencyKey" ~ '^[A-Za-z0-9._:-]{16,100}$')
);

CREATE UNIQUE INDEX "Wallet_accountId_key" ON "Wallet"("accountId");
CREATE UNIQUE INDEX "LedgerEntry_walletId_idempotencyKey_key" ON "LedgerEntry"("walletId", "idempotencyKey");
CREATE INDEX "LedgerEntry_walletId_createdAt_idx" ON "LedgerEntry"("walletId", "createdAt");
CREATE INDEX "LedgerEntry_referenceType_referenceId_idx" ON "LedgerEntry"("referenceType", "referenceId");

ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Wallet" ("id", "accountId", "balance", "version", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "Account" WHERE "type" = 'PLAYER';

CREATE FUNCTION prevent_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'LedgerEntry records are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LedgerEntry_immutable"
BEFORE UPDATE OR DELETE ON "LedgerEntry"
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

CREATE OR REPLACE FUNCTION enforce_account_identity_shape() RETURNS trigger AS $$
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
       OR EXISTS (SELECT 1 FROM "AdminProfile" WHERE "accountId" = target_id)
       OR NOT EXISTS (SELECT 1 FROM "Wallet" WHERE "accountId" = target_id) THEN
      RAISE EXCEPTION 'PLAYER account % must have only a player profile and one wallet', target_id;
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM "AdminProfile" WHERE "accountId" = target_id)
       OR EXISTS (SELECT 1 FROM "PlayerProfile" WHERE "accountId" = target_id)
       OR EXISTS (SELECT 1 FROM "Wallet" WHERE "accountId" = target_id) THEN
      RAISE EXCEPTION 'ADMIN account % must have only an admin profile and no wallet', target_id;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "Wallet_identity_shape"
AFTER INSERT OR UPDATE OR DELETE ON "Wallet"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_account_identity_shape();
