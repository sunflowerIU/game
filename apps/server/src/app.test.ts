import assert from "node:assert/strict";
import { after, test } from "node:test";

import { buildApp } from "./app.js";
import { WalletEventBroker } from "./wallet-events.js";
import { NeonMinesEngine } from "@game-platform/neon-mines";
import { NeonMinesError } from "./adapters/prisma-neon-mines-repository.js";
import type { NeonDiceSelection, NeonMinesCommandRequest } from "@game-platform/contracts";
import type { ServerConfig } from "./config.js";

const authenticatedPrincipal = {
  accountId: "fa05dfb8-e4e3-49f6-bd92-50d086b28294",
  username: "TestAdmin",
  type: "ADMIN" as const,
  permissions: new Set(["SECURITY_VIEW", "WALLET_CREDIT"]),
  sessionId: "session-1"
};
const cleanupAdminPrincipal = { ...authenticatedPrincipal, permissions: new Set(["PLAYER_DELETE", "DATA_RETENTION_MANAGE"]) };
const playerPrincipal = { accountId: "5fdb5ce8-a3c9-41f7-bd25-4072f67123e1", username: "TestPlayer", type: "PLAYER" as const, permissions: new Set<string>(), sessionId: "session-2" };
let receivedPasswordChange: { currentPassword: string; newPassword: string } | null = null;

const auth = {
  login: async () => ({
    account: {
      id: authenticatedPrincipal.accountId,
      username: authenticatedPrincipal.username,
      type: authenticatedPrincipal.type
    },
    sessionToken: "A".repeat(43),
    expiresAt: new Date("2026-08-25T12:00:00.000Z")
  }),
  authenticate: async (token: string | undefined) => {
    if (token === undefined) {
      const { AuthError } = await import("@game-platform/auth");
      throw new AuthError("AUTH_REQUIRED", "Authentication required");
    }
    return token.startsWith("B") ? playerPrincipal : token.startsWith("C") ? cleanupAdminPrincipal : authenticatedPrincipal;
  },
  logout: async () => undefined,
  changePassword: async (_principal: unknown, input: { currentPassword: string; newPassword: string }) => { receivedPasswordChange = input; }
};

const admin = {
  listPlayers: async () => [],
  listAuditLogs: async () => [],
  createPlayer: async () => { throw new Error("not used"); },
  setPlayerEnabled: async () => { throw new Error("not used"); },
  resetPassword: async () => undefined,
  previewPlayerDeletion: async (_principal: unknown, input: { playerId: string }) => ({ playerId: input.playerId, username: "DeleteMe", status: "DISABLED" as const, balance: 25n, activeGameSessions: 0, counts: cleanupCounts }),
  deletePlayer: async (_principal: unknown, input: { playerId: string }) => ({ cleanupRunId: "b7f34c87-5bd5-4ab2-9610-f638c4c27a5a", playerId: input.playerId, username: "DeleteMe", balanceDeleted: 25n, counts: cleanupCounts }),
  previewPlayerRecordCleanup: async (_principal: unknown, input: { playerId: string; retentionDays: number }) => ({ playerId: input.playerId, username: "DeleteMe", retentionDays: input.retentionDays, cutoffAt: new Date("2026-07-26T10:00:00.000Z"), counts: cleanupCounts }),
  deletePlayerRecords: async (_principal: unknown, input: { playerId: string; retentionDays: number }) => ({ cleanupRunId: "3528064d-6749-4270-be00-57a31d2cbbda", playerId: input.playerId, username: "DeleteMe", retentionDays: input.retentionDays, cutoffAt: new Date("2026-07-26T10:00:00.000Z"), counts: cleanupCounts }),
  previewInactivePlayerCleanup: async (_principal: unknown, input: { inactivityDays: number; includePositiveBalances: boolean }) => ({ ...input, cutoffAt: new Date("2026-07-26T10:00:00.000Z"), inactivePlayers: 8, activeSessionPlayers: 1, positiveBalancePlayers: 2, positiveBalanceTotal: 75n, deletablePlayers: input.includePositiveBalances ? 7 : 5 }),
  deleteInactivePlayerBatch: async (_principal: unknown, input: { inactivityDays: number; includePositiveBalances: boolean; batchSize: number }) => ({ cleanupRunId: "7a226aab-239e-48f7-8e75-e50cf890c25d", ...input, cutoffAt: new Date("2026-07-26T10:00:00.000Z"), deletedPlayers: 5, deletedBalance: 0n, deletedRecords: cleanupCounts, remainingPlayers: 0 }),
  previewSessionCleanup: async (_principal: unknown, input: { retentionDays: number }) => ({ ...input, cutoffAt: new Date("2026-07-26T10:00:00.000Z"), counts: sessionCleanupCounts }),
  deleteSessionBatch: async (_principal: unknown, input: { retentionDays: number; batchSize: number }) => ({ cleanupRunId: "3ea70922-a400-4878-a355-7022bc06f32d", ...input, cutoffAt: new Date("2026-07-26T10:00:00.000Z"), counts: sessionCleanupCounts, remaining: { ...sessionCleanupCounts, authSessions: 0, gameSessions: 0 } })
};

