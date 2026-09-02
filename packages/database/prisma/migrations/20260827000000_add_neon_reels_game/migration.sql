INSERT INTO "Game" ("id", "slug", "name", "status", "gameType", "createdAt", "updatedAt")
VALUES ('f4d47ddc-b835-4cb3-b7df-73f231ef05e7', 'neon-reels', 'Neon Reels', 'ACTIVE', 'SINGLE_PLAYER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO UPDATE SET "name" = EXCLUDED."name", "gameType" = EXCLUDED."gameType", "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "GameVersion" ("id", "gameId", "version", "configurationRevision", "minimumEntry", "maximumEntry", "configuration", "createdAt")
SELECT
  '451baefc-40de-44fd-8863-3377d0b74689',
  "id",
  '1.0.0',
  1,
  10,
  500,
  '{
    "rows": 3,
    "reels": 5,
    "maxWinMultiplier": 100,
    "weights": { "LEMON": 30, "CHERRY": 24, "GEM": 18, "BELL": 13, "STAR": 8, "SEVEN": 4, "WILD": 3, "SCATTER": 4 },
    "payouts": {
      "LEMON": { "3": 1, "4": 2, "5": 4 },
      "CHERRY": { "3": 1, "4": 3, "5": 6 },
      "GEM": { "3": 2, "4": 5, "5": 10 },
      "BELL": { "3": 3, "4": 8, "5": 15 },
      "STAR": { "3": 4, "4": 10, "5": 20 },
      "SEVEN": { "3": 6, "4": 15, "5": 30 },
      "WILD": { "3": 8, "4": 20, "5": 50 }
    },
    "scatterPayouts": { "3": 2, "4": 5, "5": 12 }
  }'::jsonb,
  CURRENT_TIMESTAMP
FROM "Game"
WHERE "slug" = 'neon-reels'
ON CONFLICT ("gameId", "version", "configurationRevision") DO NOTHING;

UPDATE "Game"
SET
  "activeVersionId" = version."id",
  "status" = 'ACTIVE',
  "updatedAt" = CURRENT_TIMESTAMP
FROM "GameVersion" version
WHERE "Game"."slug" = 'neon-reels'
  AND version."gameId" = "Game"."id"
  AND version."version" = '1.0.0'
  AND version."configurationRevision" = 1;
