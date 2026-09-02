import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { createDatabaseClient } from "@game-platform/database";
import { config } from "dotenv";

import { PrismaPlayerAdminRepository } from "./prisma-player-admin-repository.js";

config({ path: "../../.env", quiet: true });

test("individual cleanup deletes related player data atomically and remains idempotent", {
  skip: process.env.RUN_DATABASE_INTEGRATION_TESTS !== "true"
}, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined) throw new Error("DATABASE_URL is required");
  const database = createDatabaseClient(databaseUrl);
  const suffix = randomBytes(5).toString("hex");
  const username = `cleanup_${suffix}`;
  let cleanupRunId: string | null = null;

  try {
    const [admin, game] = await Promise.all([
      database.account.findFirst({ where: { type: "ADMIN" }, select: { id: true } }),
      database.game.findFirst({
        where: { activeVersionId: { not: null } },
        select: { id: true, activeVersion: { select: { id: true, version: true } } }
      })
    ]);
    if (admin === null || game?.activeVersion === null || game?.activeVersion === undefined) {
      throw new Error("Seeded administrator and active game are required");
    }

    const player = await database.account.create({
      data: {
        username,
        usernameNormalized: username,
        type: "PLAYER",
        credential: { create: { passwordHash: "$argon2id$integration-test" } },
        playerProfile: { create: {} },
        wallet: { create: {} }
      },
      include: { wallet: true }
    });
    if (player.wallet === null) throw new Error("Test player wallet was not created");

    await database.$transaction(async (transaction) => {
      await transaction.wallet.update({ where: { id: player.wallet!.id }, data: { balance: 25n, version: { increment: 1 } } });
      await transaction.ledgerEntry.create({
        data: {
          walletId: player.wallet!.id,
          type: "ADMIN_DEPOSIT",
          amount: 25n,
          balanceBefore: 0n,
          balanceAfter: 25n,
          referenceType: "INTEGRATION_TEST",
          referenceId: player.id,
          idempotencyKey: `cleanup:${suffix}:ledger`,
          createdByType: "ADMIN",
          createdById: admin.id
        }
      });
    });
    await database.authSession.create({
      data: {
        accountId: player.id,
        tokenHash: randomBytes(32).toString("hex"),
        expiresAt: new Date(Date.now() + 60_000),
        ipAddress: "127.0.0.1"
      }
    });
    await database.loginEvent.create({
      data: { accountId: player.id, usernameNormalized: username, outcome: "SUCCESS", ipAddress: "127.0.0.1" }
    });
    const gameSession = await database.gameSession.create({
      data: {
        ownerAccountId: player.id,
        gameId: game.id,
        gameVersionId: game.activeVersion.id,
        gameVersion: game.activeVersion.version,
        status: "COMPLETED",
        startedAt: new Date(),
        completedAt: new Date(),
        entryAmount: 1n,
        startIdempotencyKey: `cleanup:${suffix}:session`,
        participants: { create: { accountId: player.id } },
        result: { create: { outcome: "COMPLETED", score: 0, reward: 0n, details: {} } }
      }
    });
    await database.securityEvent.create({
      data: { type: "INVALID_SESSION", severity: "INFO", accountId: player.id, gameSessionId: gameSession.id, ipAddress: "127.0.0.1" }
    });
    await database.adminAuditLog.create({
      data: {
        adminId: admin.id,
        action: "PLAYER_DISABLED",
        targetType: "ACCOUNT",
        targetAccountId: player.id,
        reason: "Integration cleanup test",
        ipAddress: "127.0.0.1"
      }
    });

    const repository = new PrismaPlayerAdminRepository(database);
    const preview = await repository.getPlayerDeletionPreview(player.id);
    assert.equal(preview?.balance, 25n);
    assert.equal(preview?.counts.ledgerEntries, 1);
    assert.equal(preview?.counts.gameResults, 1);

    const idempotencyKey = `cleanup:${suffix}:delete`;
    const result = await repository.deletePlayer({
      playerId: player.id,
      expectedUsernameNormalized: username,
      allowPositiveBalance: true,
      idempotencyKey,
      audit: { adminId: admin.id, reason: "Integration cleanup test", ipAddress: "127.0.0.1", userAgent: "test", occurredAt: new Date() }
    });
    if (result === null) throw new Error("Deletion unexpectedly returned no player");
    cleanupRunId = result.cleanupRunId;
    assert.equal(await database.account.findUnique({ where: { id: player.id } }), null);
    assert.equal(result.counts.authSessions, 1);
    assert.equal(result.counts.loginEvents, 1);
    assert.equal(result.counts.securityEvents, 1);

    const replay = await repository.deletePlayer({
      playerId: player.id,
      expectedUsernameNormalized: username,
      allowPositiveBalance: true,
      idempotencyKey,
      audit: { adminId: admin.id, reason: "Integration cleanup test", ipAddress: "127.0.0.1", userAgent: "test", occurredAt: new Date() }
    });
    assert.deepEqual(replay, result);
  } finally {
    if (cleanupRunId !== null) await database.dataCleanupRun.delete({ where: { id: cleanupRunId } });
    await database.$disconnect();
  }
});

