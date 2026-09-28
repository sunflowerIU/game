import assert from "node:assert/strict";
import { test } from "node:test";
import { parseNeonDiceConfiguration, createNeonDiceRoll, type NeonDiceRepository } from "./index.js";
import { NeonDiceService, NeonDiceServiceError } from "./neon-dice-service.js";

const configuration = parseNeonDiceConfiguration({
  returnBps: 9_500,
  multiplierBps: { UNDER_7: 22_800, EXACTLY_7: 57_000, OVER_7: 22_800 },
  wagerDenominationsCents: [50, 100, 500, 3_000],
  maximumPayoutCents: 20_000
});
const player = { accountId: "player-1", username: "Player", type: "PLAYER" as const, permissions: new Set<string>(), sessionId: "session-1" };
const admin = { ...player, type: "ADMIN" as const };

test("service forwards the immutable selection and returns completed public state", async () => {
  const received: Parameters<NeonDiceRepository["playRoll"]>[0][] = [];
  const occurredAt = new Date("2026-09-28T10:00:00.000Z");
  const repository: NeonDiceRepository = { playRoll: async (input) => {
    received.push(input);
    const details = createNeonDiceRoll(input.entryAmount, input.selection, configuration, sequenceRandom(3, 4));
    return { replayed: false, session: { id: "roll-1", gameId: input.gameId, gameVersion: "1.0.0", status: "COMPLETED", entryAmount: input.entryAmount, startedAt: input.occurredAt, completedAt: input.occurredAt, score: details.total, reward: details.reward, details } };
  } };
  const service = new NeonDiceService(repository, "server-1", { now: () => occurredAt });
  const response = await service.roll(player, { gameId: "game-1", entryAmount: 500n, selection: "EXACTLY_7", idempotencyKey: "dice-service-test-01", ipAddress: "127.0.0.1" });
  assert.equal(received[0]?.selection, "EXACTLY_7");
  assert.equal(received[0]?.serverInstanceId, "server-1");
  assert.equal(received[0]?.occurredAt, occurredAt);
  assert.equal(response.nextSequence, 1);
  assert.deepEqual(response.publicState, { status: "COMPLETED", entryAmount: "500", dice: [3, 4], total: 7, selection: "EXACTLY_7", multiplierBps: 57_000, win: true, reward: "2850", outcome: "WIN" });
});

test("service rejects non-player access and malformed idempotency before repository work", async () => {
  let calls = 0;
  const repository: NeonDiceRepository = { playRoll: async () => { calls += 1; throw new Error("not reached"); } };
  const service = new NeonDiceService(repository, "server-1");
  await assert.rejects(service.roll(admin, { gameId: "game-1", entryAmount: 500n, selection: "UNDER_7", idempotencyKey: "dice-service-test-02", ipAddress: "127.0.0.1" }), code("ACCESS_DENIED"));
  await assert.rejects(service.roll(player, { gameId: "game-1", entryAmount: 500n, selection: "UNDER_7", idempotencyKey: "short", ipAddress: "127.0.0.1" }), code("IDEMPOTENCY_CONFLICT"));
  assert.equal(calls, 0);
});

function sequenceRandom(...values: number[]) {
  const remaining = [...values];
  return { integer: () => remaining.shift() ?? 1 };
}

function code(expected: string) {
  return (error: unknown) => error instanceof NeonDiceServiceError && error.code === expected;
}
