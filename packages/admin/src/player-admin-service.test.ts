import assert from "node:assert/strict";
import { test } from "node:test";
import type { PasswordHasher } from "@game-platform/auth";
import { PlayerAdminError, PlayerAdminService, type AdminAuditRecord, type InactivePlayerCleanupPreview, type InactivePlayerCleanupResult, type PlayerAdminRepository, type PlayerDeletionPreview, type PlayerDeletionResult, type PlayerRecord, type PlayerRecordCleanupPreview, type PlayerRecordCleanupResult } from "./player-admin-service.js";

const now = new Date("2026-08-25T10:00:00.000Z");
const player: PlayerRecord = { id: "player-1", username: "PlayerOne", status: "ACTIVE", balance: 0n, lastLoginAt: null, createdAt: now, updatedAt: now };
const hasher: PasswordHasher = { hash: async (value) => `argon:${value}`, verify: async () => true };

class FakeRepository implements PlayerAdminRepository {
  public lastCreate: Parameters<PlayerAdminRepository["createPlayer"]>[0] | null = null;
  public lastStatus: Parameters<PlayerAdminRepository["setPlayerStatus"]>[0] | null = null;
  public lastReset: Parameters<PlayerAdminRepository["resetPlayerPassword"]>[0] | null = null;
  public lastDelete: Parameters<PlayerAdminRepository["deletePlayer"]>[0] | null = null;
  public lastRecordCleanup: Parameters<PlayerAdminRepository["deletePlayerRecords"]>[0] | null = null;
  public lastInactiveCleanup: Parameters<PlayerAdminRepository["deleteInactivePlayerBatch"]>[0] | null = null;
  public async listPlayers(): Promise<readonly PlayerRecord[]> { return [player]; }
  public async listAuditLogs(): Promise<readonly AdminAuditRecord[]> { return []; }
  public async createPlayer(input: Parameters<PlayerAdminRepository["createPlayer"]>[0]): Promise<PlayerRecord> { this.lastCreate = input; return player; }
  public async setPlayerStatus(input: Parameters<PlayerAdminRepository["setPlayerStatus"]>[0]): Promise<PlayerRecord | null> { this.lastStatus = input; return player; }
  public async resetPlayerPassword(input: Parameters<PlayerAdminRepository["resetPlayerPassword"]>[0]): Promise<PlayerRecord | null> { this.lastReset = input; return player; }
  public async getPlayerDeletionPreview(): Promise<PlayerDeletionPreview | null> { return deletionPreview; }
  public async deletePlayer(input: Parameters<PlayerAdminRepository["deletePlayer"]>[0]): Promise<PlayerDeletionResult | null> { this.lastDelete = input; return deletionResult; }
  public async getPlayerRecordCleanupPreview(input: Parameters<PlayerAdminRepository["getPlayerRecordCleanupPreview"]>[0]): Promise<PlayerRecordCleanupPreview | null> { return { playerId: player.id, username: player.username, retentionDays: input.retentionDays, cutoffAt: input.cutoffAt, counts: deletionCounts }; }
  public async deletePlayerRecords(input: Parameters<PlayerAdminRepository["deletePlayerRecords"]>[0]): Promise<PlayerRecordCleanupResult | null> { this.lastRecordCleanup = input; return { cleanupRunId: "run-2", playerId: player.id, username: player.username, retentionDays: input.retentionDays, cutoffAt: input.cutoffAt, counts: deletionCounts }; }
  public async getInactivePlayerCleanupPreview(input: Parameters<PlayerAdminRepository["getInactivePlayerCleanupPreview"]>[0]): Promise<InactivePlayerCleanupPreview> { return { ...input, inactivePlayers: 5, activeSessionPlayers: 1, positiveBalancePlayers: 2, positiveBalanceTotal: 50n, deletablePlayers: input.includePositiveBalances ? 4 : 2 }; }
  public async deleteInactivePlayerBatch(input: Parameters<PlayerAdminRepository["deleteInactivePlayerBatch"]>[0]): Promise<InactivePlayerCleanupResult> { this.lastInactiveCleanup = input; return { cleanupRunId: "run-3", inactivityDays: input.inactivityDays, cutoffAt: input.cutoffAt, includePositiveBalances: input.includePositiveBalances, batchSize: input.batchSize, deletedPlayers: 2, deletedBalance: 0n, deletedRecords: deletionCounts, remainingPlayers: 0 }; }
}

