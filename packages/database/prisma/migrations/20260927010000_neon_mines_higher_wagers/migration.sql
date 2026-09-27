-- Expand Neon Mines wagers while preserving the 500-coin gross payout cap and
-- the existing automatic cash-out liability behavior.
INSERT INTO "GameVersion" (
  "id", "gameId", "version", "configurationRevision",
  "minimumEntry", "maximumEntry", "configuration", "createdAt"
)
SELECT
  '2b630b8d-1308-42ef-8e55-f14dbece687f',
  game."id",
  active."version",
  active."configurationRevision" + 1,
  10,
  5000,
  jsonb_set(
    jsonb_set(
      active."configuration",
      '{wagerDenominationsCents}',
      '[10,25,50,100,200,500,1000,2000,5000]'::jsonb
    ),
    '{difficulties}',
    '{
      "EASY":{"mines":3,"maximumWagerCents":5000},
      "MEDIUM":{"mines":5,"maximumWagerCents":5000},
      "HARD":{"mines":10,"maximumWagerCents":2000},
      "EXPERT":{"mines":15,"maximumWagerCents":1000}
    }'::jsonb
  ),
  CURRENT_TIMESTAMP
FROM "Game" game
JOIN "GameVersion" active ON active."id" = game."activeVersionId"
WHERE game."slug" = 'neon-mines'
ON CONFLICT ("gameId", "version", "configurationRevision") DO NOTHING;

UPDATE "Game"
SET
  "activeVersionId" = '2b630b8d-1308-42ef-8e55-f14dbece687f',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'neon-mines'
  AND EXISTS (SELECT 1 FROM "GameVersion" WHERE "id" = '2b630b8d-1308-42ef-8e55-f14dbece687f');
