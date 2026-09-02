import assert from "node:assert/strict";
import { test } from "node:test";
import { createNeonReelsSpin, parseNeonReelsConfiguration, type NeonReelsRandom } from "./neon-reels.js";

const configuration = parseNeonReelsConfiguration({
  rows: 3, reels: 5, maxWinMultiplier: 100, wagerDenominationsCents: [10, 50, 100, 500, 1_000, 2_000, 5_000],
  weights: { LEMON: 30, CHERRY: 24, GEM: 18, BELL: 13, STAR: 8, SEVEN: 4, WILD: 3, SCATTER: 4 },
  payouts: {
    LEMON: { 3: 1, 4: 2, 5: 4 }, CHERRY: { 3: 1, 4: 3, 5: 6 }, GEM: { 3: 2, 4: 5, 5: 10 }, BELL: { 3: 3, 4: 8, 5: 15 },
    STAR: { 3: 4, 4: 10, 5: 20 }, SEVEN: { 3: 6, 4: 15, 5: 30 }, WILD: { 3: 8, 4: 20, 5: 50 }
  },
  scatterPayouts: { 3: 2, 4: 5, 5: 12 }
});

test("five matching symbols on all rows produce server-calculated line rewards", () => {
  const random: NeonReelsRandom = { integer: () => 0 };
  const spin = createNeonReelsSpin(10n, configuration, random);
  assert.equal(spin.winLines.length, 5);
  assert.equal(spin.totalMultiplier, 20);
  assert.equal(spin.reward, 200n);
});

test("configuration rejects unsupported reel geometry", () => {
  assert.throws(() => parseNeonReelsConfiguration({ ...configuration, reels: 3 }), /exactly 5 reels/u);
});

test("the configured maximum caps aggregate payouts", () => {
  const capped = { ...configuration, maxWinMultiplier: 3 };
  const spin = createNeonReelsSpin(10n, capped, { integer: () => 0 });
  assert.equal(spin.totalMultiplier, 3);
  assert.equal(spin.reward, 30n);
});

test("only configured wager denominations are accepted", () => {
  assert.doesNotThrow(() => createNeonReelsSpin(50n, configuration, { integer: () => 0 }));
  assert.doesNotThrow(() => createNeonReelsSpin(5_000n, configuration, { integer: () => 0 }));
  assert.throws(() => createNeonReelsSpin(25n, configuration, { integer: () => 0 }), /wager denomination/u);
});
