import assert from "node:assert/strict";
import { test } from "node:test";
import { PlatformAdminError, PlatformAdminService, type AdminGameRecord, type PlatformAdminRepository } from "./platform-admin-service.js";

const now = new Date("2026-08-25T12:00:00.000Z");
const game: AdminGameRecord = { id: "game-1", slug: "neon-reels", name: "Neon Reels", status: "ACTIVE", gameType: "SINGLE_PLAYER", version: "1.0.0", configurationRevision: 1, minimumEntry: 10n, maximumEntry: 5_000n, configuration: { wagerDenominationsCents: [10, 50, 100] }, updatedAt: now };
class Repository implements PlatformAdminRepository {
  public revision: Parameters<PlatformAdminRepository["createConfigurationRevision"]>[0] | null = null;
  public status: Parameters<PlatformAdminRepository["setGameStatus"]>[0] | null = null;
  public async listGames() { return [game]; } public async listGameSessions() { return []; } public async listSecurityEvents() { return []; } public async getPlayerDetail() { return null; }
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
