import assert from "node:assert/strict";
import { test } from "node:test";
import { GameRegistry } from "@game-platform/game-core";
import {
  NEON_DICE_MULTIPLIER_BPS,
  NEON_DICE_SELECTIONS,
  NEON_DICE_SUPPORTED_WAGERS_CENTS,
  NeonDiceDefinition,
  NeonDiceEngine,
  createNeonDiceRoll,
  parseNeonDiceConfiguration,
  parseNeonDiceResult,
  selectionWins,
  toNeonDiceResult,
  type NeonDiceConfiguration,
  type NeonDiceSelection
} from "./neon-dice.js";

const rawConfiguration = {
  returnBps: 9_500,
  multiplierBps: { UNDER_7: 22_800, EXACTLY_7: 57_000, OVER_7: 22_800 },
  wagerDenominationsCents: [...NEON_DICE_SUPPORTED_WAGERS_CENTS],
  maximumPayoutCents: 20_000
};
const configuration = parseNeonDiceConfiguration(rawConfiguration);

test("all 36 outcomes produce the exact 15/6/15 market split", () => {
  const counts: Record<NeonDiceSelection, number> = { UNDER_7: 0, EXACTLY_7: 0, OVER_7: 0 };
  for (let first = 1; first <= 6; first += 1) for (let second = 1; second <= 6; second += 1) {
    const total = first + second;
    for (const selection of NEON_DICE_SELECTIONS) if (selectionWins(selection, total)) counts[selection] += 1;
  }
  assert.deepEqual(counts, { UNDER_7: 15, EXACTLY_7: 6, OVER_7: 15 });
});

test("each market has exactly 95 percent theoretical RTP", () => {
  const winningOutcomes: Record<NeonDiceSelection, bigint> = { UNDER_7: 15n, EXACTLY_7: 6n, OVER_7: 15n };
  for (const selection of NEON_DICE_SELECTIONS) {
    assert.equal(BigInt(NEON_DICE_MULTIPLIER_BPS[selection]) * winningOutcomes[selection] / 36n, 9_500n);
  }
});

test("every launch denomination settles every win to whole cents", () => {
  for (const wager of NEON_DICE_SUPPORTED_WAGERS_CENTS) for (const multiplier of Object.values(NEON_DICE_MULTIPLIER_BPS)) {
    assert.equal((BigInt(wager) * BigInt(multiplier)) % 10_000n, 0n);
  }
  assert.equal(createRoll(3_000n, "EXACTLY_7", 1, 6).reward, 17_100n);
});

test("the resolver requests two independent six-sided values and applies the chosen market", () => {
  const calls: [number, number][] = [];
  const values = [2, 4];
  const roll = createNeonDiceRoll(100n, "UNDER_7", configuration, {
    integer: (minimum, maximumExclusive) => {
      calls.push([minimum, maximumExclusive]);
      return values.shift() ?? 1;
    }
  });
  assert.deepEqual(calls, [[1, 7], [1, 7]]);
  assert.deepEqual(roll, { dice: [2, 4], total: 6, selection: "UNDER_7", multiplierBps: 22_800, win: true, reward: 228n });
  assert.equal(createRoll(100n, "UNDER_7", 1, 6).win, false);
  assert.equal(createRoll(100n, "EXACTLY_7", 1, 6).reward, 570n);
  assert.equal(createRoll(100n, "OVER_7", 6, 2).reward, 228n);
});

test("configuration permits safe wager subsets and rejects payout or odds drift", () => {
  assert.deepEqual(parseNeonDiceConfiguration({ ...rawConfiguration, wagerDenominationsCents: [100, 500, 3_000] }).wagerDenominationsCents, [100, 500, 3_000]);
  const invalid = [
    { ...rawConfiguration, returnBps: 9_600 },
    { ...rawConfiguration, multiplierBps: { ...rawConfiguration.multiplierBps, EXACTLY_7: 57_001 } },
    { ...rawConfiguration, wagerDenominationsCents: [25, 50] },
    { ...rawConfiguration, wagerDenominationsCents: [50, 50] },
    { ...rawConfiguration, wagerDenominationsCents: [100, 50] },
    { ...rawConfiguration, wagerDenominationsCents: [3_001] },
    { ...rawConfiguration, wagerDenominationsCents: [3_000], maximumPayoutCents: 17_099 },
    { ...rawConfiguration, maximumPayoutCents: 20_001 },
    { ...rawConfiguration, surprise: true }
  ];
  for (const candidate of invalid) assert.throws(() => parseNeonDiceConfiguration(candidate));
});

test("invalid wagers, selections, and random values are rejected", () => {
  assert.throws(() => createNeonDiceRoll(25n, "UNDER_7", configuration, sequenceRandom(1, 1)), /wager denomination/u);
  assert.throws(() => createNeonDiceRoll(50n, "SIDEWAYS" as NeonDiceSelection, configuration, sequenceRandom(1, 1)), /selection/u);
  assert.throws(() => createNeonDiceRoll(50n, "UNDER_7", configuration, sequenceRandom(0, 1)), /random source/iu);
  assert.throws(() => selectionWins("UNDER_7", 13), /outcome/u);
});

test("stored results are strict and reject tampered financial or dice facts", () => {
  const roll = createRoll(500n, "EXACTLY_7", 3, 4);
  const stored = toNeonDiceResult(roll);
  assert.deepEqual(parseNeonDiceResult(stored, 500n, configuration), roll);
  for (const tampered of [
    { ...stored, total: 8 },
    { ...stored, reward: "9999" },
    { ...stored, multiplierBps: 22_800 },
    { ...stored, win: false },
    { ...stored, dice: [0, 7] },
    { ...stored, extra: true }
  ]) assert.throws(() => parseNeonDiceResult(tampered, 500n, configuration));
});

test("engine completion is idempotent and exposes only the resolved public result", async () => {
  let calls = 0;
  const engine = new NeonDiceEngine(50n, "OVER_7", configuration, { integer: () => { calls += 1; return 6; } });
  assert.deepEqual(engine.getPublicState(), { status: "READY", entryAmount: "50", selection: "OVER_7" });
  const first = await engine.complete(new Date());
  const second = await engine.complete(new Date());
  assert.deepEqual(second, first);
  assert.equal(calls, 2);
  assert.deepEqual(first.events, [{ type: "DICE_WIN" }]);
  assert.equal(first.complete, true);
  assert.deepEqual(first.publicState, { status: "COMPLETED", entryAmount: "50", dice: [6, 6], total: 12, selection: "OVER_7", multiplierBps: 22_800, win: true, reward: "114", outcome: "WIN" });
});

test("definition validates registration configuration but requires explicit atomic selection", () => {
  const definition = new NeonDiceDefinition();
  const registry = new GameRegistry();
  registry.register(definition);
  assert.equal(registry.has("neon-dice", "1.0.0"), true);
  assert.deepEqual(definition.validateConfiguration(rawConfiguration), configuration);
  assert.throws(() => definition.createEngine(), /explicit player selection/u);
});

function createRoll(wager: bigint, selection: NeonDiceSelection, first: number, second: number) {
  return createNeonDiceRoll(wager, selection, configuration, sequenceRandom(first, second));
}

function sequenceRandom(...values: number[]) {
  const remaining = [...values];
  return { integer: () => remaining.shift() ?? 1 };
}

void (configuration satisfies NeonDiceConfiguration);
