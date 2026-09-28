import { hasPermission, type AdminPermission, type AuthorizedPrincipal } from "@game-platform/auth";
import type { AuditContext, PlayerRecord } from "./player-admin-service.js";

export type ManagedGameStatus = "ACTIVE" | "DISABLED" | "MAINTENANCE" | "DEPRECATED";

export interface AdminGameRecord {
  readonly id: string; readonly slug: string; readonly name: string; readonly status: ManagedGameStatus;
  readonly gameType: "SINGLE_PLAYER" | "MULTIPLAYER"; readonly version: string; readonly configurationRevision: number;
  readonly minimumEntry: bigint; readonly maximumEntry: bigint; readonly configuration: Readonly<Record<string, unknown>>; readonly updatedAt: Date;
}
export interface AdminGameSessionRecord {
  readonly id: string; readonly username: string; readonly gameSlug: string; readonly gameVersion: string; readonly configurationRevision: number;
  readonly status: string; readonly entryAmount: bigint; readonly score: number | null; readonly reward: bigint | null;
  readonly startedAt: Date | null; readonly completedAt: Date | null;
}
export interface SecurityEventRecord {
  readonly id: string; readonly type: string; readonly severity: string; readonly username: string | null;
  readonly gameSessionId: string | null; readonly ipAddress: string; readonly metadata: unknown; readonly createdAt: Date;
}
export interface PlayerDetailRecord {
  readonly player: PlayerRecord;
  readonly loginEvents: readonly { readonly outcome: string; readonly ipAddress: string; readonly createdAt: Date }[];
  readonly ledgerEntries: readonly { readonly id: string; readonly type: string; readonly amount: bigint; readonly balanceAfter: bigint; readonly reason: string | null; readonly createdAt: Date }[];
  readonly gameSessions: readonly AdminGameSessionRecord[];
}

export interface PlatformAdminRepository {
  listGames(limit: number): Promise<readonly AdminGameRecord[]>;
  setGameStatus(input: { readonly gameId: string; readonly status: ManagedGameStatus; readonly audit: AuditContext }): Promise<AdminGameRecord | null>;
  createConfigurationRevision(input: { readonly gameId: string; readonly minimumEntry: bigint; readonly maximumEntry: bigint; readonly configuration: Readonly<Record<string, unknown>>; readonly audit: AuditContext }): Promise<AdminGameRecord | null>;
  listGameSessions(limit: number): Promise<readonly AdminGameSessionRecord[]>;
  listSecurityEvents(limit: number): Promise<readonly SecurityEventRecord[]>;
  getPlayerDetail(playerId: string): Promise<PlayerDetailRecord | null>;
}

export class PlatformAdminError extends Error {
  public constructor(public readonly code: "ACCESS_DENIED" | "INVALID_REQUEST" | "GAME_NOT_FOUND" | "PLAYER_NOT_FOUND" | "CONFLICT", message: string) {
    super(message); this.name = "PlatformAdminError";
  }
}

