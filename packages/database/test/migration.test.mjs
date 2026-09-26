import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const migrationUrl = new URL(
  "../prisma/migrations/20260825000000_identity_foundation/migration.sql",
  import.meta.url
);

test("Mines persistence is bounded, constrained, cascades with session cleanup, and launches disabled", async () => {
  const migration = await readFile(new URL("../prisma/migrations/20260903000000_neon_mines_foundation/migration.sql", import.meta.url), "utf8");
  assert.match(migration, /PRIMARY KEY \("gameSessionId"\)/u);
  assert.match(migration, /jsonb_typeof\("engineSnapshot"\) = 'object'/u);
  assert.match(migration, /GameSessionState_command_check/u);
  assert.match(migration, /GameSessionState_sequence_check/u);
  assert.match(migration, /GameSessionState_expiry_check/u);
  assert.match(migration, /REFERENCES "GameSession"\("id"\) ON DELETE CASCADE/u);
  assert.match(migration, /'neon-mines', 'Neon Mines', 'DISABLED'/u);
  assert.doesNotMatch(migration, /"status" = 'ACTIVE'/u);
});

test("identity migration retains database-enforced security invariants", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(migration, /Account_usernameNormalized_key/u);
  assert.match(migration, /Credential_argon2id_check/u);
  assert.match(migration, /AuthSession_token_hash_check/u);
  assert.match(migration, /AuthSession_revocation_check/u);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/u);
  assert.match(migration, /PLAYER account .* must have only a player profile/u);
  assert.match(migration, /ADMIN account .* must have only an admin profile/u);
});

test("administrator audit migration is append-only and relationally constrained", async () => {
  const migration = await readFile(new URL(
    "../prisma/migrations/20260825010000_admin_player_lifecycle/migration.sql",
    import.meta.url
  ), "utf8");

  assert.match(migration, /AdminAuditLog_adminId_fkey/u);
  assert.match(migration, /AdminAuditLog_targetId_fkey/u);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON "AdminAuditLog"/u);
  assert.match(migration, /AdminAuditLog records are immutable/u);
});

test("wallet migration enforces conservation, nonnegative balances, idempotency, and immutability", async () => {
  const migration = await readFile(new URL(
    "../prisma/migrations/20260825020000_wallet_ledger/migration.sql",
    import.meta.url
  ), "utf8");

  assert.match(migration, /Wallet_nonnegative_balance_check/u);
  assert.match(migration, /"balanceAfter" = "balanceBefore" \+ "amount"/u);
  assert.match(migration, /LedgerEntry_walletId_idempotencyKey_key/u);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON "LedgerEntry"/u);
  assert.match(migration, /must have only a player profile and one wallet/u);
});

test("game platform migration preserves exact versions and future session ownership", async () => {
  const migration = await readFile(new URL(
    "../prisma/migrations/20260825030000_game_platform_foundation/migration.sql",
    import.meta.url
  ), "utf8");
  assert.match(migration, /GameVersion_gameId_version_key/u);
  assert.match(migration, /GameSession_ownerAccountId_startIdempotencyKey_key/u);
  assert.match(migration, /GameSession_serverInstanceId_status_idx/u);
  assert.match(migration, /GameSession_version_snapshot/u);
  assert.match(migration, /Active game version must belong to the same game/u);
  assert.match(migration, /GameSessionParticipant_pkey/u);
  assert.match(migration, /Game session owner must be a participant/u);
  assert.match(migration, /Only PLAYER accounts may participate/u);
});

test("administrator operations use typed audit targets and immutable configuration revisions", async () => {
  const migration = await readFile(new URL("../prisma/migrations/20260825050000_admin_operations/migration.sql", import.meta.url), "utf8");
  assert.match(migration, /AdminAuditLog_target_check/u);
  assert.match(migration, /targetAccountId.*IS NOT NULL.*targetGameId.*IS NULL/us);
  assert.match(migration, /targetGameId.*IS NOT NULL.*targetAccountId.*IS NULL/us);
  assert.match(migration, /GameVersion_gameId_version_configurationRevision_key/u);
});

test("player activity migration records logout outcomes and indexes last login", async () => {
  const migration = await readFile(new URL("../prisma/migrations/20260826000000_player_login_activity/migration.sql", import.meta.url), "utf8");
  assert.match(migration, /LoginOutcome.*LOGOUT/u);
  assert.match(migration, /PlayerProfile.*lastLoginAt/us);
  assert.match(migration, /PlayerProfile_lastLoginAt_idx/u);
  const backfill = await readFile(new URL("../prisma/migrations/20260826001000_backfill_player_last_login/migration.sql", import.meta.url), "utf8");
  assert.match(backfill, /MAX\("createdAt"\).*"lastLoginAt"/u);
  assert.match(backfill, /outcome = 'SUCCESS'/u);
});

test("data cleanup migration keeps immutable records protected outside a recorded cleanup transaction", async () => {
  const migration = await readFile(new URL("../prisma/migrations/20260901000000_data_cleanup_foundation/migration.sql", import.meta.url), "utf8");
  assert.match(migration, /PLAYER_DELETE/u);
  assert.match(migration, /DATA_RETENTION_MANAGE/u);
  assert.match(migration, /DataCleanupRun_idempotencyKey_key/u);
  assert.match(migration, /current_setting\('app\.cleanup_run_id', true\)/u);
  assert.match(migration, /TG_OP = 'DELETE' AND data_cleanup_is_authorized\(\)/u);
  assert.match(migration, /AdminAuditLog records are immutable/u);
  assert.match(migration, /LedgerEntry records are immutable/u);
  assert.match(migration, /GameResult records are immutable/u);
});
