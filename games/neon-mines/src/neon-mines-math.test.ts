import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedWagers, NEON_MINES_DIFFICULTIES, validateDifficultyWager } from "./neon-mines-math.js";

test("difficulty rules use fixed full-board reward multipliers", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(NEON_MINES_DIFFICULTIES).map(([name, rule]) => [name, rule.rewardMultiplier])), {
    EASY: 2, MEDIUM: 3, HARD: 4
  });
});

test("default deposit limits are 10 coins for Easy and 20 for the other modes", () => {
  assert.equal(NEON_MINES_DIFFICULTIES.EASY.maximumWagerCents, 1_000n);
  assert.equal(NEON_MINES_DIFFICULTIES.MEDIUM.maximumWagerCents, 2_000n);
  assert.equal(NEON_MINES_DIFFICULTIES.HARD.maximumWagerCents, 2_000n);
  assert.deepEqual(allowedWagers("EASY"), [10n, 25n, 50n, 100n, 200n, 500n, 1_000n]);
  assert.deepEqual(allowedWagers("HARD"), [10n, 25n, 50n, 100n, 200n, 500n, 1_000n, 2_000n]);
});

test("configured caps still require a supported denomination", () => {
  assert.doesNotThrow(() => validateDifficultyWager("EASY", 500n, 500n));
  assert.throws(() => validateDifficultyWager("EASY", 1_000n, 500n), /not allowed/u);
  assert.throws(() => validateDifficultyWager("EASY", 333n, 500n), /not allowed/u);
});
