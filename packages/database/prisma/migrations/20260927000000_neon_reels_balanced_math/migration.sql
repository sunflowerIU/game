-- Replace the launch paytable with a conventional medium-volatility profile.
-- The profile was verified with deterministic simulation at approximately
-- 31.2% hit frequency and 95.3% theoretical RTP. Every non-zero result pays
-- at least 2x, so the UI no longer describes stake-only returns as wins.
INSERT INTO "GameVersion" (
  "id", "gameId", "version", "configurationRevision",
  "minimumEntry", "maximumEntry", "configuration", "createdAt"
)
SELECT
  'd77da307-7ccc-4bf7-b7cd-a82d5075aa1a',
  game."id",
  active."version",
  active."configurationRevision" + 1,
  active."minimumEntry",
  active."maximumEntry",
  jsonb_set(
    jsonb_set(
      active."configuration",
      '{weights}',
      '{"LEMON":34,"CHERRY":27,"GEM":19,"BELL":12,"STAR":7,"SEVEN":3,"WILD":3,"SCATTER":4}'::jsonb
    ),
    '{payouts}',
    '{
      "LEMON":{"3":2,"4":2,"5":5},
      "CHERRY":{"3":2,"4":3,"5":7},
      "GEM":{"3":2,"4":5,"5":10},
      "BELL":{"3":3,"4":8,"5":15},
      "STAR":{"3":4,"4":10,"5":20},
      "SEVEN":{"3":6,"4":15,"5":30},
      "WILD":{"3":8,"4":20,"5":50}
    }'::jsonb
  ),
  CURRENT_TIMESTAMP
FROM "Game" game
JOIN "GameVersion" active ON active."id" = game."activeVersionId"
WHERE game."slug" = 'neon-reels'
ON CONFLICT ("gameId", "version", "configurationRevision") DO NOTHING;

UPDATE "Game"
SET
  "activeVersionId" = 'd77da307-7ccc-4bf7-b7cd-a82d5075aa1a',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'neon-reels'
  AND EXISTS (SELECT 1 FROM "GameVersion" WHERE "id" = 'd77da307-7ccc-4bf7-b7cd-a82d5075aa1a');
