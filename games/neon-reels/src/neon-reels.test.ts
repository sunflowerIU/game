import assert from "node:assert/strict";
import { test } from "node:test";
import { createNeonReelsSpin, parseNeonReelsConfiguration, type NeonReelsRandom } from "./neon-reels.js";

const configuration = parseNeonReelsConfiguration({
  rows: 3, reels: 5, maxWinMultiplier: 100, wagerDenominationsCents: [10, 50, 100, 500, 1_000, 2_000, 5_000],
  weights: { LEMON: 34, CHERRY: 27, GEM: 19, BELL: 12, STAR: 7, SEVEN: 3, WILD: 3, SCATTER: 4 },
  payouts: {
    LEMON: { 3: 2, 4: 2, 5: 5 }, CHERRY: { 3: 2, 4: 3, 5: 7 }, GEM: { 3: 2, 4: 5, 5: 10 }, BELL: { 3: 3, 4: 8, 5: 15 },
    STAR: { 3: 4, 4: 10, 5: 20 }, SEVEN: { 3: 6, 4: 15, 5: 30 }, WILD: { 3: 8, 4: 20, 5: 50 }
  },
  scatterPayouts: { 3: 2, 4: 5, 5: 12 }
});

test("five matching symbols on all rows produce server-calculated line rewards", () => {
  const random: NeonReelsRandom = { integer: () => 0 };
  const spin = createNeonReelsSpin(10n, configuration, random);
  assert.equal(spin.winLines.length, 5);
  assert.equal(spin.totalMultiplier, 25);
  assert.equal(spin.reward, 250n);
});

test("configuration rejects unsupported reel geometry", () => {
  assert.throws(() => parseNeonReelsConfiguration({ ...configuration, reels: 3 }), /exactly 5 reels/u);
});

test("configuration rejects stake-only wins and caps", () => {
  assert.throws(() => parseNeonReelsConfiguration({ ...configuration, payouts: { ...configuration.payouts, LEMON: { ...configuration.payouts.LEMON, 3: 1 } } }), /stake-only returns/u);
  assert.throws(() => parseNeonReelsConfiguration({ ...configuration, maxWinMultiplier: 1 }), /maxWinMultiplier/u);
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

test("the balanced paytable never presents a stake-only return as a win", () => {
  const linePayouts = Object.values(configuration.payouts).flatMap((payout) => Object.values(payout));
  assert.ok(linePayouts.every((multiplier) => multiplier >= 2));
  assert.ok(Object.values(configuration.scatterPayouts).every((multiplier) => multiplier >= 2));
});

test("the balanced profile remains in its documented hit and RTP bands", () => {
  let state = 0x1357_9bdf;
  const random: NeonReelsRandom = { integer: (minimum, maximumExclusive) => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return minimum + ((state >>> 0) % (maximumExclusive - minimum));
  } };
  const spins = 250_000;
  let hits = 0; let returned = 0n;
  for (let index = 0; index < spins; index += 1) {
    const spin = createNeonReelsSpin(100n, configuration, random);
    if (spin.reward > 0n) hits += 1;
    returned += spin.reward;
  }
  const hitRate = hits / spins;
  const rtp = Number(returned) / (spins * 100);
  assert.ok(hitRate > 0.30 && hitRate < 0.32, `unexpected hit rate ${hitRate}`);
  assert.ok(rtp > 0.93 && rtp < 0.98, `unexpected RTP ${rtp}`);
});
