import assert from "node:assert/strict";
import { test } from "node:test";
import { GameRegistry, type ActiveGameEngine } from "./catalog.js";
import { GameProtocolError, parseGameInput } from "./protocol.js";
import { GameRuntime, InMemoryActiveSessionStore, type ActiveGameSession } from "./runtime.js";
import { GameSessionLifecycle, SessionLifecycleError, type GameSessionPersistence } from "./session-lifecycle.js";

const sessionId = "2c84e3d5-4ba7-49ec-9c57-70ea25f30131";
const commandId = "55e62c97-7576-484b-aea3-85bba310a4af";
const playerId = "player-1";

test("registry resolves exact versions and rejects duplicate definitions", () => {
  const registry = new GameRegistry();
  const definition = { slug: "test-game", version: "1.0.0", validateConfiguration: (value: Readonly<Record<string, unknown>>) => value, createEngine: () => engine };
  registry.register(definition);
  assert.equal(registry.require("test-game", "1.0.0"), definition);
  assert.throws(() => registry.register(definition), /already registered/u);
  assert.equal(registry.has("test-game", "2.0.0"), false);
});

test("protocol parser rejects malformed and unsupported messages", () => {
  assert.throws(() => parseGameInput({ protocolVersion: 2, type: "GAME_INPUT" }), (error: unknown) => error instanceof GameProtocolError && error.code === "INVALID_GAME_INPUT");
  assert.equal(parseGameInput({ protocolVersion: 1, type: "GAME_INPUT", sessionId, commandId, sequence: 1, payload: { action: "MOVE" } }).sequence, 1);
});

test("runtime enforces ownership, strict sequence, replay protection, and input rate", async () => {
  const store = new InMemoryActiveSessionStore();
  await store.set(makeSession());
  const runtime = new GameRuntime(store, 25);
  const message = parseGameInput({ protocolVersion: 1, type: "GAME_INPUT", sessionId, commandId, sequence: 1, payload: {} });
  await assert.rejects(runtime.handleInput("other-player", message), code("INVALID_SESSION"));
  assert.equal((await runtime.handleInput(playerId, message, new Date(100))).type, "GAME_STATE");
  await assert.rejects(runtime.handleInput(playerId, message, new Date(200)), code("REPLAYED_SEQUENCE"));
  const second = parseGameInput({ ...message, commandId: "ae864e86-c10b-469d-bde9-2bc4723d7e5d", sequence: 2 });
  await assert.rejects(runtime.handleInput(playerId, second, new Date(110)), code("RATE_LIMITED"));
  assert.equal((await runtime.handleInput(playerId, second, new Date(130))).type, "GAME_STATE");
});

test("concurrent inputs are serialized before sequence validation", async () => {
  const store = new InMemoryActiveSessionStore();
  await store.set(makeSession());
  const runtime = new GameRuntime(store, 0);
  const first = parseGameInput({ protocolVersion: 1, type: "GAME_INPUT", sessionId, commandId, sequence: 1, payload: {} });
  const second = parseGameInput({ ...first, commandId: "ae864e86-c10b-469d-bde9-2bc4723d7e5d", sequence: 1 });
  const results = await Promise.allSettled([runtime.handleInput(playerId, first), runtime.handleInput(playerId, second)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
});

test("durable lifecycle is terminal and uses optimistic state versions", async () => {
  const received: Parameters<GameSessionPersistence["transition"]>[0][] = [];
  const persistence: GameSessionPersistence = { transition: async (input) => { received.push(input); return { id: input.sessionId, status: input.to, stateVersion: input.expectedStateVersion + 1, gameId: "game-1", gameVersion: "1.0.0", ownerAccountId: playerId }; } };
  const lifecycle = new GameSessionLifecycle(persistence, "game-server-1");
  const active = await lifecycle.transition({ id: sessionId, status: "CREATED", stateVersion: 0, gameId: "game-1", gameVersion: "1.0.0", ownerAccountId: playerId }, "ACTIVE");
  assert.equal(received[0]?.expectedStateVersion, 0);
  assert.equal(received[0]?.serverInstanceId, "game-server-1");
  await assert.rejects(lifecycle.transition({ ...active, status: "COMPLETED" }, "ACTIVE"), (error: unknown) => error instanceof SessionLifecycleError && error.code === "INVALID_SESSION_TRANSITION");
});

const engine: ActiveGameEngine = { handleInput: async () => ({ publicState: { ok: true }, events: [], complete: false }), complete: async () => ({ publicState: { ok: true }, events: [], complete: true, authoritativeResult: { score: 0 } }), getPublicState: () => ({ ok: true }) };
function makeSession(): ActiveGameSession { return { id: sessionId, participantIds: new Set([playerId]), engine, lastSequenceByParticipant: new Map(), processedCommandIds: new Set(), lastInputAtByParticipant: new Map(), onComplete: async () => undefined }; }
function code(expected: string) { return (error: unknown) => error instanceof GameProtocolError && error.code === expected; }
