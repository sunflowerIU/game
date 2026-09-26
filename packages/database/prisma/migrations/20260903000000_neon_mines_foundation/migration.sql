-- A session owns one current private state, rather than an append-only tile log.
CREATE TABLE "GameSessionState" (
    "gameSessionId" UUID NOT NULL,
    "engineSnapshot" JSONB NOT NULL,
    "lastSequence" INTEGER NOT NULL DEFAULT 0,
    "lastCommandId" UUID,
    "lastCommandFingerprint" CHAR(64),
    "expiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "GameSessionState_pkey" PRIMARY KEY ("gameSessionId"),
    CONSTRAINT "GameSessionState_snapshot_object_check" CHECK (jsonb_typeof("engineSnapshot") = 'object'),
    CONSTRAINT "GameSessionState_sequence_check" CHECK ("lastSequence" >= 0 AND "lastSequence" < 2147483647),
    CONSTRAINT "GameSessionState_command_check" CHECK (
      ("lastSequence" = 0 AND "lastCommandId" IS NULL AND "lastCommandFingerprint" IS NULL)
      OR ("lastSequence" > 0 AND "lastCommandId" IS NOT NULL AND "lastCommandFingerprint" IS NOT NULL
        AND "lastCommandFingerprint" ~ '^[0-9a-f]{64}$')
    ),
    CONSTRAINT "GameSessionState_expiry_check" CHECK ("expiresAt" IS NULL OR "expiresAt" >= "createdAt")
);

CREATE INDEX "GameSessionState_expiresAt_idx" ON "GameSessionState"("expiresAt");
ALTER TABLE "GameSessionState" ADD CONSTRAINT "GameSessionState_gameSessionId_fkey"
FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep the new game disabled until its backend, UI, and production checks are ready.
INSERT INTO "Game" ("id", "slug", "name", "status", "gameType", "createdAt", "updatedAt")
VALUES ('73e3398d-cb1d-4c22-96af-6f081d539e94', 'neon-mines', 'Neon Mines', 'DISABLED', 'SINGLE_PLAYER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "GameVersion" ("id", "gameId", "version", "configurationRevision", "minimumEntry", "maximumEntry", "configuration", "createdAt")
SELECT
  '5ad9cc8d-5154-46d4-b4aa-03e408368185', "id", '1.0.0', 1, 10, 500,
  '{
    "boardTiles": 25,
    "returnBps": 9600,
    "maximumMultiplierBps": 5000000,
    "maximumPayoutCents": 50000,
    "wagerDenominationsCents": [10, 25, 50, 100, 200, 500],
    "difficulties": {
      "EASY": { "mines": 3, "maximumWagerCents": 500 },
      "MEDIUM": { "mines": 5, "maximumWagerCents": 500 },
      "HARD": { "mines": 10, "maximumWagerCents": 200 },
      "EXPERT": { "mines": 15, "maximumWagerCents": 100 }
    }
  }'::jsonb,
  CURRENT_TIMESTAMP
FROM "Game" WHERE "slug" = 'neon-mines'
ON CONFLICT ("gameId", "version", "configurationRevision") DO NOTHING;

UPDATE "Game" SET "activeVersionId" = version."id", "updatedAt" = CURRENT_TIMESTAMP
FROM "GameVersion" version
WHERE "Game"."slug" = 'neon-mines' AND "Game"."activeVersionId" IS NULL
  AND version."gameId" = "Game"."id" AND version."version" = '1.0.0' AND version."configurationRevision" = 1;
