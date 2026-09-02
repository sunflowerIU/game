BEGIN;

ALTER TABLE "AdminAuditLog" DISABLE TRIGGER "AdminAuditLog_immutable";
ALTER TABLE "LedgerEntry" DISABLE TRIGGER "LedgerEntry_immutable";
ALTER TABLE "GameResult" DISABLE TRIGGER "GameResult_immutable";
ALTER TABLE "GameSession" DISABLE TRIGGER "GameSession_valid_transition";

DELETE FROM "AdminAuditLog"
WHERE "targetGameId" IN (SELECT "id" FROM "Game" WHERE "slug" = 'target-rush');

DELETE FROM "SecurityEvent"
WHERE "gameSessionId" IN (
  SELECT "id" FROM "GameSession"
  WHERE "gameId" IN (SELECT "id" FROM "Game" WHERE "slug" = 'target-rush')
);

DELETE FROM "LedgerEntry"
WHERE "referenceType" = 'GAME_SESSION'
  AND "referenceId" IN (
    SELECT "id"::text FROM "GameSession"
    WHERE "gameId" IN (SELECT "id" FROM "Game" WHERE "slug" = 'target-rush')
  );

DELETE FROM "GameSessionParticipant"
WHERE "gameSessionId" IN (
  SELECT "id" FROM "GameSession"
  WHERE "gameId" IN (SELECT "id" FROM "Game" WHERE "slug" = 'target-rush')
);

DELETE FROM "GameResult"
WHERE "gameSessionId" IN (
  SELECT "id" FROM "GameSession"
  WHERE "gameId" IN (SELECT "id" FROM "Game" WHERE "slug" = 'target-rush')
);

DELETE FROM "GameSession"
WHERE "gameId" IN (SELECT "id" FROM "Game" WHERE "slug" = 'target-rush');

UPDATE "Game" SET "activeVersionId" = NULL WHERE "slug" = 'target-rush';
DELETE FROM "GameVersion" WHERE "gameId" IN (SELECT "id" FROM "Game" WHERE "slug" = 'target-rush');
DELETE FROM "Game" WHERE "slug" = 'target-rush';

SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE "GameSession" ENABLE TRIGGER "GameSession_valid_transition";
ALTER TABLE "GameResult" ENABLE TRIGGER "GameResult_immutable";
ALTER TABLE "LedgerEntry" ENABLE TRIGGER "LedgerEntry_immutable";
ALTER TABLE "AdminAuditLog" ENABLE TRIGGER "AdminAuditLog_immutable";

COMMIT;
