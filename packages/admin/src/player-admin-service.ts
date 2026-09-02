import { hasPermission, normalizeUsername, type AdminPermission, type AuthorizedPrincipal, type PasswordHasher } from "@game-platform/auth";

export type PlayerStatus = "ACTIVE" | "DISABLED";

export interface PlayerRecord {
  readonly id: string;
  readonly username: string;
  readonly status: PlayerStatus;
  readonly balance: bigint;
  readonly lastLoginAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AdminAuditRecord {
  readonly id: string;
  readonly adminUsername: string;
  readonly targetType: "ACCOUNT" | "GAME";
  readonly targetLabel: string;
  readonly action: "PLAYER_CREATED" | "PLAYER_ENABLED" | "PLAYER_DISABLED" | "PLAYER_PASSWORD_RESET" | "WALLET_CREDITED" | "WALLET_DEBITED" | "GAME_STATUS_CHANGED" | "GAME_CONFIG_UPDATED";
  readonly amount: bigint | null;
  readonly reason: string;
  readonly ipAddress: string;
  readonly createdAt: Date;
}

export interface AuditContext {
  readonly adminId: string;
  readonly ipAddress: string;
  readonly userAgent: string | null;
  readonly reason: string;
  readonly occurredAt: Date;
}

export interface PlayerDeletionCounts {
  readonly authSessions: number;
  readonly loginEvents: number;
  readonly securityEvents: number;
  readonly ownedGameSessions: number;
  readonly gameParticipations: number;
  readonly gameResults: number;
  readonly ledgerEntries: number;
  readonly adminAuditLogs: number;
}

export interface PlayerDeletionPreview {
  readonly playerId: string;
  readonly username: string;
  readonly status: PlayerStatus;
  readonly balance: bigint;
  readonly activeGameSessions: number;
  readonly counts: PlayerDeletionCounts;
}

export interface PlayerDeletionResult {
  readonly cleanupRunId: string;
  readonly playerId: string;
  readonly username: string;
  readonly balanceDeleted: bigint;
  readonly counts: PlayerDeletionCounts;
}

export interface PlayerRecordCleanupPreview {
  readonly playerId: string;
  readonly username: string;
  readonly retentionDays: number;
  readonly cutoffAt: Date;
  readonly counts: PlayerDeletionCounts;
}

export interface PlayerRecordCleanupResult extends PlayerRecordCleanupPreview {
  readonly cleanupRunId: string;
}

export interface InactivePlayerCleanupPreview {
  readonly inactivityDays: number;
  readonly cutoffAt: Date;
  readonly includePositiveBalances: boolean;
  readonly inactivePlayers: number;
  readonly activeSessionPlayers: number;
  readonly positiveBalancePlayers: number;
  readonly positiveBalanceTotal: bigint;
  readonly deletablePlayers: number;
}

export interface InactivePlayerCleanupResult {
  readonly cleanupRunId: string;
  readonly inactivityDays: number;
  readonly cutoffAt: Date;
  readonly includePositiveBalances: boolean;
  readonly batchSize: number;
  readonly deletedPlayers: number;
  readonly deletedBalance: bigint;
  readonly deletedRecords: PlayerDeletionCounts;
  readonly remainingPlayers: number;
}

export interface PlayerAdminRepository {
  listPlayers(limit: number): Promise<readonly PlayerRecord[]>;
  listAuditLogs(limit: number): Promise<readonly AdminAuditRecord[]>;
  createPlayer(input: {
    readonly username: string;
    readonly usernameNormalized: string;
    readonly passwordHash: string;
    readonly audit: AuditContext;
  }): Promise<PlayerRecord>;
  setPlayerStatus(input: {
    readonly playerId: string;
    readonly status: PlayerStatus;
    readonly audit: AuditContext;
  }): Promise<PlayerRecord | null>;
  resetPlayerPassword(input: {
    readonly playerId: string;
    readonly passwordHash: string;
    readonly audit: AuditContext;
  }): Promise<PlayerRecord | null>;
  getPlayerDeletionPreview(playerId: string): Promise<PlayerDeletionPreview | null>;
  deletePlayer(input: {
    readonly playerId: string;
    readonly expectedUsernameNormalized: string;
    readonly allowPositiveBalance: boolean;
    readonly idempotencyKey: string;
    readonly audit: AuditContext;
  }): Promise<PlayerDeletionResult | null>;
  getPlayerRecordCleanupPreview(input: {
    readonly playerId: string;
    readonly retentionDays: number;
    readonly cutoffAt: Date;
    readonly asOf: Date;
  }): Promise<PlayerRecordCleanupPreview | null>;
  deletePlayerRecords(input: {
    readonly playerId: string;
    readonly retentionDays: number;
    readonly cutoffAt: Date;
    readonly idempotencyKey: string;
    readonly audit: AuditContext;
  }): Promise<PlayerRecordCleanupResult | null>;
  getInactivePlayerCleanupPreview(input: {
    readonly inactivityDays: number;
    readonly cutoffAt: Date;
    readonly includePositiveBalances: boolean;
  }): Promise<InactivePlayerCleanupPreview>;
  deleteInactivePlayerBatch(input: {
    readonly inactivityDays: number;
    readonly cutoffAt: Date;
    readonly includePositiveBalances: boolean;
    readonly batchSize: number;
    readonly idempotencyKey: string;
    readonly audit: AuditContext;
  }): Promise<InactivePlayerCleanupResult>;
}

export class PlayerAdminError extends Error {
  public constructor(
    public readonly code: "ACCESS_DENIED" | "CONFLICT" | "INVALID_REQUEST" | "PLAYER_NOT_FOUND",
    message: string
  ) {
    super(message);
    this.name = "PlayerAdminError";
  }
}

export class PlayerAdminService {
  public constructor(
    private readonly repository: PlayerAdminRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly clock: { now(): Date } = { now: () => new Date() }
  ) {}