const cleanupCounts = { authSessions: 1, loginEvents: 2, securityEvents: 3, ownedGameSessions: 4, gameParticipations: 4, gameResults: 4, ledgerEntries: 5, adminAuditLogs: 6 };
const sessionCleanupCounts = { authSessions: 5, gameSessions: 4, gameParticipations: 4, gameResults: 4, securityEvents: 3 };

let receivedIdempotencyKey: string | null = null;
const walletRecord = { accountId: "5fdb5ce8-a3c9-41f7-bd25-4072f67123e1", balance: 10n, version: 1, updatedAt: new Date("2026-08-25T10:00:00.000Z") };
const ledgerRecord = { id: "6b37e9d2-5038-442f-9e2e-a0ff9e1e5204", type: "ADMIN_DEPOSIT" as const, amount: 10n, balanceBefore: 0n, balanceAfter: 10n, referenceType: "ADMIN_ADJUSTMENT", referenceId: authenticatedPrincipal.accountId, createdAt: new Date("2026-08-25T10:00:00.000Z") };
const wallet = {
  getOwnWallet: async () => walletRecord,
  listOwnEntries: async () => [ledgerRecord],
  credit: async (_principal: unknown, input: { idempotencyKey: string }) => { receivedIdempotencyKey = input.idempotencyKey; return { wallet: walletRecord, entry: ledgerRecord, replayed: false }; },
  debit: async () => { throw new Error("not used"); }
};
const catalogGame = {
  id: "f41f6329-b3db-4531-922b-c7ec4c54e17e", slug: "neon-dice", name: "Neon Dice", status: "ACTIVE" as const,
  gameType: "SINGLE_PLAYER" as const, version: "1.0.0", minimumEntry: 50n, maximumEntry: 3_000n,
  configuration: { wagerDenominationsCents: [50, 100, 200, 500, 1_000, 2_000, 3_000], maximumPayoutCents: 20_000 }
};
const gameCatalog = { listGames: async () => [catalogGame] };
const receivedGameStarts: { entryAmount: bigint; idempotencyKey: string; selection?: NeonDiceSelection }[] = [];
const gameSession = { id: "2c84e3d5-4ba7-49ec-9c57-70ea25f30131", gameId: "d9ab8c9e-c72f-4c87-b6eb-e61267269b61", gameVersion: "1.0.0", status: "COMPLETED" as const, entryAmount: 10n, startedAt: new Date("2026-08-25T10:00:00.000Z"), completedAt: new Date("2026-08-25T10:00:00.000Z"), score: 0, reward: 0n };
const receivedMinesCommands: NeonMinesCommandRequest[] = [];
const gameSessions = {
  start: async (_principal: unknown, input: { entryAmount: bigint; idempotencyKey: string }) => { receivedGameStarts.push(input); return { session: gameSession, publicState: { status: "COMPLETED" }, replayed: false, nextSequence: 1 }; }, history: async () => [], resume: async () => null,
  command: async (_principal: unknown, _sessionId: string, input: NeonMinesCommandRequest) => {
    if (input.sequence !== 1) throw new NeonMinesError("REPLAYED_SEQUENCE", "Unexpected sequence");
    receivedMinesCommands.push(input);
    return { session: gameSession, publicState: new NeonMinesEngine(100n, "EASY").getPublicState(), replayed: false, nextSequence: 2, acceptedSequence: 1, expiresAt: "2026-09-03T12:00:00.000Z" };
  }
};
const platformAdmin = {
  listGames: async () => [], listGameSessions: async () => [], listSecurityEvents: async () => [],
  getPlayerDetail: async () => { throw new Error("not used"); }, setGameStatus: async () => { throw new Error("not used"); }, updateConfiguration: async () => { throw new Error("not used"); }
};
const walletEvents = new WalletEventBroker();
let publishedWalletBalance: string | null = null;
walletEvents.subscribe(walletRecord.accountId, (event) => { publishedWalletBalance = event.wallet.balance; });