const deletionCounts = { authSessions: 1, loginEvents: 2, securityEvents: 3, ownedGameSessions: 4, gameParticipations: 4, gameResults: 4, ledgerEntries: 5, adminAuditLogs: 6 };
const deletionPreview: PlayerDeletionPreview = { playerId: player.id, username: player.username, status: player.status, balance: 25n, activeGameSessions: 0, counts: deletionCounts };
const deletionResult: PlayerDeletionResult = { cleanupRunId: "run-1", playerId: player.id, username: player.username, balanceDeleted: 25n, counts: deletionCounts };
const admin = { accountId: "admin-1", type: "ADMIN" as const, permissions: new Set(["PLAYER_VIEW", "PLAYER_CREATE", "PLAYER_DISABLE", "PLAYER_DELETE", "PLAYER_PASSWORD_RESET", "DATA_RETENTION_MANAGE", "SECURITY_VIEW"]) };
const nonAdmin = { accountId: "player-1", type: "PLAYER" as const, permissions: new Set<string>() };

test("creation hashes the password and attaches administrator audit context", async () => {
  const repository = new FakeRepository();
  await new PlayerAdminService(repository, hasher, { now: () => now }).createPlayer(admin, {
    username: " PlayerOne ", password: "long-enough-password", reason: "New player", ipAddress: "127.0.0.1", userAgent: "test"
  });
  assert.equal(repository.lastCreate?.usernameNormalized, "playerone");
  assert.equal(repository.lastCreate?.passwordHash, "argon:long-enough-password");
  assert.equal(repository.lastCreate?.audit.adminId, "admin-1");
});

test("players cannot call administrator operations", async () => {
  await assert.rejects(new PlayerAdminService(new FakeRepository(), hasher).listPlayers(nonAdmin),
    (error: unknown) => error instanceof PlayerAdminError && error.code === "ACCESS_DENIED");
});

test("disable carries target state and mandatory reason", async () => {
  const repository = new FakeRepository();
  await new PlayerAdminService(repository, hasher, { now: () => now }).setPlayerEnabled(admin, {
    playerId: "player-1", enabled: false, reason: "Fraud review", ipAddress: "127.0.0.1", userAgent: null
  });
  assert.equal(repository.lastStatus?.status, "DISABLED");
  assert.equal(repository.lastStatus?.audit.reason, "Fraud review");
});

test("password reset never passes plaintext to the repository", async () => {
  const repository = new FakeRepository();
  await new PlayerAdminService(repository, hasher, { now: () => now }).resetPassword(admin, {
    playerId: "player-1", password: "replacement-password", reason: "Requested reset", ipAddress: "127.0.0.1", userAgent: null
  });
  assert.equal(repository.lastReset?.passwordHash, "argon:replacement-password");
  assert.equal("password" in (repository.lastReset ?? {}), false);
});

test("passwords require at least eight characters", async () => {
  const service = new PlayerAdminService(new FakeRepository(), hasher);
  await assert.doesNotReject(service.resetPassword(admin, {
    playerId: "player-1", password: "12345678", reason: "Requested reset", ipAddress: "127.0.0.1", userAgent: null
  }));
  await assert.rejects(service.resetPassword(admin, {
    playerId: "player-1", password: "1234567", reason: "Requested reset", ipAddress: "127.0.0.1", userAgent: null
  }), (error: unknown) => error instanceof PlayerAdminError && error.code === "INVALID_REQUEST");
});

test("player deletion requires its dedicated permission", async () => {
  const withoutDelete = { ...admin, permissions: new Set(["PLAYER_VIEW"]) };
  await assert.rejects(new PlayerAdminService(new FakeRepository(), hasher).previewPlayerDeletion(withoutDelete, { playerId: player.id }),
    (error: unknown) => error instanceof PlayerAdminError && error.code === "ACCESS_DENIED");
});

