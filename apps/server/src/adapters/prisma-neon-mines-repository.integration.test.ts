import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabaseClient } from "@game-platform/database";
import { PrismaNeonMinesRepository, NeonMinesError } from "./prisma-neon-mines-repository.js";
import { PrismaWalletRepository } from "./prisma-wallet-repository.js";

const url = process.env.TEST_DATABASE_URL;
test("Mines durable transactions, recovery, and retry invariants", { skip: url === undefined }, async (t) => {
  assert.match(new URL(url!).pathname, /^\/neon_mines_section4_/u, "Use a disposable Mines test database");
  const db = createDatabaseClient(url!);
  const random = { integer: (minimum: number) => minimum };
  const game = await db.game.findUniqueOrThrow({ where: { slug: "neon-mines" } });
  const repo = new PrismaNeonMinesRepository(db, () => new Date(), random);
  async function player(balance = 1000n) {
    const name = `m${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    return db.account.create({ data: { username: name, usernameNormalized: name, type: "PLAYER", credential: { create: { passwordHash: "$argon2id$test" } }, playerProfile: { create: {} }, wallet: { create: { balance } } } });
  }
  function startInput(playerId: string) { return { playerId, gameId: game.id, entryAmount: 100n, difficulty: "EASY" as const, idempotencyKey: crypto.randomUUID() }; }
  function command(sequence: number, tile?: number) { return { commandId: crypto.randomUUID(), sequence, payload: tile === undefined ? { action: "CASH_OUT" as const } : { action: "SELECT_TILE" as const, tile } }; }
  const errorCode = (code: string) => (error: unknown) => error instanceof NeonMinesError && error.code === code;
  try {
    await t.test("disabled launch, denomination checks, and parallel start idempotency", async () => {
      const owner = await player(); const input = startInput(owner.id);
      await assert.rejects(repo.start(input), errorCode("GAME_NOT_AVAILABLE"));
      await db.game.update({ where: { id: game.id }, data: { status: "ACTIVE" } });
      await assert.rejects(repo.start({ ...input, entryAmount: 99n }), errorCode("INVALID_ENTRY"));
      const responses = await Promise.all([repo.start(input), repo.start(input)]);
      assert.equal(responses[0]!.session.id, responses[1]!.session.id);
      assert.equal(responses.filter((r) => r.replayed).length, 1);
      assert.deepEqual(responses[0]!.publicState.revealedMines, []);
      assert.equal(JSON.stringify(responses[0]!.publicState).includes("mineTiles"), false);
      assert.equal((await db.wallet.findUniqueOrThrow({ where: { accountId: owner.id } })).balance, 900n);
      assert.equal(await db.ledgerEntry.count({ where: { referenceId: responses[0]!.session.id } }), 1);
      await assert.rejects(repo.start({ ...input, difficulty: "MEDIUM" }), errorCode("IDEMPOTENCY_CONFLICT"));
      await assert.rejects(repo.start({ ...input, idempotencyKey: crypto.randomUUID() }), errorCode("SESSION_ALREADY_ACTIVE"));
      const poor = await player(10n);
      await assert.rejects(repo.start(startInput(poor.id)), errorCode("INSUFFICIENT_BALANCE"));
      assert.equal(await db.gameSession.count({ where: { ownerAccountId: poor.id } }), 0);
    });

    await t.test("cash-out retries settle once and cannot repeat a reward", async () => {
      const owner = await player(); const round = await repo.start(startInput(owner.id));
      const safe = command(1, 3);
      await repo.command(owner.id, round.session.id, safe);
      assert.equal((await new PrismaNeonMinesRepository(db).resume(owner.id))!.nextSequence, 2);
      await assert.rejects(repo.command(owner.id, round.session.id, { ...safe, payload: { action: "SELECT_TILE", tile: 4 } }), errorCode("IDEMPOTENCY_CONFLICT"));
      const cash = command(2);
      const results = await Promise.all([repo.command(owner.id, round.session.id, cash), repo.command(owner.id, round.session.id, cash)]);
      assert.equal(results.filter((r) => r.replayed).length, 1);
      assert.equal(results[0]!.session.reward, 109n);
      assert.equal((await db.wallet.findUniqueOrThrow({ where: { accountId: owner.id } })).balance, 1009n);
      assert.equal(await db.gameResult.count({ where: { gameSessionId: round.session.id } }), 1);
      assert.equal(await db.ledgerEntry.count({ where: { referenceId: round.session.id, type: "GAME_REWARD" } }), 1);
      await assert.rejects(repo.command(owner.id, round.session.id, command(3, 4)), errorCode("SESSION_COMPLETE"));
    });

    await t.test("competing sequence numbers accept only one action and keep one snapshot", async () => {
      const owner = await player(); const other = await player(); const round = await repo.start(startInput(owner.id));
      await assert.rejects(repo.command(other.id, round.session.id, command(1, 3)), errorCode("SESSION_NOT_FOUND"));
      const results = await Promise.allSettled([repo.command(owner.id, round.session.id, command(1, 3)), repo.command(owner.id, round.session.id, command(1, 4))]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      assert.equal((rejected.reason as NeonMinesError).code, "REPLAYED_SEQUENCE");
      const resumed = await repo.resume(owner.id);
      assert.equal(resumed!.publicState.selectedTiles.length, 1);
      assert.equal(await db.gameSessionState.count({ where: { gameSessionId: round.session.id } }), 1);
    });

    await t.test("mine losses return zero even after a safe tile", async () => {
      const owner = await player(); const round = await repo.start(startInput(owner.id));
      await repo.command(owner.id, round.session.id, command(1, 3));
      const lost = await repo.command(owner.id, round.session.id, command(2, 1));
      assert.equal(lost.publicState.currentCashOut, "0");
      assert.equal(lost.session.reward, 0n);
      assert.equal((await db.wallet.findUniqueOrThrow({ where: { accountId: owner.id } })).balance, 900n);
      assert.equal(await db.ledgerEntry.count({ where: { referenceId: round.session.id } }), 1);
    });

    await t.test("settlement failure rolls back state, sequence, result, and reward before retry", async () => {
      const owner = await player(); const round = await repo.start(startInput(owner.id));
      await repo.command(owner.id, round.session.id, command(1, 3));
      const cash = command(2);
      await db.$executeRawUnsafe(`CREATE FUNCTION mines_test_fail_result() RETURNS trigger AS $$ BEGIN IF NEW."details" ? 'difficulty' THEN RAISE EXCEPTION 'test settlement failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
      await db.$executeRawUnsafe(`CREATE TRIGGER mines_test_fail_result BEFORE INSERT ON "GameResult" FOR EACH ROW EXECUTE FUNCTION mines_test_fail_result()`);
      try {
        await assert.rejects(repo.command(owner.id, round.session.id, cash));
        assert.equal((await db.wallet.findUniqueOrThrow({ where: { accountId: owner.id } })).balance, 900n);
        assert.equal((await repo.resume(owner.id))!.nextSequence, 2);
        assert.equal(await db.gameResult.count({ where: { gameSessionId: round.session.id } }), 0);
        assert.equal(await db.ledgerEntry.count({ where: { referenceId: round.session.id, type: "GAME_REWARD" } }), 0);
      } finally {
        await db.$executeRawUnsafe(`DROP TRIGGER mines_test_fail_result ON "GameResult"`);
        await db.$executeRawUnsafe(`DROP FUNCTION mines_test_fail_result()`);
      }
      assert.equal((await repo.command(owner.id, round.session.id, cash)).session.reward, 109n);
    });

    await t.test("in-flight rounds retain original terms when the game is put in maintenance", async () => {
      const owner = await player(); const input = startInput(owner.id); const round = await repo.start(input);
      const original = await db.gameVersion.findUniqueOrThrow({ where: { id: game.activeVersionId! } });
      const revision = await db.gameVersion.create({ data: { gameId: game.id, version: "1.0.0", configurationRevision: 99, minimumEntry: 10n, maximumEntry: 500n, configuration: { ...(original.configuration as object), maximumPayoutCents: 110 } } });
      await db.game.update({ where: { id: game.id }, data: { status: "MAINTENANCE", activeVersionId: revision.id } });
      try {
        assert.equal((await repo.start(input)).replayed, true);
        const safe = await repo.command(owner.id, round.session.id, command(1, 3));
        assert.equal(safe.publicState.status, "ACTIVE", "Original cap still applies, so first safe tile must not auto-cash-out");
        assert.equal((await repo.command(owner.id, round.session.id, command(2))).session.reward, 109n);
      } finally { await db.game.update({ where: { id: game.id }, data: { status: "ACTIVE", activeVersionId: original.id } }); }
    });

    await t.test("an admin adjustment and cash-out cannot overwrite each other's wallet changes", async () => {
      const owner = await player(); const round = await repo.start(startInput(owner.id));
      await repo.command(owner.id, round.session.id, command(1, 3));
      const name = `a${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const admin = await db.account.create({ data: { username: name, usernameNormalized: name, type: "ADMIN", credential: { create: { passwordHash: "$argon2id$test" } }, adminProfile: { create: {} } } });
      await Promise.all([
        repo.command(owner.id, round.session.id, command(2)),
        new PrismaWalletRepository(db).applyAdminAdjustment({ playerId: owner.id, adminId: admin.id, signedAmount: 500n, type: "ADMIN_DEPOSIT", idempotencyKey: crypto.randomUUID(), reason: "Mines concurrency test", ipAddress: "127.0.0.1", userAgent: "test", occurredAt: new Date() })
      ]);
      assert.equal((await db.wallet.findUniqueOrThrow({ where: { accountId: owner.id } })).balance, 1509n);
    });

    await t.test("expiry pays safe progress for disabled players and abandons untouched rounds", async () => {
      const owner = await player(); const untouched = await player();
      const round = await repo.start(startInput(owner.id)); const empty = await repo.start(startInput(untouched.id));
      const safe = command(1, 3); await repo.command(owner.id, round.session.id, safe);
      await db.account.update({ where: { id: owner.id }, data: { status: "DISABLED", disabledAt: new Date() } });
      await assert.rejects(repo.resume(owner.id), errorCode("ACCESS_DENIED"));
      const future = new PrismaNeonMinesRepository(db, () => new Date(Date.now() + 16 * 60 * 1000));
      await future.expireBatch();
      assert.equal((await db.gameResult.findUniqueOrThrow({ where: { gameSessionId: round.session.id } })).reward, 109n);
      assert.equal((await db.gameSession.findUniqueOrThrow({ where: { id: empty.session.id } })).status, "ABANDONED");
      await future.expireBatch();
      assert.equal(await db.ledgerEntry.count({ where: { referenceId: round.session.id, type: "GAME_REWARD" } }), 1);
    });

    await t.test("concurrent expiry, cash-out and start replay settle the same round only once", async () => {
      const owner = await player(); const input = startInput(owner.id); const round = await repo.start(input);
      await repo.command(owner.id, round.session.id, command(1, 3));
      const future = new PrismaNeonMinesRepository(db, () => new Date(Date.now() + 16 * 60 * 1000));
      const results = await Promise.allSettled([
        future.expireBatch(), future.command(owner.id, round.session.id, command(2)), future.start(input)
      ]);
      assert.equal(results[0]!.status, "fulfilled");
      assert.equal(results[2]!.status, "fulfilled");
      assert.equal((await db.wallet.findUniqueOrThrow({ where: { accountId: owner.id } })).balance, 1009n);
      assert.equal(await db.gameResult.count({ where: { gameSessionId: round.session.id } }), 1);
      assert.equal(await db.ledgerEntry.count({ where: { referenceId: round.session.id, type: "GAME_REWARD" } }), 1);
      assert.equal((await db.gameSessionState.findUniqueOrThrow({ where: { gameSessionId: round.session.id } })).expiresAt, null);
    });

    await t.test("a command arriving after the deadline cannot undo expiry settlement", async () => {
      const owner = await player(); const round = await repo.start(startInput(owner.id));
      const safe = command(1, 3); await repo.command(owner.id, round.session.id, safe);
      const future = new PrismaNeonMinesRepository(db, () => new Date(Date.now() + 16 * 60 * 1000));
      await assert.rejects(future.command(owner.id, round.session.id, command(2, 0)), errorCode("SESSION_COMPLETE"));
      assert.equal((await db.gameResult.findUniqueOrThrow({ where: { gameSessionId: round.session.id } })).reward, 109n);
      const replay = await future.command(owner.id, round.session.id, safe);
      assert.equal(replay.replayed, true);
      assert.equal(replay.publicState.status, "AUTO_CASHED_OUT");
    });
  } finally { await db.$disconnect(); }
});
