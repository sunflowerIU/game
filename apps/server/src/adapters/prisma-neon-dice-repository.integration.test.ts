import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabaseClient } from "@game-platform/database";
import { createNeonDiceRoll, parseNeonDiceConfiguration, type NeonDiceRandom } from "@game-platform/neon-dice";
import { PrismaNeonDiceRepository } from "./prisma-neon-dice-repository.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const storedConfiguration = {
  returnBps: 9_500,
  multiplierBps: { UNDER_7: 22_800, EXACTLY_7: 57_000, OVER_7: 22_800 },
  wagerDenominationsCents: [50, 100, 200, 500, 1_000, 2_000, 3_000],
  maximumPayoutCents: 20_000
};
const configuration = parseNeonDiceConfiguration(storedConfiguration);

test("Dice settlement is atomic, serialized, and selection-idempotent", { skip: testDatabaseUrl === undefined }, async () => {
  const database = createDatabaseClient(testDatabaseUrl!);
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  try {
    const game = await database.game.upsert({
      where: { slug: "neon-dice" },
      update: { status: "ACTIVE" },
      create: { slug: "neon-dice", name: "Neon Dice", gameType: "SINGLE_PLAYER", status: "ACTIVE" }
    });
    const version = await database.gameVersion.upsert({
      where: { gameId_version_configurationRevision: { gameId: game.id, version: "1.0.0", configurationRevision: 1 } },
      update: { minimumEntry: 50n, maximumEntry: 3_000n, configuration: storedConfiguration },
      create: { gameId: game.id, version: "1.0.0", configurationRevision: 1, minimumEntry: 50n, maximumEntry: 3_000n, configuration: storedConfiguration }
    });
    await database.game.update({ where: { id: game.id }, data: { activeVersionId: version.id, status: "ACTIVE" } });
    const player = await database.account.create({ data: {
      username: `d${suffix}`,
      usernameNormalized: `d${suffix}`,
      type: "PLAYER",
      credential: { create: { passwordHash: "$argon2id$integration" } },
      playerProfile: { create: {} },
      wallet: { create: { balance: 10_000n } }
    } });

    const repository = new PrismaNeonDiceRepository(database);
    const request = {
      playerId: player.id,
      gameId: game.id,
      entryAmount: 500n,
      selection: "UNDER_7" as const,
      idempotencyKey: `dice-${suffix}-00001`,
      serverInstanceId: "integration",
      occurredAt: new Date(),
      ipAddress: "127.0.0.1",
      resolve: () => createNeonDiceRoll(500n, "UNDER_7", configuration, sequenceRandom(1, 2))
    };

    const duplicated = await Promise.all([repository.playRoll(request), repository.playRoll(request)]);
    assert.equal(duplicated[0].session.id, duplicated[1].session.id);
    assert.equal(duplicated.filter((result) => result.replayed).length, 1);
    assert.equal(duplicated[0].session.reward, 1_140n);
    assert.equal(duplicated[0].session.score, 3);
    assert.equal((await database.wallet.findUniqueOrThrow({ where: { accountId: player.id } })).balance, 10_640n);
    assert.equal(await database.ledgerEntry.count({ where: { referenceId: duplicated[0].session.id, type: "GAME_ENTRY" } }), 1);
    assert.equal(await database.ledgerEntry.count({ where: { referenceId: duplicated[0].session.id, type: "GAME_REWARD" } }), 1);
    assert.equal(await database.gameResult.count({ where: { gameSessionId: duplicated[0].session.id } }), 1);

    await database.game.update({ where: { id: game.id }, data: { status: "MAINTENANCE" } });
    const maintenanceReplay = await repository.playRoll(request);
    assert.equal(maintenanceReplay.replayed, true);
    assert.equal(maintenanceReplay.session.id, duplicated[0].session.id);
    await database.game.update({ where: { id: game.id }, data: { status: "ACTIVE" } });

    await assert.rejects(
      repository.playRoll({ ...request, selection: "OVER_7", resolve: () => createNeonDiceRoll(500n, "OVER_7", configuration, sequenceRandom(6, 6)) }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "IDEMPOTENCY_CONFLICT"
    );

    const loss = await repository.playRoll({
      ...request,
      idempotencyKey: `dice-${suffix}-00002`,
      selection: "EXACTLY_7",
      resolve: () => createNeonDiceRoll(500n, "EXACTLY_7", configuration, sequenceRandom(1, 1))
    });
    assert.equal(loss.session.reward, 0n);
    assert.equal(await database.ledgerEntry.count({ where: { referenceId: loss.session.id } }), 1);
    assert.equal((await database.wallet.findUniqueOrThrow({ where: { accountId: player.id } })).balance, 10_140n);

    const ledgerCountBefore = await database.ledgerEntry.count({ where: { wallet: { accountId: player.id } } });
    await assert.rejects(repository.playRoll({
      ...request,
      idempotencyKey: `dice-${suffix}-00003`,
      resolve: () => ({ ...createNeonDiceRoll(500n, "OVER_7", configuration, sequenceRandom(6, 6)), selection: "OVER_7" })
    }));
    assert.equal(await database.ledgerEntry.count({ where: { wallet: { accountId: player.id } } }), ledgerCountBefore);
    assert.equal((await database.wallet.findUniqueOrThrow({ where: { accountId: player.id } })).balance, 10_140n);

    const lowBalancePlayer = await database.account.create({ data: {
      username: `l${suffix}`,
      usernameNormalized: `l${suffix}`,
      type: "PLAYER",
      credential: { create: { passwordHash: "$argon2id$integration" } },
      playerProfile: { create: {} },
      wallet: { create: { balance: 500n } }
    } });
    const lowBalanceRequest = {
      ...request,
      playerId: lowBalancePlayer.id,
      selection: "EXACTLY_7" as const,
      resolve: () => createNeonDiceRoll(500n, "EXACTLY_7", configuration, sequenceRandom(1, 1))
    };
    const competing = await Promise.allSettled([
      repository.playRoll({ ...lowBalanceRequest, idempotencyKey: `dice-${suffix}-00004` }),
      repository.playRoll({ ...lowBalanceRequest, idempotencyKey: `dice-${suffix}-00005` })
    ]);
    assert.equal(competing.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(competing.filter((result) => result.status === "rejected").length, 1);
    assert.equal((await database.wallet.findUniqueOrThrow({ where: { accountId: lowBalancePlayer.id } })).balance, 0n);
    assert.equal(await database.ledgerEntry.count({ where: { wallet: { accountId: lowBalancePlayer.id }, type: "GAME_ENTRY" } }), 1);
  } finally {
    await database.$disconnect();
  }
});

function sequenceRandom(...values: number[]): NeonDiceRandom {
  const remaining = [...values];
  return { integer: () => remaining.shift() ?? 1 };
}