const serverConfig: ServerConfig = {
  databaseUrl: "postgresql://unused",
  host: "127.0.0.1",
  logLevel: "silent",
  nodeEnv: "test",
  port: 4_000,
  trustProxy: false,
  webOrigin: "http://localhost:3000"
};
const applicationDependencies = {
  admin,
  platformAdmin,
  auth,
  wallet,
  gameCatalog,
  gameSessions,
  walletEvents,
  readinessCheck: async () => undefined
};
const app = buildApp(serverConfig, applicationDependencies);

after(async () => app.close());

test("Mines HTTP command contract authenticates, validates without coercion, and maps conflicts", async () => {
  const path = `/api/v1/game-sessions/${gameSession.id}/commands`;
  const headers = { cookie: `gp_session=${"B".repeat(43)}` };
  const payload = { commandId: "f37c3630-9256-48b6-a21d-02a52ced952d", sequence: 1, payload: { action: "SELECT_TILE", tile: 3 } };
  assert.equal((await app.inject({ method: "POST", url: path, payload })).statusCode, 401);
  for (const body of [{ ...payload, sequence: "1" }, { ...payload, mineTiles: [0] }, { ...payload, payload: { action: "CASH_OUT", reward: 999 } }]) {
    assert.equal((await app.inject({ method: "POST", url: path, headers, payload: body })).statusCode, 400);
  }
  const accepted = await app.inject({ method: "POST", url: path, headers, payload });
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.json().acceptedSequence, 1);
  assert.deepEqual(accepted.json().publicState.revealedMines, []);
  assert.equal(receivedMinesCommands.length, 1);
  assert.equal((await app.inject({ method: "POST", url: path, headers, payload: { ...payload, sequence: 2 } })).statusCode, 409);
});

test("Mines start rejects tampering and preserves typed difficulty", async () => {
  const url = `/api/v1/games/${gameSession.gameId}/sessions`;
  const headers = { cookie: `gp_session=${"B".repeat(43)}`, "idempotency-key": "mines-start-00000001" };
  const payload = { entryAmount: 100, difficulty: "HARD" };
  for (const body of [{ ...payload, entryAmount: "100" }, { ...payload, difficulty: "unknown" }, { ...payload, mineTiles: [] }]) {
    assert.equal((await app.inject({ method: "POST", url, headers, payload: body })).statusCode, 400);
  }
  const response = await app.inject({ method: "POST", url, headers, payload });
  assert.equal(response.statusCode, 200);
  assert.equal((receivedGameStarts.at(-1) as { difficulty?: string }).difficulty, "HARD");
});

