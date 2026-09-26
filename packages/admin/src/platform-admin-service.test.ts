import assert from "node:assert/strict";
import { test } from "node:test";
import { PlatformAdminError, PlatformAdminService, type AdminGameRecord, type PlatformAdminRepository } from "./platform-admin-service.js";

const now = new Date("2026-08-25T12:00:00.000Z");
const game: AdminGameRecord = { id: "game-1", slug: "neon-reels", name: "Neon Reels", status: "ACTIVE", gameType: "SINGLE_PLAYER", version: "1.0.0", configurationRevision: 1, minimumEntry: 10n, maximumEntry: 5_000n, configuration: { wagerDenominationsCents: [10, 50, 100] }, updatedAt: now };
class Repository implements PlatformAdminRepository {
  public constructor(public current: AdminGameRecord = game) {}
  public revision: Parameters<PlatformAdminRepository["createConfigurationRevision"]>[0] | null = null;
  public status: Parameters<PlatformAdminRepository["setGameStatus"]>[0] | null = null;
  public async listGames() { return [this.current]; } public async listGameSessions() { return []; } public async listSecurityEvents() { return []; } public async getPlayerDetail() { return null; }
  public async setGameStatus(input: Parameters<PlatformAdminRepository["setGameStatus"]>[0]) { this.status = input; return game; }
  public async createConfigurationRevision(input: Parameters<PlatformAdminRepository["createConfigurationRevision"]>[0]) { this.revision = input; return { ...game, configurationRevision: 2 }; }
}
const admin = { accountId: "admin-1", type: "ADMIN" as const, permissions: new Set(["GAME_VIEW", "GAME_MANAGE", "SECURITY_VIEW", "PLAYER_VIEW"]) };
const player = { accountId: "player-1", type: "PLAYER" as const, permissions: new Set<string>() };
const valid = (_slug: string, _version: string, configuration: Readonly<Record<string, unknown>>) => configuration;

test("configuration changes create a validated revision with audit context", async () => {
  const repository = new Repository();
  const result = await new PlatformAdminService(repository, valid, { now: () => now }).updateConfiguration(admin, { gameId: game.id, minimumEntry: "20", maximumEntry: "200", configuration: { durationMs: 30_000 }, reason: "Tune difficulty", ipAddress: "127.0.0.1", userAgent: null });
  assert.equal(result.configurationRevision, 2); assert.equal(repository.revision?.minimumEntry, 20n); assert.equal(repository.revision?.audit.adminId, "admin-1");
});
test("invalid entry ranges are rejected before persistence", async () => {
  await assert.rejects(new PlatformAdminService(new Repository(), valid).updateConfiguration(admin, { gameId: game.id, minimumEntry: "200", maximumEntry: "100", configuration: {}, reason: "Bad range", ipAddress: "127.0.0.1", userAgent: null }), (error: unknown) => error instanceof PlatformAdminError && error.code === "INVALID_REQUEST");
});
test("players cannot inspect platform administration data", async () => {
  assert.throws(() => new PlatformAdminService(new Repository(), valid).listGames(player), (error: unknown) => error instanceof PlatformAdminError && error.code === "ACCESS_DENIED");
});

const minesConfig = { maximumPayoutCents: 50_000, wagerDenominationsCents: [10, 25, 50, 100, 200, 500], difficulties: {
  EASY: { mines: 3, maximumWagerCents: 500 }, MEDIUM: { mines: 5, maximumWagerCents: 500 },
  HARD: { mines: 10, maximumWagerCents: 200 }, EXPERT: { mines: 15, maximumWagerCents: 100 }
} };
const mines: AdminGameRecord = { ...game, slug: "neon-mines", maximumEntry: 500n, configuration: minesConfig };
const change = { gameId: game.id, minimumEntry: "10", maximumEntry: "500", configuration: minesConfig, reason: "Adjust payout reserve", ipAddress: "127.0.0.1", userAgent: null };

test("Mines limits preserve a playable wager for each difficulty and reject insufficient liability caps", async () => {
  for (const patch of [{ maximumEntry: "0" }, { minimumEntry: "11" }, { minimumEntry: "200" },
    { configuration: { ...minesConfig, maximumPayoutCents: 599 } }]) {
    const repository = new Repository(mines);
    await assert.rejects(new PlatformAdminService(repository, valid).updateConfiguration(admin, { ...change, ...patch }),
      (error: unknown) => error instanceof PlatformAdminError && error.code === "INVALID_REQUEST");
    assert.equal(repository.revision, null);
  }
});

test("Mines accepts the exact first-payout boundary and a reduced wager/cap revision", async () => {
  for (const [maximumEntry, maximumPayoutCents] of [["500", 600], ["10", 25]] as const) {
    const repository = new Repository(mines);
    await new PlatformAdminService(repository, valid).updateConfiguration(admin, { ...change, maximumEntry, configuration: { ...minesConfig, maximumPayoutCents } });
    assert.equal(repository.revision?.maximumEntry, BigInt(maximumEntry));
    assert.equal(repository.revision?.configuration.maximumPayoutCents, maximumPayoutCents);
    assert.equal(repository.revision?.audit.reason, change.reason);
  }
});

test("Mines activation validates saved limits; maintenance and disable remain available", async () => {
  const repository = new Repository({ ...mines, configuration: { ...minesConfig, maximumPayoutCents: 25 } });
  const service = new PlatformAdminService(repository, valid);
  await assert.rejects(service.setGameStatus(admin, { ...change, status: "ACTIVE" }), PlatformAdminError);
  assert.equal(Boolean(repository.status === null), true);
  for (const status of ["MAINTENANCE", "DISABLED"] as const) {
    await service.setGameStatus(admin, { ...change, status });
    assert.equal(repository.status?.status, status);
  }
});

test("Mines configuration and status writes require GAME_MANAGE", async () => {
  const viewer = { ...admin, permissions: new Set(["GAME_VIEW"]) };
  const repository = new Repository(mines);
  const service = new PlatformAdminService(repository, valid);
  await assert.rejects(service.updateConfiguration(viewer, change), (error: unknown) => error instanceof PlatformAdminError && error.code === "ACCESS_DENIED");
  await assert.rejects(service.setGameStatus(viewer, { ...change, status: "ACTIVE" }), (error: unknown) => error instanceof PlatformAdminError && error.code === "ACCESS_DENIED");
  assert.equal(repository.status, null); assert.equal(repository.revision, null);
});
