import assert from "node:assert/strict";
import { test } from "node:test";
import { NeonMinesEngine, placeMines, type NeonMinesRandom } from "./neon-mines-engine.js";

const lowest: NeonMinesRandom = { integer: (minimum) => minimum };

test("new rounds hide mines and advertise only the completion reward", () => {
  const state = new NeonMinesEngine(100n, "EASY", undefined, lowest).getPublicState();
  assert.deepEqual(state.revealedMines, []);
  assert.equal(state.currentCashOut, "0");
  assert.equal(state.nextSafePayout, "200");
  assert.equal(state.rewardMultiplier, 2);
  assert.equal(state.cashOutAvailable, false);
});

test("configured win multipliers determine the completed reward", async () => {
  const configuration = {
    difficulties: {
      EASY: { mines: 2, maximumWagerCents: 1_000n, rewardMultiplier: 6 },
      MEDIUM: { mines: 3, maximumWagerCents: 2_000n, rewardMultiplier: 3 },
      HARD: { mines: 4, maximumWagerCents: 2_000n, rewardMultiplier: 4 }
    }
  } as const;
  const engine = new NeonMinesEngine(100n, "EASY", configuration, lowest);
  for (let tile = 2; tile < 9; tile += 1) await engine.handleInput({ payload: { action: "SELECT_TILE", tile } });
  assert.equal(engine.getPublicState().currentCashOut, "600");
});

test("safe picks do not pay until every safe tile is revealed", async () => {
  const engine = new NeonMinesEngine(100n, "EASY", undefined, lowest);
  for (let tile = 2; tile < 8; tile += 1) {
    const transition = await engine.handleInput({ payload: { action: "SELECT_TILE", tile } });
    assert.equal(transition.complete, false);
    assert.equal(engine.getPublicState().currentCashOut, "0");
  }
  const won = await engine.handleInput({ payload: { action: "SELECT_TILE", tile: 8 } });
  assert.equal(won.complete, true);
  assert.equal(engine.getPublicState().status, "WON");
  assert.equal(engine.getPublicState().currentCashOut, "200");
});

test("a mine loses the deposit", async () => {
  const engine = new NeonMinesEngine(100n, "EASY", undefined, lowest);
  const lost = await engine.handleInput({ payload: { action: "SELECT_TILE", tile: 1 } });
  assert.equal(lost.complete, true);
  assert.equal(engine.getPublicState().status, "MINE_HIT");
  assert.equal(engine.getPublicState().currentCashOut, "0");
});

test("leaving before a click refunds; leaving after a click forfeits", async () => {
  const untouched = new NeonMinesEngine(100n, "EASY", undefined, lowest);
  await untouched.handleInput({ payload: { action: "LEAVE" } });
  assert.equal(untouched.getPublicState().currentCashOut, "100");

  const progressed = new NeonMinesEngine(100n, "EASY", undefined, lowest);
  await progressed.handleInput({ payload: { action: "SELECT_TILE", tile: 2 } });
  await progressed.handleInput({ payload: { action: "LEAVE" } });
  assert.equal(progressed.getPublicState().currentCashOut, "0");
});

test("snapshots restore active and terminal rounds without changing mines", async () => {
  const engine = new NeonMinesEngine(100n, "EASY", undefined, lowest);
  await engine.handleInput({ payload: { action: "SELECT_TILE", tile: 2 } });
  const restored = NeonMinesEngine.restore(engine.toSnapshot());
  assert.deepEqual(restored.toSnapshot(), engine.toSnapshot());
  assert.deepEqual(restored.getPublicState().revealedMines, []);
});

test("mine placement is unique, bounded and deterministic", () => {
  assert.deepEqual(placeMines(4, lowest), [0, 1, 2, 3]);
  assert.throws(() => placeMines(3, { integer: (_minimum, maximum) => maximum }), /invalid tile index/u);
});