export class PlatformAdminService {
  public constructor(
    private readonly repository: PlatformAdminRepository,
    private readonly configurationValidator: (slug: string, version: string, configuration: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>,
    private readonly clock: { now(): Date } = { now: () => new Date() }
  ) {}

  public listGames(principal: AuthorizedPrincipal) { requirePermission(principal, "GAME_VIEW"); return this.repository.listGames(100); }
  public listGameSessions(principal: AuthorizedPrincipal) { requirePermission(principal, "GAME_VIEW"); return this.repository.listGameSessions(100); }
  public listSecurityEvents(principal: AuthorizedPrincipal) { requirePermission(principal, "SECURITY_VIEW"); return this.repository.listSecurityEvents(100); }
  public async getPlayerDetail(principal: AuthorizedPrincipal, playerId: string): Promise<PlayerDetailRecord> {
    requirePermission(principal, "PLAYER_VIEW");
    const detail = await this.repository.getPlayerDetail(playerId);
    if (detail === null) throw new PlatformAdminError("PLAYER_NOT_FOUND", "Player not found");
    return detail;
  }
  public async setGameStatus(principal: AuthorizedPrincipal, input: { readonly gameId: string; readonly status: ManagedGameStatus; readonly reason: string; readonly ipAddress: string; readonly userAgent: string | null }): Promise<AdminGameRecord> {
    requirePermission(principal, "GAME_MANAGE");
    if (input.status === "ACTIVE") {
      const current = (await this.repository.listGames(100)).find((game) => game.id === input.gameId);
      if (current === undefined) throw new PlatformAdminError("GAME_NOT_FOUND", "Game not found");
      if (current.slug === "neon-mines" || current.slug === "neon-dice") {
        let configuration: Readonly<Record<string, unknown>>;
        try { configuration = this.configurationValidator(current.slug, current.version, current.configuration); }
        catch { throw new PlatformAdminError("INVALID_REQUEST", `Fix the ${current.name} configuration before enabling the game`); }
        if (current.slug === "neon-mines") validateMinesEntryLimits(current.minimumEntry, current.maximumEntry, configuration);
        else validateDiceEntryLimits(current.minimumEntry, current.maximumEntry, configuration);
      }
    }
    const game = await this.repository.setGameStatus({ gameId: input.gameId, status: input.status, audit: this.audit(principal, input) });
    if (game === null) throw new PlatformAdminError("GAME_NOT_FOUND", "Game not found");
    return game;
  }
  public async updateConfiguration(principal: AuthorizedPrincipal, input: { readonly gameId: string; readonly minimumEntry: string; readonly maximumEntry: string; readonly configuration: Readonly<Record<string, unknown>>; readonly reason: string; readonly ipAddress: string; readonly userAgent: string | null }): Promise<AdminGameRecord> {
    requirePermission(principal, "GAME_MANAGE");
    const games = await this.repository.listGames(100);
    const current = games.find((game) => game.id === input.gameId);
    if (current === undefined) throw new PlatformAdminError("GAME_NOT_FOUND", "Game not found");
    const minimumEntry = parseAmount(input.minimumEntry); const maximumEntry = parseAmount(input.maximumEntry);
    if (maximumEntry !== 0n && maximumEntry < minimumEntry) throw new PlatformAdminError("INVALID_REQUEST", "Maximum entry must be zero or at least the minimum entry");
    let configuration: Readonly<Record<string, unknown>>;
    try { configuration = this.configurationValidator(current.slug, current.version, input.configuration); }
    catch { throw new PlatformAdminError("INVALID_REQUEST", "Game configuration is invalid"); }
    if (current.slug === "neon-mines") validateMinesEntryLimits(minimumEntry, maximumEntry, configuration);
    if (current.slug === "neon-dice") validateDiceEntryLimits(minimumEntry, maximumEntry, configuration);
    const game = await this.repository.createConfigurationRevision({ gameId: input.gameId, minimumEntry, maximumEntry, configuration, audit: this.audit(principal, input) });
    if (game === null) throw new PlatformAdminError("GAME_NOT_FOUND", "Game not found");
    return game;
  }
  private audit(principal: AuthorizedPrincipal, input: { readonly reason: string; readonly ipAddress: string; readonly userAgent: string | null }): AuditContext {
    const reason = input.reason.trim();
    if (reason.length < 3 || reason.length > 500) throw new PlatformAdminError("INVALID_REQUEST", "A reason between 3 and 500 characters is required");
    return { adminId: principal.accountId, reason, ipAddress: input.ipAddress, userAgent: input.userAgent, occurredAt: this.clock.now() };
  }
}

function requirePermission(principal: AuthorizedPrincipal, permission: AdminPermission): void {
  if (!hasPermission(principal, permission)) throw new PlatformAdminError("ACCESS_DENIED", "Access denied");
}
function parseAmount(value: string): bigint {
  if (!/^(0|[1-9][0-9]{0,18})$/u.test(value)) throw new PlatformAdminError("INVALID_REQUEST", "Entry amounts must be non-negative integers");
  return BigInt(value);
}

function validateMinesEntryLimits(minimum: bigint, maximum: bigint, configuration: Readonly<Record<string, unknown>>): void {
  const denominations = configuration.wagerDenominationsCents as number[];
  if (!Array.isArray(denominations) || !denominations.some((amount) => BigInt(amount) === minimum)
    || !denominations.some((amount) => BigInt(amount) === maximum)) {
    throw new PlatformAdminError("INVALID_REQUEST", "Mines entry limits must be supported denominations; unlimited wagers are not allowed");
  }
  const difficulties = configuration.difficulties as Record<string, { mines: number; maximumWagerCents: number }>;
  for (const rule of Object.values(difficulties)) {
    const wagers = denominations.filter((amount) => BigInt(amount) >= minimum && BigInt(amount) <= maximum && amount <= rule.maximumWagerCents);
    if (wagers.length === 0) throw new PlatformAdminError("INVALID_REQUEST", "Entry limits must leave at least one wager available for every Mines difficulty");
    // The first safe selection must be payable for every offered wager.
    const firstPayout = BigInt(Math.max(...wagers)) * 9600n * 25n / (10000n * BigInt(25 - rule.mines));
    if (firstPayout > BigInt(configuration.maximumPayoutCents as number)) {
      throw new PlatformAdminError("INVALID_REQUEST", "Payout cap is too low for the offered Mines wagers; lower the maximum entry or raise the cap");
    }
  }
}

function validateDiceEntryLimits(minimum: bigint, maximum: bigint, configuration: Readonly<Record<string, unknown>>): void {
  const denominations = configuration.wagerDenominationsCents as number[];
  const first = Array.isArray(denominations) ? denominations[0] : undefined;
  const last = Array.isArray(denominations) ? denominations.at(-1) : undefined;
  if (first === undefined || last === undefined || minimum !== BigInt(first) || maximum !== BigInt(last)) {
    throw new PlatformAdminError("INVALID_REQUEST", "Dice entry limits must match the first and last enabled wager; unlimited wagers are not allowed");
  }
  const maximumPayout = configuration.maximumPayoutCents;
  const requiredPayout = BigInt(last) * 57_000n / 10_000n;
  if (typeof maximumPayout !== "number" || !Number.isSafeInteger(maximumPayout) || BigInt(maximumPayout) < requiredPayout) {
    throw new PlatformAdminError("INVALID_REQUEST", "Dice payout reserve is too low for the largest enabled wager");
  }
}