test("retention cleanup deletes only eligible old records and preserves the player, balance, and recent history", {
  skip: process.env.RUN_DATABASE_INTEGRATION_TESTS !== "true"
}, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined) throw new Error("DATABASE_URL is required");
  const database = createDatabaseClient(databaseUrl);
  const suffix = randomBytes(5).toString("hex");
  const username = `retain_${suffix}`;
  const oldAt = new Date("2025-01-01T10:00:00.000Z");
  const asOf = new Date("2026-09-01T10:00:00.000Z");
  const cutoffAt = new Date("2026-08-02T10:00:00.000Z");
  const cleanupRunIds: string[] = [];
  let playerId: string | null = null;
  let adminId: string | null = null;

  try {
    const [admin, game] = await Promise.all([
      database.account.findFirst({ where: { type: "ADMIN" }, select: { id: true } }),
      database.game.findFirst({ where: { activeVersionId: { not: null } }, select: { id: true, activeVersion: { select: { id: true, version: true } } } })
    ]);
    if (admin === null || game?.activeVersion === null || game?.activeVersion === undefined) throw new Error("Seeded administrator and active game are required");
    adminId = admin.id;
    const player = await database.account.create({
      data: {
        username,
        usernameNormalized: username,
        type: "PLAYER",
        credential: { create: { passwordHash: "$argon2id$retention-integration-test" } },
        playerProfile: { create: {} },
        wallet: { create: { balance: 30n, version: 1 } }
      },
      include: { wallet: true }
    });
    playerId = player.id;
    if (player.wallet === null) throw new Error("Test player wallet was not created");

    await database.ledgerEntry.createMany({ data: [
      { id: randomUUID(), walletId: player.wallet.id, type: "ADMIN_DEPOSIT", amount: 10n, balanceBefore: 0n, balanceAfter: 10n, referenceType: "INTEGRATION_TEST", referenceId: player.id, idempotencyKey: `retention:${suffix}:old-ledger`, createdByType: "ADMIN", createdById: admin.id, createdAt: oldAt },
      { id: randomUUID(), walletId: player.wallet.id, type: "ADMIN_DEPOSIT", amount: 20n, balanceBefore: 10n, balanceAfter: 30n, referenceType: "INTEGRATION_TEST", referenceId: player.id, idempotencyKey: `retention:${suffix}:new-ledger`, createdByType: "ADMIN", createdById: admin.id, createdAt: asOf }
    ] });
    await database.authSession.createMany({ data: [
      { id: randomUUID(), accountId: player.id, tokenHash: randomBytes(32).toString("hex"), expiresAt: new Date("2025-01-02T10:00:00.000Z"), lastSeenAt: oldAt, ipAddress: "127.0.0.1", createdAt: oldAt },
      { id: randomUUID(), accountId: player.id, tokenHash: randomBytes(32).toString("hex"), expiresAt: new Date("2027-01-01T00:00:00.000Z"), lastSeenAt: asOf, ipAddress: "127.0.0.1", createdAt: asOf }
    ] });
    await database.loginEvent.createMany({ data: [
      { accountId: player.id, usernameNormalized: username, outcome: "SUCCESS", ipAddress: "127.0.0.1", createdAt: oldAt },
      { accountId: player.id, usernameNormalized: username, outcome: "SUCCESS", ipAddress: "127.0.0.1", createdAt: asOf }
    ] });
    const oldSession = await database.gameSession.create({ data: {
      ownerAccountId: player.id, gameId: game.id, gameVersionId: game.activeVersion.id, gameVersion: game.activeVersion.version,
      status: "COMPLETED", entryAmount: 1n, startIdempotencyKey: `retention:${suffix}:old-game`, createdAt: oldAt, startedAt: oldAt, completedAt: oldAt,
      participants: { create: { accountId: player.id, joinedAt: oldAt } }, result: { create: { outcome: "COMPLETED", score: 0, reward: 0n, details: {}, createdAt: oldAt } }
    } });
    await database.gameSession.create({ data: {
      ownerAccountId: player.id, gameId: game.id, gameVersionId: game.activeVersion.id, gameVersion: game.activeVersion.version,
      status: "COMPLETED", entryAmount: 1n, startIdempotencyKey: `retention:${suffix}:new-game`, createdAt: asOf, startedAt: asOf, completedAt: asOf,
      participants: { create: { accountId: player.id, joinedAt: asOf } }, result: { create: { outcome: "COMPLETED", score: 0, reward: 0n, details: {}, createdAt: asOf } }
    } });
    await database.securityEvent.createMany({ data: [
      { type: "INVALID_SESSION", severity: "INFO", accountId: player.id, gameSessionId: oldSession.id, ipAddress: "127.0.0.1", createdAt: oldAt },
      { type: "INVALID_SESSION", severity: "INFO", accountId: player.id, ipAddress: "127.0.0.1", createdAt: asOf }
    ] });
    await database.adminAuditLog.createMany({ data: [
      { adminId: admin.id, action: "PLAYER_DISABLED", targetType: "ACCOUNT", targetAccountId: player.id, reason: "Old integration audit", ipAddress: "127.0.0.1", createdAt: oldAt },
      { adminId: admin.id, action: "PLAYER_ENABLED", targetType: "ACCOUNT", targetAccountId: player.id, reason: "Recent integration audit", ipAddress: "127.0.0.1", createdAt: asOf }
    ] });

    const repository = new PrismaPlayerAdminRepository(database);
    const preview = await repository.getPlayerRecordCleanupPreview({ playerId: player.id, retentionDays: 30, cutoffAt, asOf });
    assert.equal(preview?.counts.ledgerEntries, 1);
    assert.equal(preview?.counts.ownedGameSessions, 1);
    assert.equal(preview?.counts.gameResults, 1);

    const result = await repository.deletePlayerRecords({
      playerId: player.id,
      retentionDays: 30,
      cutoffAt,
      idempotencyKey: `retention:${suffix}:cleanup`,
      audit: { adminId: admin.id, reason: "Remove old integration history", ipAddress: "127.0.0.1", userAgent: "test", occurredAt: asOf }
    });
    if (result === null) throw new Error("Record cleanup unexpectedly returned no player");
    cleanupRunIds.push(result.cleanupRunId);
    const replay = await repository.deletePlayerRecords({
      playerId: player.id,
      retentionDays: 30,
      cutoffAt,
      idempotencyKey: `retention:${suffix}:cleanup`,
      audit: { adminId: admin.id, reason: "Remove old integration history", ipAddress: "127.0.0.1", userAgent: "test", occurredAt: asOf }
    });
    assert.deepEqual(replay, result);
    await assert.rejects(repository.deletePlayerRecords({
      playerId: player.id,
      retentionDays: 60,
      cutoffAt: new Date("2025-12-02T10:00:00.000Z"),
      idempotencyKey: `retention:${suffix}:cleanup`,
      audit: { adminId: admin.id, reason: "Conflicting retention retry", ipAddress: "127.0.0.1", userAgent: "test", occurredAt: asOf }
    }), /different retention parameters/u);
    assert.equal((await database.account.findUnique({ where: { id: player.id }, include: { wallet: true } }))?.wallet?.balance, 30n);
    assert.equal(await database.ledgerEntry.count({ where: { walletId: player.wallet.id } }), 1);
    assert.equal(await database.authSession.count({ where: { accountId: player.id } }), 1);
    assert.equal(await database.loginEvent.count({ where: { accountId: player.id } }), 1);
    assert.equal(await database.gameSession.count({ where: { ownerAccountId: player.id } }), 1);
    assert.equal(await database.securityEvent.count({ where: { accountId: player.id } }), 1);
    assert.equal(await database.adminAuditLog.count({ where: { targetAccountId: player.id } }), 1);
  } finally {
    if (playerId !== null && adminId !== null && await database.account.findUnique({ where: { id: playerId }, select: { id: true } }) !== null) {
      const finalRun = await new PrismaPlayerAdminRepository(database).deletePlayer({
        playerId,
        expectedUsernameNormalized: username,
        allowPositiveBalance: true,
        idempotencyKey: `retention:${suffix}:finalize`,
        audit: { adminId, reason: "Remove retention integration fixture", ipAddress: "127.0.0.1", userAgent: "test", occurredAt: new Date() }
      });
      if (finalRun !== null) cleanupRunIds.push(finalRun.cleanupRunId);
    }
    if (cleanupRunIds.length > 0) await database.dataCleanupRun.deleteMany({ where: { id: { in: cleanupRunIds } } });
    await database.$disconnect();
  }
});