  public async listPlayers(principal: AuthorizedPrincipal): Promise<readonly PlayerRecord[]> {
    requirePermission(principal, "PLAYER_VIEW");
    return this.repository.listPlayers(100);
  }

  public async listAuditLogs(principal: AuthorizedPrincipal): Promise<readonly AdminAuditRecord[]> {
    requirePermission(principal, "SECURITY_VIEW");
    return this.repository.listAuditLogs(100);
  }

  public async createPlayer(
    principal: AuthorizedPrincipal,
    input: { readonly username: string; readonly password: string; readonly reason: string; readonly ipAddress: string; readonly userAgent: string | null }
  ): Promise<PlayerRecord> {
    requirePermission(principal, "PLAYER_CREATE");
    validatePassword(input.password);
    const username = input.username.trim();
    return this.repository.createPlayer({
      username,
      usernameNormalized: normalizeUsername(username),
      passwordHash: await this.passwordHasher.hash(input.password),
      audit: this.auditContext(principal, input)
    });
  }

  public async setPlayerEnabled(
    principal: AuthorizedPrincipal,
    input: { readonly playerId: string; readonly enabled: boolean; readonly reason: string; readonly ipAddress: string; readonly userAgent: string | null }
  ): Promise<PlayerRecord> {
    requirePermission(principal, "PLAYER_DISABLE");
    const player = await this.repository.setPlayerStatus({
      playerId: input.playerId,
      status: input.enabled ? "ACTIVE" : "DISABLED",
      audit: this.auditContext(principal, input)
    });
    if (player === null) throw new PlayerAdminError("PLAYER_NOT_FOUND", "Player not found");
    return player;
  }

  public async resetPassword(
    principal: AuthorizedPrincipal,
    input: { readonly playerId: string; readonly password: string; readonly reason: string; readonly ipAddress: string; readonly userAgent: string | null }
  ): Promise<void> {
    requirePermission(principal, "PLAYER_PASSWORD_RESET");
    validatePassword(input.password);
    const player = await this.repository.resetPlayerPassword({
      playerId: input.playerId,
      passwordHash: await this.passwordHasher.hash(input.password),
      audit: this.auditContext(principal, input)
    });
    if (player === null) throw new PlayerAdminError("PLAYER_NOT_FOUND", "Player not found");
  }

  public async previewPlayerDeletion(
    principal: AuthorizedPrincipal,
    input: { readonly playerId: string }
  ): Promise<PlayerDeletionPreview> {
    requirePermission(principal, "PLAYER_DELETE");
    const preview = await this.repository.getPlayerDeletionPreview(input.playerId);
    if (preview === null) throw new PlayerAdminError("PLAYER_NOT_FOUND", "Player not found");
    return preview;
  }

  public async deletePlayer(
    principal: AuthorizedPrincipal,
    input: {
      readonly playerId: string;
      readonly confirmationUsername: string;
      readonly allowPositiveBalance: boolean;
      readonly idempotencyKey: string;
      readonly reason: string;
      readonly ipAddress: string;
      readonly userAgent: string | null;
    }
  ): Promise<PlayerDeletionResult> {
    requirePermission(principal, "PLAYER_DELETE");
    if (!/^[A-Za-z0-9._:-]{16,100}$/u.test(input.idempotencyKey)) {
      throw new PlayerAdminError("INVALID_REQUEST", "A valid deletion idempotency key is required");
    }
    const confirmation = input.confirmationUsername.trim();
    if (confirmation.length === 0) {
      throw new PlayerAdminError("INVALID_REQUEST", "The player's username is required for confirmation");
    }
    const result = await this.repository.deletePlayer({
      playerId: input.playerId,
      expectedUsernameNormalized: normalizeUsername(confirmation),
      allowPositiveBalance: input.allowPositiveBalance,
      idempotencyKey: input.idempotencyKey,
      audit: this.auditContext(principal, input)
    });
    if (result === null) throw new PlayerAdminError("PLAYER_NOT_FOUND", "Player not found");
    return result;
  }

