import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NEON_MINES_DIFFICULTIES,
  NEON_MINES_MAX_MULTIPLIER_BPS,
  NEON_MINES_MAX_PAYOUT_CENTS,
  NEON_MINES_RETURN_BPS,
  allowedWagers,
  combination,
  fractionAsNumber,
  liabilityDecision,
  payoutQuote,
  survivalProbability,
  validateDifficultyWager
} from "./neon-mines-math.js";

test("combination and survival probabilities match known 25-tile results", () => {
  assert.equal(combination(25, 3), 2_300n);
  assert.deepEqual(survivalProbability(3, 1), { numerator: 22n, denominator: 25n });
  assert.deepEqual(survivalProbability(5, 3), { numerator: 57n, denominator: 115n });
  assert.ok(Math.abs(fractionAsNumber(survivalProbability(10, 3)) - 0.19782608695652174) < Number.EPSILON);
});

test("a 4 percent edge produces the expected easy one-click payout", () => {
  const quote = payoutQuote(10_000n, 3, 1);
  assert.equal(quote.grossPayoutCents, 10_909n);
  assert.equal(quote.netProfitCents, 909n);
  assert.deepEqual(quote.ownerRoundWinProbability, { numerator: 3n, denominator: 25n });
});

test("every uncapped quote returns no more than 96 percent and loses less than one cent to rounding", () => {
  for (const rule of Object.values(NEON_MINES_DIFFICULTIES)) {
    for (const wager of allowedWagers(rule.difficulty)) {
      for (let safe = 1; safe <= 25 - rule.mines; safe += 1) {
        const quote = payoutQuote(wager, rule.mines, safe);
        const probability = quote.survivalProbability;
        const expectedScaled = quote.grossPayoutCents * probability.numerator * 10_000n;
        const targetScaled = wager * BigInt(NEON_MINES_RETURN_BPS) * probability.denominator;
        assert.ok(expectedScaled <= targetScaled);
        assert.ok(targetScaled - expectedScaled < probability.numerator * 10_000n);
      }
    }
  }
});

test("payouts rise monotonically with every safe tile", () => {
  for (const rule of Object.values(NEON_MINES_DIFFICULTIES)) {
    let previous = 0n;
    for (let safe = 1; safe <= 25 - rule.mines; safe += 1) {
      const payout = payoutQuote(100n, rule.mines, safe).grossPayoutCents;
      assert.ok(payout > previous);
      previous = payout;
    }
  }
});

test("liability guard blocks the risky next click before either cap can be exceeded", () => {
  for (const rule of Object.values(NEON_MINES_DIFFICULTIES)) {
    for (const wager of allowedWagers(rule.difficulty)) {
      let safe = 0;
      while (true) {
        const decision = liabilityDecision({ wagerCents: wager, mines: rule.mines, safeSelections: safe });
        if (!decision.nextSelectionAllowed) {
          assert.equal(decision.cashOutRequired, safe > 0);
          if (decision.currentQuote !== null) {
            assert.ok(decision.currentQuote.grossPayoutCents <= NEON_MINES_MAX_PAYOUT_CENTS);
            assert.ok(decision.currentQuote.grossPayoutCents * 10_000n <= wager * BigInt(NEON_MINES_MAX_MULTIPLIER_BPS));
          }
          break;
        }
        if (decision.nextSafeQuote === null) assert.fail("Allowed selection requires a quote");
        assert.ok(decision.nextSafeQuote.grossPayoutCents <= NEON_MINES_MAX_PAYOUT_CENTS);
        safe += 1;
      }
    }
  }
});

test("difficulty wager limits keep high-volatility modes conservative", () => {
  assert.deepEqual(allowedWagers("EASY"), [10n, 25n, 50n, 100n, 200n, 500n, 1_000n, 2_000n, 5_000n]);
  assert.deepEqual(allowedWagers("HARD"), [10n, 25n, 50n, 100n, 200n, 500n, 1_000n, 2_000n]);
  assert.deepEqual(allowedWagers("EXPERT"), [10n, 25n, 50n, 100n, 200n, 500n, 1_000n]);
  assert.throws(() => validateDifficultyWager("EXPERT", 2_000n), /not allowed/u);
  assert.doesNotThrow(() => validateDifficultyWager("EXPERT", 1_000n));
});
