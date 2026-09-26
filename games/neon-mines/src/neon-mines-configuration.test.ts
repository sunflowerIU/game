import assert from "node:assert/strict";
import { test } from "node:test";
import { parseNeonMinesConfiguration } from "./neon-mines-configuration.js";
import { NEON_MINES_DIFFICULTIES, NEON_MINES_WAGERS_CENTS } from "./neon-mines-math.js";

const configuration = {
  boardTiles: 25, returnBps: 9600, maximumMultiplierBps: 5_000_000, maximumPayoutCents: 50_000,
  wagerDenominationsCents: NEON_MINES_WAGERS_CENTS.map(Number),
  difficulties: Object.fromEntries(Object.entries(NEON_MINES_DIFFICULTIES).map(([name, rule]) => [name, { mines: rule.mines, maximumWagerCents: Number(rule.maximumWagerCents) }]))
};
test("Mines stored configuration preserves the fixed launch math and supports a lower liability cap", () => {
  assert.equal(parseNeonMinesConfiguration(configuration).maximumPayoutCents, 50_000n);
  assert.equal(parseNeonMinesConfiguration({ ...configuration, maximumPayoutCents: 110 }).maximumPayoutCents, 110n);
});
test("invalid stored configuration cannot silently change board odds or payout limits", () => {
  for (const value of [null, {}, { ...configuration, returnBps: 10_000 }, { ...configuration, boardTiles: 36 },
    { ...configuration, maximumPayoutCents: 50_001 }, { ...configuration, maximumPayoutCents: "50000" },
    { ...configuration, wagerDenominationsCents: [100] }, { ...configuration, difficulties: { EASY: { mines: 1 } } }]) {
    assert.throws(() => parseNeonMinesConfiguration(value));
  }
});

test("Mines rejects unsupported rule fields instead of persisting misleading settings", () => {
  for (const value of [{ ...configuration, winChance: 99 },
    { ...configuration, difficulties: { ...configuration.difficulties, CUSTOM: { mines: 1, maximumWagerCents: 500 } } },
    { ...configuration, difficulties: { ...configuration.difficulties, EASY: { ...configuration.difficulties.EASY, guaranteedWin: true } } }]) {
    assert.throws(() => parseNeonMinesConfiguration(value));
  }
});