test("Dice start accepts only an exact wager and selection contract", async () => {
  const url = `/api/v1/games/${gameSession.gameId}/sessions`;
  const headers = { cookie: `gp_session=${"B".repeat(43)}`, "idempotency-key": "dice-start-00000001" };
  const payload = { entryAmount: 500, selection: "EXACTLY_7" };
  for (const body of [
    { ...payload, entryAmount: "500" },
    { ...payload, selection: "SEVEN" },
    { ...payload, dice: [3, 4] },
    { ...payload, reward: 2_850 },
    { ...payload, difficulty: "EASY" }
  ]) assert.equal((await app.inject({ method: "POST", url, headers, payload: body })).statusCode, 400);

  const response = await app.inject({ method: "POST", url, headers, payload });
  assert.equal(response.statusCode, 200);
  assert.equal(receivedGameStarts.at(-1)?.entryAmount, 500n);
  assert.equal(receivedGameStarts.at(-1)?.selection, "EXACTLY_7");
});

test("liveness endpoint returns only public health data", async () => {
  const response = await app.inject({ method: "GET", url: "/health/live" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(Object.keys(response.json()).sort(), ["service", "status", "timestamp"]);
  assert.equal(response.json().status, "ok");
});

test("readiness returns 503 when a required dependency is unavailable", async () => {
  const unavailable = buildApp(serverConfig, { ...applicationDependencies, readinessCheck: async () => { throw new Error("missing schema"); } });
  const response = await unavailable.inject({ method: "GET", url: "/health/ready" });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error.code, "NOT_READY");
  assert.doesNotMatch(response.body, /missing schema/u);
  await unavailable.close();
});

test("platform endpoint exposes the versioned browser contract", async () => {
  const response = await app.inject({ method: "GET", url: "/api/v1/platform/status" });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().apiVersion, "1");
  assert.equal(response.json().service, "game-platform-api");
});

test("internal metrics expose process health without application secrets", async () => {
  await app.inject({ method: "GET", url: "/health/live" });
  const response = await app.inject({ method: "GET", url: "/internal/metrics" });
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /game_platform_http_requests_total/u);
  assert.match(response.body, /game_platform_http_request_duration_milliseconds_bucket\{le="50"\}/u);
  assert.match(response.body, /game_platform_spin_request_duration_milliseconds_bucket/u);
  assert.doesNotMatch(response.body, /DATABASE_URL|password|token/iu);
});

test("CORS allows the configured web origin", async () => {
  const response = await app.inject({
    method: "OPTIONS",
    url: "/api/v1/platform/status",
    headers: {
      origin: "http://localhost:3000",
      "access-control-request-method": "GET"
    }
  });

  assert.equal(response.statusCode, 204);
  assert.equal(response.headers["access-control-allow-origin"], "http://localhost:3000");
});

test("login keeps the opaque token out of the response body and in an HttpOnly cookie", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { username: "TestAdmin", password: "a password entered by the user" }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().sessionToken, undefined);
  const setCookie = response.headers["set-cookie"];
  assert.match(Array.isArray(setCookie) ? setCookie.join("; ") : setCookie ?? "", /gp_session=.*HttpOnly.*SameSite=Strict/u);
});

test("me rejects requests without a session cookie", async () => {
  const response = await app.inject({ method: "GET", url: "/api/v1/me" });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, "AUTH_REQUIRED");
});

test("me returns the centrally resolved principal", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/me",
    headers: { cookie: `gp_session=${"A".repeat(43)}` }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().permissions, ["SECURITY_VIEW", "WALLET_CREDIT"]);
});

test("authenticated players can change their password and the session cookie is cleared", async () => {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/password", headers: { cookie: `gp_session=${"B".repeat(43)}` }, payload: { currentPassword: "old-password", newPassword: "new-password" } });
  assert.equal(response.statusCode, 204);
  assert.deepEqual(receivedPasswordChange, { currentPassword: "old-password", newPassword: "new-password" });
  const setCookie = response.headers["set-cookie"];
  assert.match(Array.isArray(setCookie) ? setCookie.join("; ") : setCookie ?? "", /gp_session=;.*Expires=/u);
});

test("admin routes enforce specific permissions centrally", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/admin/players",
    headers: { cookie: `gp_session=${"A".repeat(43)}` }
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, "ACCESS_DENIED");
});

