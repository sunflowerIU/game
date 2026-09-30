-- Switch new Neon Mines rounds to completion-only rewards. Existing sessions
-- retain their immutable prior configuration revision.
INSERT INTO "GameVersion" ("id", "gameId", "version", "configurationRevision", "minimumEntry", "maximumEntry", "configuration", "createdAt")
SELECT
  '8f59bdb1-8fa6-4b09-bba8-ec122f54a873', game."id", active."version", active."configurationRevision" + 1, 10, 2000,
  '{"boardTiles":9,"completionOnly":true,"wagerDenominationsCents":[10,25,50,100,200,500,1000,2000,5000],"difficulties":{"EASY":{"mines":2,"maximumWagerCents":1000,"rewardMultiplier":2},"MEDIUM":{"mines":3,"maximumWagerCents":2000,"rewardMultiplier":3},"HARD":{"mines":4,"maximumWagerCents":2000,"rewardMultiplier":4}}}'::jsonb,
  CURRENT_TIMESTAMP
FROM "Game" game
JOIN "GameVersion" active ON active."id" = game."activeVersionId"
WHERE game."slug" = 'neon-mines'
ON CONFLICT ("gameId", "version", "configurationRevision") DO NOTHING;

UPDATE "Game"
SET "activeVersionId" = '8f59bdb1-8fa6-4b09-bba8-ec122f54a873', "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'neon-mines'
  AND EXISTS (SELECT 1 FROM "GameVersion" WHERE "id" = '8f59bdb1-8fa6-4b09-bba8-ec122f54a873');
