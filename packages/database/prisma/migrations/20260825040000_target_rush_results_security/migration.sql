CREATE TYPE "GameResultOutcome" AS ENUM ('COMPLETED', 'ABANDONED', 'FAILED');
CREATE TYPE "SecuritySeverity" AS ENUM ('INFO', 'WARNING', 'HIGH', 'CRITICAL');
CREATE TYPE "SecurityEventType" AS ENUM ('IMPOSSIBLE_INPUT_RATE', 'REPLAYED_SEQUENCE', 'INVALID_SESSION', 'INVALID_GAME_INPUT', 'SESSION_RECOVERED');

CREATE TABLE "GameResult" (
    "id" UUID NOT NULL,
    "gameSessionId" UUID NOT NULL,
    "outcome" "GameResultOutcome" NOT NULL,
    "score" INTEGER NOT NULL,
    "reward" BIGINT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GameResult_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GameResult_score_check" CHECK ("score" >= 0),
    CONSTRAINT "GameResult_reward_check" CHECK ("reward" >= 0)
);

CREATE TABLE "SecurityEvent" (
    "id" BIGSERIAL NOT NULL,
    "type" "SecurityEventType" NOT NULL,
    "severity" "SecuritySeverity" NOT NULL,
    "accountId" UUID,
    "gameSessionId" UUID,
    "ipAddress" VARCHAR(45) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GameResult_gameSessionId_key" ON "GameResult"("gameSessionId");
CREATE INDEX "SecurityEvent_accountId_createdAt_idx" ON "SecurityEvent"("accountId", "createdAt");
CREATE INDEX "SecurityEvent_gameSessionId_createdAt_idx" ON "SecurityEvent"("gameSessionId", "createdAt");
CREATE INDEX "SecurityEvent_type_createdAt_idx" ON "SecurityEvent"("type", "createdAt");
CREATE INDEX "SecurityEvent_severity_createdAt_idx" ON "SecurityEvent"("severity", "createdAt");
CREATE UNIQUE INDEX "GameSession_one_active_per_owner" ON "GameSession"("ownerAccountId") WHERE "status" IN ('CREATED', 'ACTIVE');

ALTER TABLE "GameResult" ADD CONSTRAINT "GameResult_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE FUNCTION prevent_game_result_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'GameResult records are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GameResult_immutable"
BEFORE UPDATE OR DELETE ON "GameResult"
FOR EACH ROW EXECUTE FUNCTION prevent_game_result_mutation();

CREATE FUNCTION enforce_game_session_transition() RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('COMPLETED', 'ABANDONED', 'FAILED') THEN
    RAISE EXCEPTION 'Terminal game sessions are immutable';
  END IF;
  IF NEW."stateVersion" <> OLD."stateVersion" + 1 THEN
    RAISE EXCEPTION 'Game session state version must increment exactly once';
  END IF;
  IF OLD."status" = 'CREATED' AND NEW."status" NOT IN ('ACTIVE', 'FAILED') THEN
    RAISE EXCEPTION 'Invalid game session transition';
  END IF;
  IF OLD."status" = 'ACTIVE' AND NEW."status" NOT IN ('ACTIVE', 'COMPLETED', 'ABANDONED', 'FAILED') THEN
    RAISE EXCEPTION 'Invalid game session transition';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GameSession_valid_transition"
BEFORE UPDATE ON "GameSession"
FOR EACH ROW EXECUTE FUNCTION enforce_game_session_transition();
