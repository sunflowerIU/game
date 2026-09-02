CREATE TYPE "GameStatus" AS ENUM ('ACTIVE', 'DISABLED', 'MAINTENANCE', 'DEPRECATED');
CREATE TYPE "GameType" AS ENUM ('SINGLE_PLAYER', 'MULTIPLAYER');
CREATE TYPE "GameSessionStatus" AS ENUM ('CREATED', 'ACTIVE', 'COMPLETED', 'ABANDONED', 'FAILED');

CREATE TABLE "Game" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "status" "GameStatus" NOT NULL DEFAULT 'DISABLED',
    "gameType" "GameType" NOT NULL,
    "activeVersionId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Game_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Game_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

CREATE TABLE "GameVersion" (
    "id" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "version" VARCHAR(32) NOT NULL,
    "minimumEntry" BIGINT NOT NULL DEFAULT 0,
    "maximumEntry" BIGINT NOT NULL DEFAULT 0,
    "configuration" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GameVersion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GameVersion_semver_check" CHECK ("version" ~ '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$'),
    CONSTRAINT "GameVersion_entry_range_check" CHECK ("minimumEntry" >= 0 AND "maximumEntry" >= "minimumEntry")
);

CREATE TABLE "GameSession" (
    "id" UUID NOT NULL,
    "ownerAccountId" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "gameVersionId" UUID NOT NULL,
    "gameVersion" VARCHAR(32) NOT NULL,
    "status" "GameSessionStatus" NOT NULL DEFAULT 'CREATED',
    "entryAmount" BIGINT NOT NULL,
    "startIdempotencyKey" VARCHAR(100) NOT NULL,
    "serverInstanceId" VARCHAR(100),
    "stateVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    CONSTRAINT "GameSession_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GameSession_entry_check" CHECK ("entryAmount" >= 0),
    CONSTRAINT "GameSession_state_version_check" CHECK ("stateVersion" >= 0),
    CONSTRAINT "GameSession_idempotency_check" CHECK ("startIdempotencyKey" ~ '^[A-Za-z0-9._:-]{16,100}$'),
    CONSTRAINT "GameSession_lifecycle_check" CHECK (
      ("status" = 'CREATED' AND "startedAt" IS NULL AND "completedAt" IS NULL)
      OR ("status" = 'ACTIVE' AND "startedAt" IS NOT NULL AND "completedAt" IS NULL)
      OR ("status" IN ('COMPLETED', 'ABANDONED', 'FAILED') AND "startedAt" IS NOT NULL AND "completedAt" IS NOT NULL)
    )
);

CREATE TABLE "GameSessionParticipant" (
    "gameSessionId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GameSessionParticipant_pkey" PRIMARY KEY ("gameSessionId", "accountId")
);

CREATE UNIQUE INDEX "Game_slug_key" ON "Game"("slug");
CREATE UNIQUE INDEX "Game_activeVersionId_key" ON "Game"("activeVersionId");
CREATE UNIQUE INDEX "GameVersion_gameId_version_key" ON "GameVersion"("gameId", "version");
CREATE INDEX "GameVersion_gameId_createdAt_idx" ON "GameVersion"("gameId", "createdAt");
CREATE UNIQUE INDEX "GameSession_ownerAccountId_startIdempotencyKey_key" ON "GameSession"("ownerAccountId", "startIdempotencyKey");
CREATE INDEX "GameSession_ownerAccountId_createdAt_idx" ON "GameSession"("ownerAccountId", "createdAt");
CREATE INDEX "GameSession_gameId_status_createdAt_idx" ON "GameSession"("gameId", "status", "createdAt");
CREATE INDEX "GameSession_serverInstanceId_status_idx" ON "GameSession"("serverInstanceId", "status");
CREATE INDEX "GameSessionParticipant_accountId_joinedAt_idx" ON "GameSessionParticipant"("accountId", "joinedAt");

ALTER TABLE "GameVersion" ADD CONSTRAINT "GameVersion_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Game" ADD CONSTRAINT "Game_activeVersionId_fkey" FOREIGN KEY ("activeVersionId") REFERENCES "GameVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_ownerAccountId_fkey" FOREIGN KEY ("ownerAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_gameVersionId_fkey" FOREIGN KEY ("gameVersionId") REFERENCES "GameVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GameSessionParticipant" ADD CONSTRAINT "GameSessionParticipant_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameSessionParticipant" ADD CONSTRAINT "GameSessionParticipant_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION enforce_game_active_version() RETURNS trigger AS $$
BEGIN
  IF NEW."activeVersionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "GameVersion" WHERE "id" = NEW."activeVersionId" AND "gameId" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'Active game version must belong to the same game';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "Game_active_version_ownership"
AFTER INSERT OR UPDATE OF "activeVersionId" ON "Game"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_game_active_version();

CREATE FUNCTION enforce_game_session_version() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "GameVersion" WHERE "id" = NEW."gameVersionId" AND "gameId" = NEW."gameId" AND "version" = NEW."gameVersion"
  ) THEN
    RAISE EXCEPTION 'Game session version snapshot does not match its game version';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "GameSession_version_snapshot"
AFTER INSERT OR UPDATE OF "gameId", "gameVersionId", "gameVersion" ON "GameSession"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_game_session_version();

CREATE FUNCTION enforce_game_session_participants() RETURNS trigger AS $$
DECLARE
  target_session_id UUID;
  owner_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'GameSession' THEN
    IF TG_OP = 'DELETE' THEN target_session_id := OLD."id"; ELSE target_session_id := NEW."id"; END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN target_session_id := OLD."gameSessionId"; ELSE target_session_id := NEW."gameSessionId"; END IF;
  END IF;
  SELECT "ownerAccountId" INTO owner_id FROM "GameSession" WHERE "id" = target_session_id;
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "GameSessionParticipant" WHERE "gameSessionId" = target_session_id AND "accountId" = owner_id) THEN
    RAISE EXCEPTION 'Game session owner must be a participant';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "GameSessionParticipant" participant
    JOIN "Account" account ON account."id" = participant."accountId"
    WHERE participant."gameSessionId" = target_session_id AND account."type" <> 'PLAYER'
  ) THEN
    RAISE EXCEPTION 'Only PLAYER accounts may participate in game sessions';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "GameSession_participant_shape"
AFTER INSERT OR UPDATE OR DELETE ON "GameSession"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_game_session_participants();

CREATE CONSTRAINT TRIGGER "GameSessionParticipant_shape"
AFTER INSERT OR UPDATE OR DELETE ON "GameSessionParticipant"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_game_session_participants();
