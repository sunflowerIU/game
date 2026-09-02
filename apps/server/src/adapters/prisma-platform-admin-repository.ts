import { PlatformAdminError, type AdminGameRecord, type AdminGameSessionRecord, type AuditContext, type ManagedGameStatus, type PlatformAdminRepository, type PlayerDetailRecord, type SecurityEventRecord } from "@game-platform/admin";
import type { DatabaseClient, Prisma } from "@game-platform/database";

export class PrismaPlatformAdminRepository implements PlatformAdminRepository {
  public constructor(private readonly database: DatabaseClient) {}
  public async listGames(limit: number): Promise<readonly AdminGameRecord[]> {
    const games = await this.database.game.findMany({ orderBy: [{ name: "asc" }, { id: "asc" }], take: limit, include: { activeVersion: true } });
    return games.map(toGame);
  }
  public async setGameStatus(input: { readonly gameId: string; readonly status: ManagedGameStatus; readonly audit: AuditContext }): Promise<AdminGameRecord | null> {
    return this.database.$transaction(async (tx) => {
      const existing = await tx.game.findUnique({ where: { id: input.gameId }, include: { activeVersion: true } });
      if (existing === null) return null;
      if (existing.status === input.status) return toGame(existing);
      if (input.status === "ACTIVE" && existing.activeVersion === null) throw new PlatformAdminError("INVALID_REQUEST", "A game needs an active configuration before it can be activated");
      const updated = await tx.game.update({ where: { id: existing.id }, data: { status: input.status }, include: { activeVersion: true } });
      await tx.adminAuditLog.create({ data: { ...auditData(input.audit), action: "GAME_STATUS_CHANGED", targetType: "GAME", targetGameId: existing.id, before: { status: existing.status }, after: { status: updated.status } } });
      return toGame(updated);
    });
  }
  public async createConfigurationRevision(input: { readonly gameId: string; readonly minimumEntry: bigint; readonly maximumEntry: bigint; readonly configuration: Readonly<Record<string, unknown>>; readonly audit: AuditContext }): Promise<AdminGameRecord | null> {
    try {
      return await this.database.$transaction(async (tx) => {
        const game = await tx.game.findUnique({ where: { id: input.gameId }, include: { activeVersion: true } });
        if (game === null || game.activeVersion === null) return null;
        const previous = game.activeVersion;
        const version = await tx.gameVersion.create({ data: { gameId: game.id, version: previous.version, configurationRevision: previous.configurationRevision + 1, minimumEntry: input.minimumEntry, maximumEntry: input.maximumEntry, configuration: input.configuration as Prisma.InputJsonObject } });
        const updated = await tx.game.update({ where: { id: game.id }, data: { activeVersionId: version.id }, include: { activeVersion: true } });
        await tx.adminAuditLog.create({ data: { ...auditData(input.audit), action: "GAME_CONFIG_UPDATED", targetType: "GAME", targetGameId: game.id, before: versionSnapshot(previous), after: versionSnapshot(version) } });
        return toGame(updated);
      });
    } catch (error: unknown) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") throw new PlatformAdminError("CONFLICT", "Game configuration changed concurrently; reload and retry");
      throw error;
    }
  }
  public async listGameSessions(limit: number): Promise<readonly AdminGameSessionRecord[]> {
    const rows = await this.database.gameSession.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, include: { owner: true, game: true, version: true, result: true } });
    return rows.map(toSession);
  }
  public async listSecurityEvents(limit: number): Promise<readonly SecurityEventRecord[]> {
    const rows = await this.database.securityEvent.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, include: { account: { select: { username: true } } } });
    return rows.map((row) => ({ id: row.id.toString(), type: row.type, severity: row.severity, username: row.account?.username ?? null, gameSessionId: row.gameSessionId, ipAddress: row.ipAddress, metadata: row.metadata, createdAt: row.createdAt }));
  }
  public async getPlayerDetail(playerId: string): Promise<PlayerDetailRecord | null> {
    const row = await this.database.account.findFirst({ where: { id: playerId, type: "PLAYER" }, include: {
      playerProfile: true,
      wallet: { include: { ledgerEntries: { orderBy: { createdAt: "desc" }, take: 25 } } }, loginEvents: { orderBy: { createdAt: "desc" }, take: 25 },
      ownedGameSessions: { orderBy: { createdAt: "desc" }, take: 25, include: { owner: true, game: true, version: true, result: true } }
    } });
    if (row === null || row.wallet === null || row.playerProfile === null) return null;
    return {
      player: { id: row.id, username: row.username, status: row.status, balance: row.wallet.balance, lastLoginAt: row.playerProfile.lastLoginAt, createdAt: row.createdAt, updatedAt: row.updatedAt },
      loginEvents: row.loginEvents.map((event) => ({ outcome: event.outcome, ipAddress: event.ipAddress, createdAt: event.createdAt })),
      ledgerEntries: row.wallet.ledgerEntries.map((entry) => ({ id: entry.id, type: entry.type, amount: entry.amount, balanceAfter: entry.balanceAfter, reason: metadataReason(entry.metadata), createdAt: entry.createdAt })),
      gameSessions: row.ownedGameSessions.map(toSession)
    };
  }
}

function toGame(game: { id: string; slug: string; name: string; status: ManagedGameStatus; gameType: "SINGLE_PLAYER" | "MULTIPLAYER"; updatedAt: Date; activeVersion: null | { version: string; configurationRevision: number; minimumEntry: bigint; maximumEntry: bigint; configuration: unknown } }): AdminGameRecord {
  if (game.activeVersion === null) throw new PlatformAdminError("INVALID_REQUEST", `Game ${game.slug} has no active configuration`);
  return { id: game.id, slug: game.slug, name: game.name, status: game.status, gameType: game.gameType, version: game.activeVersion.version, configurationRevision: game.activeVersion.configurationRevision, minimumEntry: game.activeVersion.minimumEntry, maximumEntry: game.activeVersion.maximumEntry, configuration: jsonObject(game.activeVersion.configuration), updatedAt: game.updatedAt };
}
function toSession(row: { id: string; gameVersion: string; status: string; entryAmount: bigint; startedAt: Date | null; completedAt: Date | null; owner: { username: string }; game: { slug: string }; version: { configurationRevision: number }; result: { score: number; reward: bigint } | null }): AdminGameSessionRecord {
  return { id: row.id, username: row.owner.username, gameSlug: row.game.slug, gameVersion: row.gameVersion, configurationRevision: row.version.configurationRevision, status: row.status, entryAmount: row.entryAmount, score: row.result?.score ?? null, reward: row.result?.reward ?? null, startedAt: row.startedAt, completedAt: row.completedAt };
}
function auditData(audit: AuditContext) { return { adminId: audit.adminId, reason: audit.reason, ipAddress: audit.ipAddress, userAgent: audit.userAgent, createdAt: audit.occurredAt } as const; }
function versionSnapshot(version: { version: string; configurationRevision: number; minimumEntry: bigint; maximumEntry: bigint; configuration: unknown }): Prisma.InputJsonObject { return { version: version.version, configurationRevision: version.configurationRevision, minimumEntry: version.minimumEntry.toString(), maximumEntry: version.maximumEntry.toString(), configuration: version.configuration as Prisma.InputJsonValue }; }
function jsonObject(value: unknown): Readonly<Record<string, unknown>> { if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Game configuration must be a JSON object"); return value as Readonly<Record<string, unknown>>; }
function metadataReason(value: unknown): string | null { if (typeof value !== "object" || value === null || Array.isArray(value)) return null; const reason = (value as Record<string, unknown>).reason; return typeof reason === "string" ? reason : null; }
