import assert from "node:assert/strict";
import { test } from "node:test";
import { NeonMinesRequestError, parseNeonMinesAction, parseNeonMinesCommandRequest, parseStartNeonMinesSessionRequest } from "../src/neon-mines.ts";

const commandId = "2c84e3d5-4ba7-49ec-9c57-70ea25f30131";

test("Mines start contract accepts integer cents and each named difficulty", () => {
  for (const difficulty of ["EASY", "MEDIUM", "HARD"]) {
    assert.deepEqual(parseStartNeonMinesSessionRequest({ entryAmount: 100, difficulty }), { entryAmount: 100, difficulty });
  }
});

test("Mines start contract rejects client-provided boards, rewards, coercion, and missing fields", () => {
  for (const raw of [null, [], {}, { entryAmount: 100 }, { entryAmount: 100, difficulty: "easy" },
    { entryAmount: "100", difficulty: "EASY" }, { entryAmount: 0.1, difficulty: "EASY" },
    { entryAmount: 0, difficulty: "EASY" }, { entryAmount: -1, difficulty: "EASY" },
    { entryAmount: 100, difficulty: "EASY", mineTiles: [0, 1, 2] },
    { entryAmount: 100, difficulty: "EASY", reward: "999" }]) {
    assert.throws(() => parseStartNeonMinesSessionRequest(raw), NeonMinesRequestError);
  }
});

test("Mines commands are canonical, strictly shaped, and sequence bounded", () => {
  const command = { commandId, sequence: 1, payload: { action: "SELECT_TILE", tile: 8 } };
  assert.deepEqual(parseNeonMinesCommandRequest({ ...command, commandId: commandId.toUpperCase() }), command);
  assert.deepEqual(parseNeonMinesAction({ action: "LEAVE" }), { action: "LEAVE" });
  for (const raw of [{ ...command, sequence: 0 }, { ...command, sequence: 1.5 },
    { ...command, sequence: "1" }, { ...command, sequence: 2_147_483_647 },
    { ...command, commandId: "invalid" }, { ...command, reward: "999" },
    { ...command, payload: { action: "SELECT_TILE", tile: -1 } },
    { ...command, payload: { action: "SELECT_TILE", tile: 9 } },
    { ...command, payload: { action: "SELECT_TILE", tile: "1" } },
    { ...command, payload: { action: "LEAVE", tile: 1 } },
    { ...command, payload: { action: "LEAVE", reward: 100 } }]) {
    assert.throws(() => parseNeonMinesCommandRequest(raw), NeonMinesRequestError);
  }
});
