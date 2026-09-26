-- Run only against a disposable database with all migrations applied.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Game" WHERE "slug" = 'neon-mines' AND "status" = 'DISABLED' AND "activeVersionId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Neon Mines must start disabled with a configured version';
  END IF;
END;
$$;

INSERT INTO "Account" ("id", "username", "usernameNormalized", "type", "updatedAt")
VALUES ('519eb829-5ea6-4d99-bde0-695a994713bc', 'mines_test', 'mines_test', 'PLAYER', CURRENT_TIMESTAMP);
INSERT INTO "Credential" ("accountId", "passwordHash")
VALUES ('519eb829-5ea6-4d99-bde0-695a994713bc', '$argon2id$test-only');
INSERT INTO "PlayerProfile" ("accountId") VALUES ('519eb829-5ea6-4d99-bde0-695a994713bc');
INSERT INTO "Wallet" ("id", "accountId", "updatedAt")
VALUES (gen_random_uuid(), '519eb829-5ea6-4d99-bde0-695a994713bc', CURRENT_TIMESTAMP);
INSERT INTO "GameSession" ("id", "ownerAccountId", "gameId", "gameVersionId", "gameVersion", "status", "entryAmount", "startIdempotencyKey", "startedAt")
SELECT 'ce4b89e8-d1fb-4cbe-9a66-f88c9d9c8784', '519eb829-5ea6-4d99-bde0-695a994713bc', "id", "activeVersionId", '1.0.0', 'ACTIVE', 100, 'mines-section-three-test', CURRENT_TIMESTAMP
FROM "Game" WHERE "slug" = 'neon-mines';
INSERT INTO "GameSessionParticipant" ("gameSessionId", "accountId")
VALUES ('ce4b89e8-d1fb-4cbe-9a66-f88c9d9c8784', '519eb829-5ea6-4d99-bde0-695a994713bc');
INSERT INTO "GameSessionState" ("gameSessionId", "engineSnapshot", "expiresAt", "updatedAt")
VALUES ('ce4b89e8-d1fb-4cbe-9a66-f88c9d9c8784', '{"status":"ACTIVE"}', CURRENT_TIMESTAMP + INTERVAL '15 minutes', CURRENT_TIMESTAMP);
SET CONSTRAINTS ALL IMMEDIATE;

DO $$
BEGIN
  BEGIN
    INSERT INTO "GameSessionState" ("gameSessionId", "engineSnapshot", "updatedAt")
    VALUES ('ce4b89e8-d1fb-4cbe-9a66-f88c9d9c8784', '{}', CURRENT_TIMESTAMP);
    RAISE EXCEPTION 'Duplicate state row was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    UPDATE "GameSessionState" SET "engineSnapshot" = '[]';
    RAISE EXCEPTION 'Non-object snapshot was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE "GameSessionState" SET "lastSequence" = 1;
    RAISE EXCEPTION 'Sequence without command identity was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE "GameSessionState" SET "lastSequence" = -1;
    RAISE EXCEPTION 'Negative sequence was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE "GameSessionState" SET "expiresAt" = "createdAt" - INTERVAL '1 second';
    RAISE EXCEPTION 'Invalid expiry was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

UPDATE "GameSessionState"
SET "lastSequence" = 1, "lastCommandId" = '2c84e3d5-4ba7-49ec-9c57-70ea25f30131',
    "lastCommandFingerprint" = repeat('a', 64), "engineSnapshot" = '{"status":"ACTIVE","selectedTiles":[7]}';
DO $$
BEGIN
  IF (SELECT count(*) FROM "GameSessionState") <> 1 THEN RAISE EXCEPTION 'Move created extra state rows'; END IF;
  BEGIN
    UPDATE "GameSessionState" SET "lastCommandFingerprint" = 'bad';
    RAISE EXCEPTION 'Invalid fingerprint was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

SET CONSTRAINTS ALL DEFERRED;
DELETE FROM "GameSession" WHERE "id" = 'ce4b89e8-d1fb-4cbe-9a66-f88c9d9c8784';
SET CONSTRAINTS ALL IMMEDIATE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "GameSessionState" WHERE "gameSessionId" = 'ce4b89e8-d1fb-4cbe-9a66-f88c9d9c8784') THEN
    RAISE EXCEPTION 'Session cleanup did not cascade to private state';
  END IF;
END;
$$;
ROLLBACK;
