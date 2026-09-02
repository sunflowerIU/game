UPDATE "PlayerProfile" AS profile
SET "lastLoginAt" = latest."lastLoginAt"
FROM (
  SELECT "accountId", MAX("createdAt") AS "lastLoginAt"
  FROM "LoginEvent"
  WHERE outcome = 'SUCCESS' AND "accountId" IS NOT NULL
  GROUP BY "accountId"
) AS latest
WHERE profile."accountId" = latest."accountId";
