import assert from "node:assert/strict";
import { test } from "node:test";
import { NeonMinesEngine, placeMines } from "./neon-mines-engine.js";
import { allowedWagers, NEON_MINES_BOARD_TILES, NEON_MINES_DIFFICULTIES } from "./neon-mines-math.js";

const lowest = { integer: (minimum: number) => minimum };

test("every ordered Easy shuffle choice gives equal weight to all 36 mine boards", () => {
  const counts = new Map<string, number>();
  for (let a = 0; a < NEON_MINES_BOARD_TILES; a += 1) for (let b = 1; b < NEON_MINES_BOARD_TILES; b += 1) {
    const choices = [a, b]; let index = 0;
    const key = placeMines(2, { integer: () => choices[index++]! }).join(",");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  assert.equal(counts.size, 36);
  for (const count of counts.values()) assert.equal(count, 2);
});

test("all difficulty and deposit paths preserve hidden boards and exact fixed rewards", async () => {
  for (const rule of Object.values(NEON_MINES_DIFFICULTIES)) for (const wager of allowedWagers(rule.difficulty)) {
    const engine = new NeonMinesEngine(wager, rule.difficulty, undefined, lowest);
    const board = engine.toSnapshot().mineTiles;
    for (let tile = rule.mines; tile < NEON_MINES_BOARD_TILES; tile += 1) {
      assert.deepEqual(engine.getPublicState().revealedMines, []);
      await engine.handleInput({ payload: { action: "SELECT_TILE", tile } });
    }
    assert.equal(engine.getPublicState().status, "WON");
    assert.equal(engine.getPublicState().currentCashOut, (wager * BigInt(rule.rewardMultiplier)).toString());
    assert.deepEqual(NeonMinesEngine.restore(engine.toSnapshot()).toSnapshot().mineTiles, board);
  }
});

test("restore rejects forged completion rewards", async () => {
  const engine = new NeonMinesEngine(100n, "EASY", undefined, lowest);
  await engine.handleInput({ payload: { action: "LEAVE" } });
  assert.throws(() => NeonMinesEngine.restore({ ...engine.toSnapshot(), reward: "999" }), /abandoned snapshot/u);
});