test("player deletion passes normalized confirmation, explicit balance approval, idempotency, and audit context", async () => {
  const repository = new FakeRepository();
  const result = await new PlayerAdminService(repository, hasher, { now: () => now }).deletePlayer(admin, {
    playerId: player.id,
    confirmationUsername: " playerONE ",
    allowPositiveBalance: true,
    idempotencyKey: "player-delete:test:0001",
    reason: "Player requested deletion",
    ipAddress: "127.0.0.1",
    userAgent: "test"
  });
  assert.equal(repository.lastDelete?.expectedUsernameNormalized, "playerone");
  assert.equal(repository.lastDelete?.allowPositiveBalance, true);
  assert.equal(repository.lastDelete?.audit.adminId, "admin-1");
  assert.equal(result.cleanupRunId, "run-1");
});

test("player deletion rejects weak idempotency keys before touching the repository", async () => {
  const repository = new FakeRepository();
  await assert.rejects(new PlayerAdminService(repository, hasher).deletePlayer(admin, {
    playerId: player.id,
    confirmationUsername: player.username,
    allowPositiveBalance: false,
    idempotencyKey: "short",
    reason: "Player requested deletion",
    ipAddress: "127.0.0.1",
    userAgent: null
  }), (error: unknown) => error instanceof PlayerAdminError && error.code === "INVALID_REQUEST");
  assert.equal(repository.lastDelete, null);
});

test("record cleanup calculates the cutoff and requires the retention permission", async () => {
  const repository = new FakeRepository();
  const service = new PlayerAdminService(repository, hasher, { now: () => now });
  const preview = await service.previewPlayerRecordCleanup(admin, { playerId: player.id, retentionDays: 30 });
  assert.equal(preview.cutoffAt.toISOString(), "2026-07-26T10:00:00.000Z");
  await assert.rejects(service.previewPlayerRecordCleanup({ ...admin, permissions: new Set(["PLAYER_VIEW"]) }, { playerId: player.id, retentionDays: 30 }),
    (error: unknown) => error instanceof PlayerAdminError && error.code === "ACCESS_DENIED");
});

test("record cleanup validates days and forwards an immutable cutoff with audit context", async () => {
  const repository = new FakeRepository();
  const service = new PlayerAdminService(repository, hasher, { now: () => now });
  await service.deletePlayerRecords(admin, {
    playerId: player.id,
    retentionDays: 20,
    idempotencyKey: "records-delete:test:01",
    reason: "Remove expired player history",
    ipAddress: "127.0.0.1",
    userAgent: null
  });
  assert.equal(repository.lastRecordCleanup?.cutoffAt.toISOString(), "2026-08-05T10:00:00.000Z");
  assert.equal(repository.lastRecordCleanup?.audit.adminId, admin.accountId);
  await assert.rejects(service.previewPlayerRecordCleanup(admin, { playerId: player.id, retentionDays: 0 }),
    (error: unknown) => error instanceof PlayerAdminError && error.code === "INVALID_REQUEST");
});

test("inactive-player preview uses last-activity cutoff and explicit positive-balance policy", async () => {
  const preview = await new PlayerAdminService(new FakeRepository(), hasher, { now: () => now }).previewInactivePlayerCleanup(admin, { inactivityDays: 30, includePositiveBalances: false });
  assert.equal(preview.cutoffAt.toISOString(), "2026-07-26T10:00:00.000Z");
  assert.equal(preview.deletablePlayers, 2);
  assert.equal(preview.positiveBalancePlayers, 2);
});

test("inactive-player deletion validates batch size and forwards a bounded idempotent batch", async () => {
  const repository = new FakeRepository();
  const service = new PlayerAdminService(repository, hasher, { now: () => now });
  await service.deleteInactivePlayerBatch(admin, {
    inactivityDays: 30,
    includePositiveBalances: true,
    batchSize: 50,
    idempotencyKey: "inactive-delete:test:01",
    reason: "Remove inactive test players",
    ipAddress: "127.0.0.1",
    userAgent: null
  });
  assert.equal(repository.lastInactiveCleanup?.batchSize, 50);
  assert.equal(repository.lastInactiveCleanup?.includePositiveBalances, true);
  await assert.rejects(service.deleteInactivePlayerBatch(admin, {
    inactivityDays: 30,
    includePositiveBalances: false,
    batchSize: 101,
    idempotencyKey: "inactive-delete:test:02",
    reason: "Remove inactive test players",
    ipAddress: "127.0.0.1",
    userAgent: null
  }), (error: unknown) => error instanceof PlayerAdminError && error.code === "INVALID_REQUEST");
});
