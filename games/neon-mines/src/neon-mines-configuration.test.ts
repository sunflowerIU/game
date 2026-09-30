import assert from "node:assert/strict";
import { test } from "node:test";
import { parseNeonMinesConfiguration } from "./neon-mines-configuration.js";
import { NEON_MINES_WAGERS_CENTS } from "./neon-mines-math.js";

const configuration = {
  boardTiles: 9, completionOnly: true, wagerDenominationsCents: NEON_MINES_WAGERS_CENTS.map(Number),
  difficulties: {
    EASY: { mines: 2, maximumWagerCents: 1_000, rewardMultiplier: 2 }, MEDIUM: { mines: 3, maximumWagerCents: 2_000, rewardMultiplier: 3 },
    HARD: { mines: 4, maximumWagerCents: 2_000, rewardMultiplier: 4 }
  }
};

test("Mines configuration exposes adjustable server-side deposit caps", () => {
  const parsed = parseNeonMinesConfiguration(configuration);
  assert.equal(parsed.difficulties.EASY.maximumWagerCents, 1_000n);
  assert.equal(parsed.difficulties.HARD.rewardMultiplier, 4);
  assert.equal(parseNeonMinesConfiguration({ ...configuration, difficulties: { ...configuration.difficulties, EASY: { ...configuration.difficulties.EASY, maximumWagerCents: 500 } } }).difficulties.EASY.maximumWagerCents, 500n);
});

test("Mines rejects changed odds, invalid multipliers and excessive deposits", () => {
  for (const value of [null, {}, { ...configuration, boardTiles: 36 }, { ...configuration, completionOnly: false },
    { ...configuration, wagerDenominationsCents: [100] },
    { ...configuration, difficulties: { ...configuration.difficulties, EASY: { ...configuration.difficulties.EASY, mines: 1 } } },
    { ...configuration, difficulties: { ...configuration.difficulties, EASY: { ...configuration.difficulties.EASY, rewardMultiplier: 0 } } },
    { ...configuration, difficulties: { ...configuration.difficulties, EASY: { ...configuration.difficulties.EASY, maximumWagerCents: 5_000 } } }]) assert.throws(() => parseNeonMinesConfiguration(value));
});

test("Mines accepts administrator-configured win multipliers", () => {
  const parsed = parseNeonMinesConfiguration({ ...configuration, difficulties: { ...configuration.difficulties, EASY: { ...configuration.difficulties.EASY, rewardMultiplier: 6 } } });
  assert.equal(parsed.difficulties.EASY.rewardMultiplier, 6);
});
