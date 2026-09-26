import assert from "node:assert/strict";
import { test } from "node:test";
import { NeonMinesEngine, placeMines } from "./neon-mines-engine.js";
import { allowedWagers, NEON_MINES_DIFFICULTIES, payoutQuote } from "./neon-mines-math.js";

const lowest = { integer: (minimum: number) => minimum };

test("every ordered Easy shuffle choice gives equal weight to all 2300 mine boards", () => {
  const counts = new Map<string, number>();
  for (let a = 0; a < 25; a += 1) for (let b = 1; b < 25; b += 1) for (let c = 2; c < 25; c += 1) {
    const choices = [a, b, c]; let index = 0;
    const key = placeMines(3, { integer: () => choices[index++]! }).join(",");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  assert.equal(counts.size, 2300);
  for (const count of counts.values()) assert.equal(count, 6);
});

test("restore rejects mathematically correct rewards reached past an automatic payout stop", () => {
  const config = { returnBps: 9600, maximumMultiplierBps: 5_000_000, maximumPayoutCents: 110n };
  const snapshot = new NeonMinesEngine(100n, "EASY", config, lowest).toSnapshot();
  const reward = payoutQuote(100n, 3, 2).grossPayoutCents.toString();
  assert.throws(() => NeonMinesEngine.restore({ ...snapshot, selectedTiles: [3, 4], status: "CASHED_OUT", reward }, config), /reachable payout limits/);
  assert.throws(() => NeonMinesEngine.restore({ ...snapshot, selectedTiles: [3, 4], status: "AUTO_CASHED_OUT", reward }, config), /reachable payout limits/);
  assert.throws(() => NeonMinesEngine.restore({ ...snapshot, selectedTiles: [0, 3], status: "MINE_HIT", detonatedTile: 0 }, config), /after the payout limit/);
  assert.throws(() => NeonMinesEngine.restore({ ...snapshot, selectedTiles: [3], status: "CASHED_OUT", reward: "109" }, config), /automatic cash-out/);
});

test("all launch difficulty/wager paths preserve hidden boards, legal restores and bounded rewards", async () => {
  for (const rule of Object.values(NEON_MINES_DIFFICULTIES)) for (const wager of allowedWagers(rule.difficulty)) {
    let engine = new NeonMinesEngine(wager, rule.difficulty, undefined, lowest);
    const board = engine.toSnapshot().mineTiles;
    for (let tile = rule.mines; engine.getPublicState().status === "ACTIVE"; tile += 1) {
      assert.ok(tile < 25);
      const before = engine.toSnapshot();
      await assert.rejects(engine.handleInput({ payload: { action: "SELECT_TILE", tile: -1 } }));
      assert.deepEqual(engine.toSnapshot(), before, "Rejected actions cannot mutate the round");
      assert.deepEqual(engine.getPublicState().revealedMines, []);
      await engine.handleInput({ payload: { action: "SELECT_TILE", tile } });
      const state = engine.getPublicState();
      assert.ok(BigInt(state.currentCashOut) <= 50_000n);
      assert.ok(BigInt(state.currentCashOut) * 10_000n <= wager * 5_000_000n);
      engine = NeonMinesEngine.restore(engine.toSnapshot());
      assert.deepEqual(engine.toSnapshot().mineTiles, board);
      if (state.status === "ACTIVE") {
        const cashed = NeonMinesEngine.restore(engine.toSnapshot());
        await cashed.handleInput({ payload: { action: "CASH_OUT" } });
        assert.deepEqual(NeonMinesEngine.restore(cashed.toSnapshot()).toSnapshot(), cashed.toSnapshot());
        const lost = NeonMinesEngine.restore(engine.toSnapshot());
        await lost.handleInput({ payload: { action: "SELECT_TILE", tile: 0 } });
        assert.equal(NeonMinesEngine.restore(lost.toSnapshot()).getPublicState().currentCashOut, "0");
      }
    }
    assert.equal(engine.getPublicState().status, "AUTO_CASHED_OUT");
    const finished = engine.toSnapshot();
    await assert.rejects(engine.handleInput({ payload: { action: "CASH_OUT" } }));
    await engine.complete();
    assert.deepEqual(engine.toSnapshot(), finished);
  }
});
