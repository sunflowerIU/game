-- Activate the complete fixed wager menu. Values are cents, so these represent
-- 0.1, 0.5, 1, 5, 10, 20 and 50 coins respectively.
INSERT INTO "GameVersion" (
  "id", "gameId", "version", "configurationRevision",
  "minimumEntry", "maximumEntry", "configuration", "createdAt"
)
SELECT
  '4b213bec-69b5-4098-8f09-8ece1a81b405',
  game."id",
  active."version",
  active."configurationRevision" + 1,
  10,
  5000,
  (active."configuration" - 'wagerStepCents') || '{"wagerDenominationsCents":[10,50,100,500,1000,2000,5000]}'::jsonb,
  CURRENT_TIMESTAMP
FROM "Game" game
JOIN "GameVersion" active ON active."id" = game."activeVersionId"
WHERE game."slug" = 'neon-reels'
ON CONFLICT ("gameId", "version", "configurationRevision") DO NOTHING;

UPDATE "Game"
SET
  "activeVersionId" = '4b213bec-69b5-4098-8f09-8ece1a81b405',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'neon-reels'
  AND EXISTS (SELECT 1 FROM "GameVersion" WHERE "id" = '4b213bec-69b5-4098-8f09-8ece1a81b405');
