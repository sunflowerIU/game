import assert from "node:assert/strict";
import { test } from "node:test";
import { NeonMinesEngine, placeMines, type NeonMinesRandom, type NeonMinesSnapshot } from "./neon-mines-engine.js";

const lowestAvailable: NeonMinesRandom = { integer: (minimum) => minimum };

test("new rounds keep mine positions out of public state", () => {
  const engine = new NeonMinesEngine(100n, "EASY", undefined, lowestAvailable);
  const publicState = engine.getPublicState();
  assert.deepEqual(engine.toSnapshot().mineTiles, [0, 1, 2]);
  assert.deepEqual(publicState.revealedMines, []);
  assert.equal(publicState.status, "ACTIVE");
  assert.equal(publicState.nextSafePayout, "109");
});

test("safe selections increase cash-out and explicit cash-out completes the round", async () => {
  const engine = new NeonMinesEngine(100n, "EASY", undefined, lowestAvailable);
  const selected = await engine.handleInput({ payload: { action: "SELECT_TILE", tile: 3 } });
  assert.equal(selected.complete, false);
  assert.equal((selected.publicState as { currentCashOut: string }).currentCashOut, "109");
  const completed = await engine.handleInput({ payload: { action: "CASH_OUT" } });
  assert.equal(completed.complete, true);
  assert.deepEqual((completed.authoritativeResult as { outcome: string; reward: string }).outcome, "CASHED_OUT");
  assert.equal((completed.authoritativeResult as { reward: string }).reward, "109");
  assert.deepEqual((completed.publicState as { revealedMines: number[] }).revealedMines, [0, 1, 2]);
});

test("selecting a mine loses the wager and reveals the completed board", async () => {
  const engine = new NeonMinesEngine(100n, "EASY", undefined, lowestAvailable);
  await engine.handleInput({ payload: { action: "SELECT_TILE", tile: 3 } });
  const completed = await engine.handleInput({ payload: { action: "SELECT_TILE", tile: 1 } });
  assert.equal(completed.complete, true);
  assert.deepEqual(completed.events, [{ type: "MINE_HIT", tile: 1 }]);
  assert.equal((completed.authoritativeResult as { reward: string }).reward, "0");
  assert.deepEqual((completed.authoritativeResult as { selectedTiles: number[] }).selectedTiles, [1, 3]);
  assert.equal((completed.publicState as { detonatedTile: number }).detonatedTile, 1);
  assert.equal((completed.publicState as { currentCashOut: string }).currentCashOut, "0");
});

test("duplicate, out-of-range, malformed, and premature cash-out inputs are rejected", async () => {
  const engine = new NeonMinesEngine(100n, "EASY", undefined, lowestAvailable);
  await assert.rejects(engine.handleInput({ payload: { action: "CASH_OUT" } }), /at least one safe tile/iu);
  await assert.rejects(engine.handleInput({ payload: { action: "SELECT_TILE", tile: 25 } }), /0 through 24/u);
  await assert.rejects(engine.handleInput({ payload: { action: "SELECT_TILE", tile: 3, extra: true } }), /invalid Neon Mines input/ui);
  await engine.handleInput({ payload: { action: "SELECT_TILE", tile: 3 } });
  await assert.rejects(engine.handleInput({ payload: { action: "SELECT_TILE", tile: 3 } }), /already selected/u);
});

test("a successful tile automatically cashes out before the next tile could exceed liability", async () => {
  const engine = new NeonMinesEngine(100n, "EASY", { returnBps: 9_600, maximumMultiplierBps: 5_000_000, maximumPayoutCents: 110n }, lowestAvailable);
  const completed = await engine.handleInput({ payload: { action: "SELECT_TILE", tile: 3 } });
  assert.equal(completed.complete, true);
  assert.equal((completed.publicState as { status: string }).status, "AUTO_CASHED_OUT");
  assert.deepEqual(completed.events, [
    { type: "SAFE_TILE_REVEALED", tile: 3 },
    { type: "PAYOUT_LIMIT_REACHED", reason: "MAXIMUM_PAYOUT" },
    { type: "AUTO_CASH_OUT", reward: "109" }
  ]);
});

test("snapshots restore active rounds without exposing or changing their mine layout", async () => {
  const original = new NeonMinesEngine(100n, "EASY", undefined, lowestAvailable);
  await original.handleInput({ payload: { action: "SELECT_TILE", tile: 4 } });
  const snapshot = original.toSnapshot();
  const restored = NeonMinesEngine.restore(snapshot);
  assert.deepEqual(restored.toSnapshot(), snapshot);
  assert.deepEqual(restored.getPublicState().revealedMines, []);
  const completed = await restored.handleInput({ payload: { action: "CASH_OUT" } });
  assert.equal((completed.authoritativeResult as { reward: string }).reward, "109");
});

test("snapshot restoration rejects mine disclosure and reward tampering", () => {
  const engine = new NeonMinesEngine(100n, "EASY", undefined, lowestAvailable);
  const snapshot = engine.toSnapshot();
  assert.throws(() => NeonMinesEngine.restore({ ...snapshot, selectedTiles: [0] }), /invalid state/u);
  const fakeCashOut: NeonMinesSnapshot = { ...snapshot, selectedTiles: [3], status: "CASHED_OUT", reward: "999" };
  assert.throws(() => NeonMinesEngine.restore(fakeCashOut), /cash-out snapshot/u);
});

test("external completion cashes out safe progress but abandons untouched rounds", async () => {
  const untouched = new NeonMinesEngine(100n, "EASY", undefined, lowestAvailable);
  const expired = await untouched.complete();
  assert.equal((expired.authoritativeResult as { outcome: string }).outcome, "ABANDONED");
  assert.deepEqual(expired.events, [{ type: "ROUND_EXPIRED" }]);

  const progressed = new NeonMinesEngine(100n, "EASY", undefined, lowestAvailable);
  await progressed.handleInput({ payload: { action: "SELECT_TILE", tile: 3 } });
  const cashed = await progressed.complete();
  assert.equal((cashed.authoritativeResult as { outcome: string }).outcome, "AUTO_CASHOUT");
  assert.equal((cashed.authoritativeResult as { reward: string }).reward, "109");
});

test("mine placement is unique, bounded, deterministic under injected entropy, and validates entropy", () => {
  assert.deepEqual(placeMines(5, lowestAvailable), [0, 1, 2, 3, 4]);
  const highestAvailable: NeonMinesRandom = { integer: (_minimum, maximumExclusive) => maximumExclusive - 1 };
  assert.deepEqual(placeMines(3, highestAvailable), [0, 1, 24]);
  assert.throws(() => placeMines(3, { integer: (_minimum, maximumExclusive) => maximumExclusive }), /invalid tile index/u);
});
