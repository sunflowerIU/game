-- Store all monetary values in cents. Existing values represented whole coins,
-- so scale them once to preserve every player's displayed balance and history.
ALTER TABLE "LedgerEntry" DISABLE TRIGGER "LedgerEntry_immutable";
ALTER TABLE "GameSession" DISABLE TRIGGER "GameSession_valid_transition";
ALTER TABLE "GameResult" DISABLE TRIGGER "GameResult_immutable";

UPDATE "Wallet" SET "balance" = "balance" * 100;
UPDATE "LedgerEntry" SET
  "amount" = "amount" * 100,
  "balanceBefore" = "balanceBefore" * 100,
  "balanceAfter" = "balanceAfter" * 100;
UPDATE "GameVersion" SET
  "minimumEntry" = "minimumEntry" * 100,
  "maximumEntry" = "maximumEntry" * 100;
UPDATE "GameSession" SET "entryAmount" = "entryAmount" * 100;
UPDATE "GameResult" SET "reward" = "reward" * 100;

ALTER TABLE "LedgerEntry" ENABLE TRIGGER "LedgerEntry_immutable";
ALTER TABLE "GameSession" ENABLE TRIGGER "GameSession_valid_transition";
ALTER TABLE "GameResult" ENABLE TRIGGER "GameResult_immutable";

-- Slots may move in one-cent increments even when their configured minimum is
-- higher. Keeping this in the immutable version snapshot makes the UI explicit.
UPDATE "GameVersion"
SET "configuration" = "configuration" || '{"wagerStepCents":1}'::jsonb
WHERE "gameId" = (SELECT "id" FROM "Game" WHERE "slug" = 'neon-reels');