test("audit history uses the dedicated security permission", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/admin/audit-logs",
    headers: { cookie: `gp_session=${"A".repeat(43)}` }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { auditLogs: [] });
});

test("player deletion preview serializes balances and requires its dedicated permission", async () => {
  const denied = await app.inject({
    method: "POST",
    url: "/api/v1/admin/players/5fdb5ce8-a3c9-41f7-bd25-4072f67123e1/deletion-preview",
    headers: { cookie: `gp_session=${"A".repeat(43)}` }
  });
  assert.equal(denied.statusCode, 403);

  const allowed = await app.inject({
    method: "POST",
    url: "/api/v1/admin/players/5fdb5ce8-a3c9-41f7-bd25-4072f67123e1/deletion-preview",
    headers: { cookie: `gp_session=${"C".repeat(43)}` }
  });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.json().balance, "25");
  assert.equal(allowed.json().counts.ledgerEntries, 5);
});

test("unsupported request media types remain client errors", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/admin/players/5fdb5ce8-a3c9-41f7-bd25-4072f67123e1/deletion-preview",
    headers: {
      cookie: `gp_session=${"C".repeat(43)}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    payload: ""
  });

  assert.equal(response.statusCode, 415);
  assert.equal(response.json().error.code, "INVALID_REQUEST");
});

test("record cleanup validates retention days and requires idempotency for deletion", async () => {
  const invalidPreview = await app.inject({
    method: "POST",
    url: "/api/v1/admin/players/5fdb5ce8-a3c9-41f7-bd25-4072f67123e1/records/deletion-preview",
    headers: { cookie: `gp_session=${"C".repeat(43)}` },
    payload: { retentionDays: 0 }
  });
  assert.equal(invalidPreview.statusCode, 400);

  const missingKey = await app.inject({
    method: "POST",
    url: "/api/v1/admin/players/5fdb5ce8-a3c9-41f7-bd25-4072f67123e1/records/delete",
    headers: { cookie: `gp_session=${"C".repeat(43)}` },
    payload: { retentionDays: 30, reason: "Remove expired history" }
  });
  assert.equal(missingKey.statusCode, 400);

  const deleted = await app.inject({
    method: "POST",
    url: "/api/v1/admin/players/5fdb5ce8-a3c9-41f7-bd25-4072f67123e1/records/delete",
    headers: { cookie: `gp_session=${"C".repeat(43)}`, "idempotency-key": "records-cleanup-test-01" },
    payload: { retentionDays: 30, reason: "Remove expired history" }
  });
  assert.equal(deleted.statusCode, 200);
  assert.equal(deleted.json().retentionDays, 30);
  assert.equal(deleted.json().cutoffAt, "2026-07-26T10:00:00.000Z");
});

test("inactive-player cleanup previews exclusions and executes only bounded idempotent batches", async () => {
  const preview = await app.inject({
    method: "POST",
    url: "/api/v1/admin/players/inactive-deletion-preview",
    headers: { cookie: `gp_session=${"C".repeat(43)}` },
    payload: { inactivityDays: 30, includePositiveBalances: false }
  });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.json().inactivePlayers, 8);
  assert.equal(preview.json().activeSessionPlayers, 1);
  assert.equal(preview.json().positiveBalanceTotal, "75");
  assert.equal(preview.json().deletablePlayers, 5);

  const invalidBatch = await app.inject({
    method: "POST",
    url: "/api/v1/admin/players/delete-inactive",
    headers: { cookie: `gp_session=${"C".repeat(43)}`, "idempotency-key": "inactive-cleanup-test-01" },
    payload: { inactivityDays: 30, includePositiveBalances: false, batchSize: 101, reason: "Remove inactive players" }
  });
  assert.equal(invalidBatch.statusCode, 400);

  const deleted = await app.inject({
    method: "POST",
    url: "/api/v1/admin/players/delete-inactive",
    headers: { cookie: `gp_session=${"C".repeat(43)}`, "idempotency-key": "inactive-cleanup-test-02" },
    payload: { inactivityDays: 30, includePositiveBalances: false, batchSize: 50, reason: "Remove inactive players" }
  });
  assert.equal(deleted.statusCode, 200);
  assert.equal(deleted.json().deletedPlayers, 5);
  assert.equal(deleted.json().remainingPlayers, 0);
});

test("session cleanup previews and deletes only bounded retention batches", async () => {
  const preview = await app.inject({ method: "POST", url: "/api/v1/admin/sessions/deletion-preview", headers: { cookie: `gp_session=${"C".repeat(43)}` }, payload: { retentionDays: 90 } });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.json().counts.authSessions, 5);
  assert.equal(preview.json().counts.gameSessions, 4);
  const invalid = await app.inject({ method: "POST", url: "/api/v1/admin/sessions/delete", headers: { cookie: `gp_session=${"C".repeat(43)}`, "idempotency-key": "session-cleanup-test-01" }, payload: { retentionDays: 90, batchSize: 1001, reason: "Remove old sessions" } });
  assert.equal(invalid.statusCode, 400);
  const deleted = await app.inject({ method: "POST", url: "/api/v1/admin/sessions/delete", headers: { cookie: `gp_session=${"C".repeat(43)}`, "idempotency-key": "session-cleanup-test-02" }, payload: { retentionDays: 90, batchSize: 500, reason: "Remove old sessions" } });
  assert.equal(deleted.statusCode, 200);
  assert.equal(deleted.json().batchSize, 500);
  assert.equal(deleted.json().counts.gameSessions, 4);
});

test("wallet adjustments require and forward an idempotency key", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/admin/players/5fdb5ce8-a3c9-41f7-bd25-4072f67123e1/wallet/credit",
    headers: { cookie: `gp_session=${"A".repeat(43)}`, "idempotency-key": "request-0000000001" },
    payload: { amount: 10, reason: "Support award" }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(receivedIdempotencyKey, "request-0000000001");
  assert.equal(response.json().wallet.balance, "10");
  assert.equal(publishedWalletBalance, "10");
});

test("wallet adjustments reject a missing idempotency key", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/admin/players/5fdb5ce8-a3c9-41f7-bd25-4072f67123e1/wallet/credit",
    headers: { cookie: `gp_session=${"A".repeat(43)}` },
    payload: { amount: 10, reason: "Support award" }
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "INVALID_REQUEST");
});

test("game catalog is authenticated and resolved by the backend", async () => {
  const response = await app.inject({ method: "GET", url: "/api/v1/games", headers: { cookie: `gp_session=${"A".repeat(43)}` } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { games: [{
    ...catalogGame,
    minimumEntry: "50",
    maximumEntry: "3000"
  }] });
});

test("paid game start requires idempotency and converts entry coins to bigint", async () => {
  const response = await app.inject({ method: "POST", url: `/api/v1/games/${gameSession.gameId}/sessions`, headers: { cookie: `gp_session=${"B".repeat(43)}`, "idempotency-key": "game-start-0000001" }, payload: { entryAmount: 10 } });
  assert.equal(response.statusCode, 200);
  assert.equal(receivedGameStarts.at(-1)?.entryAmount, 10n);
  assert.equal(receivedGameStarts.at(-1)?.idempotencyKey, "game-start-0000001");
  assert.equal(response.json().session.entryAmount, "10");
});

test("authenticated players receive an initial versioned wallet event", async () => {
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  const controller = new AbortController();
  const response = await fetch(`${origin}/api/v1/wallet/events`, {
    headers: { cookie: `gp_session=${"B".repeat(43)}` },
    signal: controller.signal
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/event-stream/u);
  const reader = response.body?.getReader();
  assert.notEqual(reader, undefined);
  const chunk = await reader?.read();
  const payload = new TextDecoder().decode(chunk?.value);
  assert.match(payload, /event: wallet/u);
  assert.match(payload, /"type":"wallet.updated"/u);
  assert.match(payload, /"version":1/u);
  controller.abort();
  await reader?.cancel().catch(() => undefined);
});