test("inactive-player cleanup excludes active sessions and positive balances, deletes bounded batches, and resumes safely", {
  skip: process.env.RUN_DATABASE_INTEGRATION_TESTS !== "true"
}, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined) throw new Error("DATABASE_URL is required");
  const database = createDatabaseClient(databaseUrl);
  const suffix = randomBytes(4).toString("hex");
  const oldAt = new Date("2025-01-01T10:00:00.000Z");
  const recentAt = new Date("2026-09-01T10:00:00.000Z");
  const cutoffAt = new Date("2025-06-01T10:00:00.000Z");
  const fixtures: { id: string; username: string }[] = [];
  const cleanupRunIds: string[] = [];
  let adminId: string | null = null;

  try {
    const [admin, game] = await Promise.all([
      database.account.findFirst({ where: { type: "ADMIN" }, select: { id: true } }),
      database.game.findFirst({ where: { activeVersionId: { not: null } }, select: { id: true, activeVersion: { select: { id: true, version: true } } } })
    ]);
    if (admin === null || game?.activeVersion === null || game?.activeVersion === undefined) throw new Error("Seeded administrator and active game are required");
    adminId = admin.id;
    const oldZeroA = await createCleanupPlayer(database, `bulk_a_${suffix}`, oldAt, oldAt, 0n);
    const oldPositive = await createCleanupPlayer(database, `bulk_b_${suffix}`, oldAt, oldAt, 25n);
    const oldActive = await createCleanupPlayer(database, `bulk_c_${suffix}`, oldAt, oldAt, 0n);
    const recent = await createCleanupPlayer(database, `bulk_d_${suffix}`, recentAt, recentAt, 0n);
    const neverLoggedIn = await createCleanupPlayer(database, `bulk_e_${suffix}`, oldAt, null, 0n);
    fixtures.push(oldZeroA, oldPositive, oldActive, recent, neverLoggedIn);
    await database.gameSession.create({ data: {
      ownerAccountId: oldActive.id,
      gameId: game.id,
      gameVersionId: game.activeVersion.id,
      gameVersion: game.activeVersion.version,
      status: "ACTIVE",
      entryAmount: 1n,
      startIdempotencyKey: `bulk:${suffix}:active-game`,
      startedAt: oldAt,
      participants: { create: { accountId: oldActive.id, joinedAt: oldAt } }
    } });

    const repository = new PrismaPlayerAdminRepository(database);
    const safePreview = await repository.getInactivePlayerCleanupPreview({ inactivityDays: 30, cutoffAt, includePositiveBalances: false });
    assert.equal(safePreview.inactivePlayers, 4);
    assert.equal(safePreview.activeSessionPlayers, 1);
    assert.equal(safePreview.positiveBalancePlayers, 1);
    assert.equal(safePreview.positiveBalanceTotal, 25n);
    assert.equal(safePreview.deletablePlayers, 2);

    const firstBatchInput = {
      inactivityDays: 30,
      cutoffAt,
      includePositiveBalances: false,
      batchSize: 1,
      idempotencyKey: `bulk:${suffix}:safe-batch-1`,
      audit: { adminId: admin.id, reason: "Delete safe inactive fixture batch", ipAddress: "127.0.0.1", userAgent: "test", occurredAt: recentAt }
    } as const;
    const [first, concurrentReplay] = await Promise.all([
      repository.deleteInactivePlayerBatch(firstBatchInput),
      repository.deleteInactivePlayerBatch(firstBatchInput)
    ]);
    cleanupRunIds.push(first.cleanupRunId);
    assert.equal(first.deletedPlayers, 1);
    assert.equal(first.remainingPlayers, 1);
    assert.deepEqual(concurrentReplay, first);
    const replay = await repository.deleteInactivePlayerBatch({
      inactivityDays: 30,
      cutoffAt,
      includePositiveBalances: false,
      batchSize: 1,
      idempotencyKey: `bulk:${suffix}:safe-batch-1`,
      audit: { adminId: admin.id, reason: "Delete safe inactive fixture batch", ipAddress: "127.0.0.1", userAgent: "test", occurredAt: recentAt }
    });
    assert.deepEqual(replay, first);

    const second = await repository.deleteInactivePlayerBatch({
      inactivityDays: 30,
      cutoffAt,
      includePositiveBalances: false,
      batchSize: 100,
      idempotencyKey: `bulk:${suffix}:safe-batch-2`,
      audit: { adminId: admin.id, reason: "Delete remaining safe inactive fixtures", ipAddress: "127.0.0.1", userAgent: "test", occurredAt: recentAt }
    });
    cleanupRunIds.push(second.cleanupRunId);
    assert.equal(second.deletedPlayers, 1);
    assert.equal(second.remainingPlayers, 0);
    assert.notEqual(await database.account.findUnique({ where: { id: oldPositive.id } }), null);
    assert.notEqual(await database.account.findUnique({ where: { id: oldActive.id } }), null);
    assert.notEqual(await database.account.findUnique({ where: { id: recent.id } }), null);

    const positiveBatch = await repository.deleteInactivePlayerBatch({
      inactivityDays: 30,
      cutoffAt,
      includePositiveBalances: true,
      batchSize: 100,
      idempotencyKey: `bulk:${suffix}:positive-batch`,
      audit: { adminId: admin.id, reason: "Explicitly delete positive inactive fixture", ipAddress: "127.0.0.1", userAgent: "test", occurredAt: recentAt }
    });
    cleanupRunIds.push(positiveBatch.cleanupRunId);
    assert.equal(positiveBatch.deletedPlayers, 1);
    assert.equal(positiveBatch.deletedBalance, 25n);
    assert.equal(positiveBatch.remainingPlayers, 0);
    assert.equal(await database.account.findUnique({ where: { id: oldPositive.id } }), null);
    assert.notEqual(await database.account.findUnique({ where: { id: oldActive.id } }), null);
  } finally {
    if (adminId !== null) {
      const repository = new PrismaPlayerAdminRepository(database);
      for (const fixture of fixtures) {
        if (await database.account.findUnique({ where: { id: fixture.id }, select: { id: true } }) === null) continue;
        const finalRun = await repository.deletePlayer({
          playerId: fixture.id,
          expectedUsernameNormalized: fixture.username,
          allowPositiveBalance: true,
          idempotencyKey: `bulk:${suffix}:final:${fixture.id}`,
          audit: { adminId, reason: "Remove bulk cleanup integration fixture", ipAddress: "127.0.0.1", userAgent: "test", occurredAt: new Date() }
        });
        if (finalRun !== null) cleanupRunIds.push(finalRun.cleanupRunId);
      }
    }
    if (cleanupRunIds.length > 0) await database.dataCleanupRun.deleteMany({ where: { id: { in: cleanupRunIds } } });
    await database.$disconnect();
  }
});

async function createCleanupPlayer(database: ReturnType<typeof createDatabaseClient>, username: string, createdAt: Date, lastLoginAt: Date | null, balance: bigint): Promise<{ id: string; username: string }> {
  const player = await database.account.create({ data: {
    username,
    usernameNormalized: username,
    type: "PLAYER",
    createdAt,
    credential: { create: { passwordHash: "$argon2id$bulk-cleanup-integration-test", passwordChangedAt: createdAt } },
    playerProfile: { create: { lastLoginAt } },
    wallet: { create: { balance, version: balance > 0n ? 1 : 0, createdAt } }
  }, select: { id: true, usernameNormalized: true } });
  return { id: player.id, username: player.usernameNormalized };
}