  public async previewPlayerRecordCleanup(
    principal: AuthorizedPrincipal,
    input: { readonly playerId: string; readonly retentionDays: number }
  ): Promise<PlayerRecordCleanupPreview> {
    requirePermission(principal, "DATA_RETENTION_MANAGE");
    validateRetentionDays(input.retentionDays);
    const asOf = this.clock.now();
    const preview = await this.repository.getPlayerRecordCleanupPreview({
      playerId: input.playerId,
      retentionDays: input.retentionDays,
      cutoffAt: retentionCutoff(asOf, input.retentionDays),
      asOf
    });
    if (preview === null) throw new PlayerAdminError("PLAYER_NOT_FOUND", "Player not found");
    return preview;
  }

  public async deletePlayerRecords(
    principal: AuthorizedPrincipal,
    input: {
      readonly playerId: string;
      readonly retentionDays: number;
      readonly idempotencyKey: string;
      readonly reason: string;
      readonly ipAddress: string;
      readonly userAgent: string | null;
    }
  ): Promise<PlayerRecordCleanupResult> {
    requirePermission(principal, "DATA_RETENTION_MANAGE");
    validateRetentionDays(input.retentionDays);
    validateIdempotencyKey(input.idempotencyKey);
    const audit = this.auditContext(principal, input);
    const result = await this.repository.deletePlayerRecords({
      playerId: input.playerId,
      retentionDays: input.retentionDays,
      cutoffAt: retentionCutoff(audit.occurredAt, input.retentionDays),
      idempotencyKey: input.idempotencyKey,
      audit
    });
    if (result === null) throw new PlayerAdminError("PLAYER_NOT_FOUND", "Player not found");
    return result;
  }

  public async previewInactivePlayerCleanup(
    principal: AuthorizedPrincipal,
    input: { readonly inactivityDays: number; readonly includePositiveBalances: boolean }
  ): Promise<InactivePlayerCleanupPreview> {
    requirePermission(principal, "DATA_RETENTION_MANAGE");
    validateRetentionDays(input.inactivityDays);
    const cutoffAt = retentionCutoff(this.clock.now(), input.inactivityDays);
    return this.repository.getInactivePlayerCleanupPreview({ ...input, cutoffAt });
  }

  public async deleteInactivePlayerBatch(
    principal: AuthorizedPrincipal,
    input: {
      readonly inactivityDays: number;
      readonly includePositiveBalances: boolean;
      readonly batchSize: number;
      readonly idempotencyKey: string;
      readonly reason: string;
      readonly ipAddress: string;
      readonly userAgent: string | null;
    }
  ): Promise<InactivePlayerCleanupResult> {
    requirePermission(principal, "DATA_RETENTION_MANAGE");
    validateRetentionDays(input.inactivityDays);
    if (!Number.isInteger(input.batchSize) || input.batchSize < 1 || input.batchSize > 100) {
      throw new PlayerAdminError("INVALID_REQUEST", "Batch size must be a whole number between 1 and 100");
    }
    validateIdempotencyKey(input.idempotencyKey);
    const audit = this.auditContext(principal, input);
    return this.repository.deleteInactivePlayerBatch({
      inactivityDays: input.inactivityDays,
      cutoffAt: retentionCutoff(audit.occurredAt, input.inactivityDays),
      includePositiveBalances: input.includePositiveBalances,
      batchSize: input.batchSize,
      idempotencyKey: input.idempotencyKey,
      audit
    });
  }

  private auditContext(
    principal: AuthorizedPrincipal,
    input: { readonly reason: string; readonly ipAddress: string; readonly userAgent: string | null }
  ): AuditContext {
    const reason = input.reason.trim();
    if (reason.length < 3 || reason.length > 500) {
      throw new PlayerAdminError("INVALID_REQUEST", "A reason between 3 and 500 characters is required");
    }
    return { adminId: principal.accountId, ipAddress: input.ipAddress, userAgent: input.userAgent, reason, occurredAt: this.clock.now() };
  }
}

function requirePermission(principal: AuthorizedPrincipal, permission: AdminPermission): void {
  if (!hasPermission(principal, permission)) throw new PlayerAdminError("ACCESS_DENIED", "Access denied");
}

function validatePassword(password: string): void {
  if (password.length < 8 || password.length > 1024) {
    throw new PlayerAdminError("INVALID_REQUEST", "Password must be between 8 and 1024 characters");
  }
}

function validateRetentionDays(days: number): void {
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new PlayerAdminError("INVALID_REQUEST", "Retention days must be a whole number between 1 and 3650");
  }
}

function retentionCutoff(asOf: Date, days: number): Date {
  return new Date(asOf.getTime() - days * 86_400_000);
}

function validateIdempotencyKey(key: string): void {
  if (!/^[A-Za-z0-9._:-]{16,100}$/u.test(key)) {
    throw new PlayerAdminError("INVALID_REQUEST", "A valid cleanup idempotency key is required");
  }
}
