import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabaseClient } from "@game-platform/database";
import { WalletError } from "@game-platform/wallet";
import { PrismaWalletRepository } from "./prisma-wallet-repository.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test("row locking prevents concurrent debits from overdrawing a wallet", { skip: testDatabaseUrl === undefined }, async () => {
  const database = createDatabaseClient(testDatabaseUrl!);
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const passwordHash = "$argon2id$v=19$m=65536,t=3,p=1$integration$integration";
  try {
    const admin = await database.account.create({ data: {
      username: `a${suffix}`, usernameNormalized: `a${suffix}`, type: "ADMIN",
      credential: { create: { passwordHash } }, adminProfile: { create: {} }
    } });
    const player = await database.account.create({ data: {
      username: `p${suffix}`, usernameNormalized: `p${suffix}`, type: "PLAYER",
      credential: { create: { passwordHash } }, playerProfile: { create: {} }, wallet: { create: {} }
    } });
    const repository = new PrismaWalletRepository(database);
    const common = { playerId: player.id, reason: "Concurrency test", adminId: admin.id, ipAddress: "127.0.0.1", userAgent: "integration", occurredAt: new Date() };
    await repository.applyAdminAdjustment({ ...common, signedAmount: 100n, type: "ADMIN_DEPOSIT", idempotencyKey: `credit-${suffix}-0001` });

    const results = await Promise.allSettled([
      repository.applyAdminAdjustment({ ...common, signedAmount: -80n, type: "ADMIN_DEBIT", idempotencyKey: `debit-${suffix}-00001` }),
      repository.applyAdminAdjustment({ ...common, signedAmount: -80n, type: "ADMIN_DEBIT", idempotencyKey: `debit-${suffix}-00002` })
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejection = results.find((result) => result.status === "rejected");
    assert.ok(rejection?.status === "rejected" && rejection.reason instanceof WalletError && rejection.reason.code === "INSUFFICIENT_BALANCE");
    assert.equal((await repository.findWallet(player.id))?.balance, 20n);
  } finally {
    await database.$disconnect();
  }
});
