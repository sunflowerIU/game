-- Activate an immutable Neon Reels configuration revision with the operator's
-- exact fixed wager choices: 0.10, 0.50 and 1.00 coin (10/50/100 cents).
INSERT INTO "GameVersion" (
  "id", "gameId", "version", "configurationRevision",
  "minimumEntry", "maximumEntry", "configuration", "createdAt"
)
SELECT
  '39ac97cd-e387-43f1-87d1-edf51731c19a',
  game."id",
  active."version",
  active."configurationRevision" + 1,
  10,
  100,
  (active."configuration" - 'wagerStepCents') || '{"wagerDenominationsCents":[10,50,100]}'::jsonb,
  CURRENT_TIMESTAMP
FROM "Game" game
JOIN "GameVersion" active ON active."id" = game."activeVersionId"
WHERE game."slug" = 'neon-reels'
ON CONFLICT ("gameId", "version", "configurationRevision") DO NOTHING;

UPDATE "Game"
SET
  "activeVersionId" = '39ac97cd-e387-43f1-87d1-edf51731c19a',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'neon-reels'
  AND EXISTS (SELECT 1 FROM "GameVersion" WHERE "id" = '39ac97cd-e387-43f1-87d1-edf51731c19a');
