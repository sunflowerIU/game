import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabaseClient } from "@game-platform/database";
import type { NeonReelsSpin } from "@game-platform/neon-reels";
import { PrismaNeonReelsRepository } from "./prisma-neon-reels-repository.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test("a duplicated slot request creates one spin, one debit, and one reward", { skip: testDatabaseUrl === undefined }, async () => {
  const database = createDatabaseClient(testDatabaseUrl!); const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  try {
    const game = await database.game.upsert({ where: { slug: "neon-reels" }, update: { status: "ACTIVE" }, create: { slug: "neon-reels", name: "Neon Reels", gameType: "SINGLE_PLAYER", status: "ACTIVE" } });
    const denominations = [10, 50, 100, 500, 1_000, 2_000, 5_000];
    const version = await database.gameVersion.upsert({ where: { gameId_version_configurationRevision: { gameId: game.id, version: "1.0.0", configurationRevision: 1 } }, update: { minimumEntry: 10n, maximumEntry: 5_000n, configuration: { rows: 3, reels: 5, wagerDenominationsCents: denominations } }, create: { gameId: game.id, version: "1.0.0", configurationRevision: 1, minimumEntry: 10n, maximumEntry: 5_000n, configuration: { rows: 3, reels: 5, wagerDenominationsCents: denominations } } });
    await database.game.update({ where: { id: game.id }, data: { activeVersionId: version.id, status: "ACTIVE" } });
    const player = await database.account.create({ data: { username: `s${suffix}`, usernameNormalized: `s${suffix}`, type: "PLAYER", credential: { create: { passwordHash: "$argon2id$integration" } }, playerProfile: { create: {} }, wallet: { create: { balance: 1_000n } } } });
    const spin: NeonReelsSpin = { reels: Array.from({ length: 5 }, () => ["LEMON", "LEMON", "LEMON"] as const), winLines: [{ payline: 0, symbol: "LEMON", count: 5, multiplier: 2 }], scatterCount: 0, totalMultiplier: 2, reward: 20n };
    const repository = new PrismaNeonReelsRepository(database);
    const request = { playerId: player.id, gameId: game.id, entryAmount: 10n, idempotencyKey: `slot-${suffix}-00001`, serverInstanceId: "integration", occurredAt: new Date(), ipAddress: "127.0.0.1", resolve: () => spin };
    const results = await Promise.all([repository.playSpin(request), repository.playSpin(request)]);
    assert.equal(results[0].session.id, results[1].session.id);
    assert.equal(results[0].session.reward, 20n);
    assert.equal((await database.wallet.findUniqueOrThrow({ where: { accountId: player.id } })).balance, 1_010n);
    const wagerDebit = await database.ledgerEntry.findFirstOrThrow({ where: { referenceId: results[0].session.id, type: "GAME_ENTRY" } });
    assert.deepEqual({ amount: wagerDebit.amount, before: wagerDebit.balanceBefore, after: wagerDebit.balanceAfter }, { amount: -10n, before: 1_000n, after: 990n });
    assert.equal(await database.ledgerEntry.count({ where: { referenceId: results[0].session.id } }), 2);
    assert.equal(await database.gameResult.count({ where: { gameSessionId: results[0].session.id } }), 1);
    const distinct = await Promise.all([
      repository.playSpin({ ...request, idempotencyKey: `slot-${suffix}-00002` }),
      repository.playSpin({ ...request, idempotencyKey: `slot-${suffix}-00003` })
    ]);
    assert.notEqual(distinct[0].session.id, distinct[1].session.id);
    assert.equal((await database.wallet.findUniqueOrThrow({ where: { accountId: player.id } })).balance, 1_030n);
  } finally { await database.$disconnect(); }
});
