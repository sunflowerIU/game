-- Register the immutable Neon Dice 1.0.0 rules while keeping the game unavailable
-- until settlement, player UI, administration, and launch verification are complete.
INSERT INTO "Game" ("id", "slug", "name", "status", "gameType", "createdAt", "updatedAt")
VALUES ('f41f6329-b3db-4531-922b-c7ec4c54e17e', 'neon-dice', 'Neon Dice', 'DISABLED', 'SINGLE_PLAYER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "GameVersion" ("id", "gameId", "version", "configurationRevision", "minimumEntry", "maximumEntry", "configuration", "createdAt")
SELECT
  'ef9fb73a-c528-4480-9a7f-1d7721766987',
  "id",
  '1.0.0',
  1,
  50,
  3000,
  '{
    "returnBps": 9500,
    "multiplierBps": {
      "UNDER_7": 22800,
      "EXACTLY_7": 57000,
      "OVER_7": 22800
    },
    "wagerDenominationsCents": [50, 100, 200, 500, 1000, 2000, 3000],
    "maximumPayoutCents": 20000
  }'::jsonb,
  CURRENT_TIMESTAMP
FROM "Game"
WHERE "slug" = 'neon-dice'
ON CONFLICT ("gameId", "version", "configurationRevision") DO NOTHING;

UPDATE "Game"
SET "activeVersionId" = version."id", "updatedAt" = CURRENT_TIMESTAMP
FROM "GameVersion" version
WHERE "Game"."slug" = 'neon-dice'
  AND "Game"."activeVersionId" IS NULL
  AND version."gameId" = "Game"."id"
  AND version."version" = '1.0.0'
  AND version."configurationRevision" = 1;
