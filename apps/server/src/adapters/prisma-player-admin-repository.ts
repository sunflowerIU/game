import { PlayerAdminError, type AdminAuditRecord, type AuditContext, type InactivePlayerCleanupPreview, type InactivePlayerCleanupResult, type PlayerAdminRepository, type PlayerDeletionCounts, type PlayerDeletionPreview, type PlayerDeletionResult, type PlayerRecord, type PlayerRecordCleanupPreview, type PlayerRecordCleanupResult, type PlayerStatus } from "@game-platform/admin";
import { Prisma, type DatabaseClient } from "@game-platform/database";

export class PrismaPlayerAdminRepository implements PlayerAdminRepository {
  public constructor(private readonly database: DatabaseClient) {}

  private async serializableCleanup<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.database.$transaction(operation, { isolationLevel: "Serializable" });
      } catch (error: unknown) {
        if (!isPrismaTransactionConflict(error) || attempt === 3) throw error;
      }
    }
    throw new Error("Cleanup transaction retry limit was reached");
  }

  public async listPlayers(limit: number): Promise<readonly PlayerRecord[]> {
    const players = await this.database.account.findMany({
      where: { type: "PLAYER" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      select: playerSelect
    });
    return players.map(toPlayerRecord);
  }

  public async listAuditLogs(limit: number): Promise<readonly AdminAuditRecord[]> {
    const [records, conversionRows] = await Promise.all([
      this.database.adminAuditLog.findMany({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
        include: {
          admin: { include: { account: { select: { username: true } } } },
          accountTarget: { select: { username: true } },
          gameTarget: { select: { slug: true } }
        }
      }),
      this.database.$queryRaw<readonly { finished_at: Date | null }[]>`SELECT "finished_at" FROM "_prisma_migrations" WHERE "migration_name" = '20260828000000_store_currency_in_cents' AND "rolled_back_at" IS NULL ORDER BY "finished_at" DESC LIMIT 1`
    ]);
    const centsConversionAt = conversionRows[0]?.finished_at ?? null;
    return records.map((record) => ({
      id: record.id.toString(),
      adminUsername: record.admin.account.username,
      targetType: record.targetType,
      targetLabel: record.accountTarget?.username ?? record.gameTarget?.slug ?? "unknown",
      action: record.action,
      amount: auditAmount(record.action, record.before, record.after, record.createdAt, centsConversionAt),
      reason: record.reason,
      ipAddress: record.ipAddress,
      createdAt: record.createdAt
    }));
  }

  public async createPlayer(input: {
    readonly username: string;
    readonly usernameNormalized: string;
    readonly passwordHash: string;
    readonly audit: AuditContext;
  }): Promise<PlayerRecord> {
    try {
      return await this.database.$transaction(async (transaction) => {
        const createdRow = await transaction.account.create({
          data: {
            username: input.username,
            usernameNormalized: input.usernameNormalized,
            type: "PLAYER",
            credential: { create: { passwordHash: input.passwordHash } },
            playerProfile: { create: {} },
            wallet: { create: {} }
          },
          select: playerSelect
        });
        const created = toPlayerRecord(createdRow);
        await transaction.adminAuditLog.create({
          data: {
            ...auditData(input.audit),
            action: "PLAYER_CREATED",
            targetType: "ACCOUNT",
            targetAccountId: created.id,
            after: playerSnapshot(created)
          }
        });
        return created;
      });
    } catch (error: unknown) {
      if (isPrismaUniqueConflict(error)) throw new PlayerAdminError("CONFLICT", "Username already exists");
      throw error;
    }
  }

  public async setPlayerStatus(input: {
    readonly playerId: string;
    readonly status: PlayerStatus;
    readonly audit: AuditContext;
  }): Promise<PlayerRecord | null> {
    return this.database.$transaction(async (transaction) => {
      const existingRow = await transaction.account.findFirst({
        where: { id: input.playerId, type: "PLAYER" },
        select: playerSelect
      });
      if (existingRow === null) return null;
      const existing = toPlayerRecord(existingRow);
      if (existing.status === input.status) return existing;

      const updatedRow = await transaction.account.update({
        where: { id: existing.id },
        data: {
          status: input.status,
          disabledAt: input.status === "DISABLED" ? input.audit.occurredAt : null
        },
        select: playerSelect
      });
      const updated = toPlayerRecord(updatedRow);

      if (input.status === "DISABLED") {
        await transaction.authSession.updateMany({
          where: { accountId: existing.id, revokedAt: null },
          data: { revokedAt: input.audit.occurredAt, revokeReason: "ACCOUNT_DISABLED" }
        });
      }

      await transaction.adminAuditLog.create({
        data: {
          ...auditData(input.audit),
          action: input.status === "ACTIVE" ? "PLAYER_ENABLED" : "PLAYER_DISABLED",
          targetType: "ACCOUNT",
          targetAccountId: existing.id,
          before: playerSnapshot(existing),
          after: playerSnapshot(updated)
        }
      });
      return updated;
    });
  }

  public async resetPlayerPassword(input: {
    readonly playerId: string;
    readonly passwordHash: string;
    readonly audit: AuditContext;
  }): Promise<PlayerRecord | null> {
    return this.database.$transaction(async (transaction) => {
      const existing = await transaction.account.findFirst({
        where: { id: input.playerId, type: "PLAYER" },
        select: { ...playerSelect, credential: { select: { passwordVersion: true } } }
      });
      if (existing === null || existing.credential === null) return null;

      await transaction.credential.update({
        where: { accountId: existing.id },
        data: {
          passwordHash: input.passwordHash,
          passwordChangedAt: input.audit.occurredAt,
          passwordVersion: { increment: 1 }
        }
      });
      await transaction.authSession.updateMany({
        where: { accountId: existing.id, revokedAt: null },
        data: { revokedAt: input.audit.occurredAt, revokeReason: "PASSWORD_CHANGED" }
      });
      await transaction.adminAuditLog.create({
        data: {
          ...auditData(input.audit),
          action: "PLAYER_PASSWORD_RESET",
          targetType: "ACCOUNT",
          targetAccountId: existing.id,
          before: { passwordVersion: existing.credential.passwordVersion },
          after: { passwordVersion: existing.credential.passwordVersion + 1 }
        }
      });
      return toPlayerRecord(existing);
    });
  }

  public async getPlayerDeletionPreview(playerId: string): Promise<PlayerDeletionPreview | null> {
    const player = await this.database.account.findFirst({
      where: { id: playerId, type: "PLAYER" },
      select: deletionPlayerSelect
    });
    if (player === null || player.wallet === null) return null;
    return this.buildDeletionPreview(this.database, player);
  }

  public async deletePlayer(input: {
    readonly playerId: string;
    readonly expectedUsernameNormalized: string;
    readonly allowPositiveBalance: boolean;
    readonly idempotencyKey: string;
    readonly audit: AuditContext;
  }): Promise<PlayerDeletionResult | null> {
    try {
      return await this.serializableCleanup(async (transaction) => {
      const previousRun = await transaction.dataCleanupRun.findUnique({
        where: { idempotencyKey: input.idempotencyKey }
      });
      if (previousRun !== null) {
        if (previousRun.action !== "PLAYER_DELETED" || previousRun.adminId !== input.audit.adminId || previousRun.targetAccountIdSnapshot !== input.playerId) {
          throw new PlayerAdminError("CONFLICT", "Deletion idempotency key was already used for another operation");
        }
        return cleanupRunResult(previousRun);
      }

      await transaction.$queryRaw<readonly { id: string }[]>`
        SELECT "id" FROM "Account" WHERE "id" = ${input.playerId}::uuid AND "type" = 'PLAYER' FOR UPDATE
      `;
      const player = await transaction.account.findFirst({
        where: { id: input.playerId, type: "PLAYER" },
        select: deletionPlayerSelect
      });
      if (player === null || player.wallet === null) return null;
      if (player.usernameNormalized !== input.expectedUsernameNormalized) {
        throw new PlayerAdminError("INVALID_REQUEST", "Confirmation username does not match the player");
      }
      if (player.wallet.balance > 0n && !input.allowPositiveBalance) {
        throw new PlayerAdminError("CONFLICT", "Player has a positive balance; explicit balance deletion approval is required");
      }

      const preview = await this.buildDeletionPreview(transaction, player);
      const cleanupRun = await transaction.dataCleanupRun.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          adminId: input.audit.adminId,
          action: "PLAYER_DELETED",
          targetAccountIdSnapshot: player.id,
          targetUsernameSnapshot: player.username,
          recordCounts: { ...preview.counts, balanceDeleted: player.wallet.balance.toString() },
          reason: input.audit.reason,
          ipAddress: input.audit.ipAddress,
          userAgent: input.audit.userAgent,
          createdAt: input.audit.occurredAt
        }
      });
      await transaction.$queryRaw`SELECT set_config('app.cleanup_run_id', ${cleanupRun.id}, true)`;

      const ownedSessions = await transaction.gameSession.findMany({
        where: { ownerAccountId: player.id },
        select: { id: true }
      });
      const ownedSessionIds = ownedSessions.map((session) => session.id);
      const sessionFilter = { in: ownedSessionIds };

      await transaction.securityEvent.deleteMany({
        where: { OR: [{ accountId: player.id }, { gameSessionId: sessionFilter }] }
      });
      await transaction.gameResult.deleteMany({ where: { gameSessionId: sessionFilter } });
      await transaction.gameSessionParticipant.deleteMany({
        where: { OR: [{ accountId: player.id }, { gameSessionId: sessionFilter }] }
      });
      await transaction.gameSession.deleteMany({ where: { id: sessionFilter } });
      await transaction.adminAuditLog.deleteMany({ where: { targetAccountId: player.id } });
      await transaction.ledgerEntry.deleteMany({ where: { walletId: player.wallet.id } });
      await transaction.loginEvent.deleteMany({
        where: { OR: [{ accountId: player.id }, { usernameNormalized: player.usernameNormalized }] }
      });
      await transaction.account.delete({ where: { id: player.id } });

      return {
        cleanupRunId: cleanupRun.id,
        playerId: player.id,
        username: player.username,
        balanceDeleted: player.wallet.balance,
        counts: preview.counts
      };
      });
    } catch (error: unknown) {
      if (!isPrismaUniqueConflict(error)) throw error;
      const previousRun = await this.database.dataCleanupRun.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (previousRun === null) throw error;
      if (previousRun.action !== "PLAYER_DELETED" || previousRun.adminId !== input.audit.adminId || previousRun.targetAccountIdSnapshot !== input.playerId) {
        throw new PlayerAdminError("CONFLICT", "Deletion idempotency key was already used for another operation");
      }
      return cleanupRunResult(previousRun);
    }
  }

  public async getPlayerRecordCleanupPreview(input: {
    readonly playerId: string;
    readonly retentionDays: number;
    readonly cutoffAt: Date;
    readonly asOf: Date;
  }): Promise<PlayerRecordCleanupPreview | null> {
    const player = await this.database.account.findFirst({
      where: { id: input.playerId, type: "PLAYER" },
      select: deletionPlayerSelect
    });
    if (player === null || player.wallet === null) return null;
    return this.buildRecordCleanupPreview(this.database, player, input.retentionDays, input.cutoffAt, input.asOf);
  }

  public async deletePlayerRecords(input: {
    readonly playerId: string;
    readonly retentionDays: number;
    readonly cutoffAt: Date;
    readonly idempotencyKey: string;
    readonly audit: AuditContext;
  }): Promise<PlayerRecordCleanupResult | null> {
    try {
      return await this.serializableCleanup(async (transaction) => {
      const previousRun = await transaction.dataCleanupRun.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (previousRun !== null) {
        if (previousRun.action !== "PLAYER_RECORDS_DELETED" || previousRun.adminId !== input.audit.adminId || previousRun.targetAccountIdSnapshot !== input.playerId) {
          throw new PlayerAdminError("CONFLICT", "Cleanup idempotency key was already used for another operation");
        }
        const replay = recordCleanupRunResult(previousRun);
        if (replay.retentionDays !== input.retentionDays) throw new PlayerAdminError("CONFLICT", "Cleanup idempotency key was already used with different retention parameters");
        return replay;
      }

      await transaction.$queryRaw<readonly { id: string }[]>`
        SELECT "id" FROM "Account" WHERE "id" = ${input.playerId}::uuid AND "type" = 'PLAYER' FOR UPDATE
      `;
      const player = await transaction.account.findFirst({
        where: { id: input.playerId, type: "PLAYER" },
        select: deletionPlayerSelect
      });
      if (player === null || player.wallet === null) return null;
      const preview = await this.buildRecordCleanupPreview(transaction, player, input.retentionDays, input.cutoffAt, input.audit.occurredAt);
      const cleanupRun = await transaction.dataCleanupRun.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          adminId: input.audit.adminId,
          action: "PLAYER_RECORDS_DELETED",
          targetAccountIdSnapshot: player.id,
          targetUsernameSnapshot: player.username,
          cutoffAt: input.cutoffAt,
          recordCounts: { ...preview.counts, retentionDays: input.retentionDays },
          reason: input.audit.reason,
          ipAddress: input.audit.ipAddress,
          userAgent: input.audit.userAgent,
          createdAt: input.audit.occurredAt
        }
      });
      await transaction.$queryRaw`SELECT set_config('app.cleanup_run_id', ${cleanupRun.id}, true)`;

      const oldOwnedSessionIds = await this.oldOwnedSessionIds(transaction, player.id, input.cutoffAt);
      const sessionFilter = { in: oldOwnedSessionIds };
      const terminalStatuses = ["COMPLETED", "ABANDONED", "FAILED"] as const;
      await transaction.authSession.deleteMany({
        where: {
          accountId: player.id,
          lastSeenAt: { lte: input.cutoffAt },
          OR: [{ revokedAt: { not: null } }, { expiresAt: { lte: input.audit.occurredAt } }]
        }
      });
      await transaction.securityEvent.deleteMany({
        where: { OR: [{ accountId: player.id, createdAt: { lte: input.cutoffAt } }, { gameSessionId: sessionFilter }] }
      });
      await transaction.gameResult.deleteMany({ where: { gameSessionId: sessionFilter } });
      await transaction.gameSessionParticipant.deleteMany({
        where: {
          OR: [
            { gameSessionId: sessionFilter },
            { accountId: player.id, joinedAt: { lte: input.cutoffAt }, gameSession: { status: { in: [...terminalStatuses] }, completedAt: { lte: input.cutoffAt } } }
          ]
        }
      });
      await transaction.gameSession.deleteMany({ where: { id: sessionFilter } });
      await transaction.adminAuditLog.deleteMany({ where: { targetAccountId: player.id, createdAt: { lte: input.cutoffAt } } });
      await transaction.ledgerEntry.deleteMany({ where: { walletId: player.wallet.id, createdAt: { lte: input.cutoffAt } } });
      await transaction.loginEvent.deleteMany({
        where: { createdAt: { lte: input.cutoffAt }, OR: [{ accountId: player.id }, { usernameNormalized: player.usernameNormalized }] }
      });

      return { ...preview, cleanupRunId: cleanupRun.id };
      });
    } catch (error: unknown) {
      if (!isPrismaUniqueConflict(error)) throw error;
      const previousRun = await this.database.dataCleanupRun.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (previousRun === null) throw error;
      if (previousRun.action !== "PLAYER_RECORDS_DELETED" || previousRun.adminId !== input.audit.adminId || previousRun.targetAccountIdSnapshot !== input.playerId) {
        throw new PlayerAdminError("CONFLICT", "Cleanup idempotency key was already used for another operation");
      }
      const replay = recordCleanupRunResult(previousRun);
      if (replay.retentionDays !== input.retentionDays) throw new PlayerAdminError("CONFLICT", "Cleanup idempotency key was already used with different retention parameters");
      return replay;
    }
  }

  public async getInactivePlayerCleanupPreview(input: {
    readonly inactivityDays: number;
    readonly cutoffAt: Date;
    readonly includePositiveBalances: boolean;
  }): Promise<InactivePlayerCleanupPreview> {
    const stats = await this.inactiveCleanupStats(this.database, input.cutoffAt, input.includePositiveBalances);
    return { ...input, ...stats };
  }

  public async deleteInactivePlayerBatch(input: {
    readonly inactivityDays: number;
    readonly cutoffAt: Date;
    readonly includePositiveBalances: boolean;
    readonly batchSize: number;
    readonly idempotencyKey: string;
    readonly audit: AuditContext;
  }): Promise<InactivePlayerCleanupResult> {
    try {
      return await this.serializableCleanup(async (transaction) => {
      const previousRun = await transaction.dataCleanupRun.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (previousRun !== null) {
        if (previousRun.action !== "INACTIVE_PLAYERS_DELETED" || previousRun.adminId !== input.audit.adminId) {
          throw new PlayerAdminError("CONFLICT", "Cleanup idempotency key was already used for another operation");
        }
        const replay = inactiveCleanupRunResult(previousRun);
        if (replay.inactivityDays !== input.inactivityDays || replay.includePositiveBalances !== input.includePositiveBalances || replay.batchSize !== input.batchSize) {
          throw new PlayerAdminError("CONFLICT", "Cleanup idempotency key was already used with different batch parameters");
        }
        return replay;
      }

      const candidates = await transaction.$queryRaw<readonly { id: string }[]>`
        SELECT account."id"
        FROM "Account" account
        JOIN "PlayerProfile" profile ON profile."accountId" = account."id"
        JOIN "Wallet" wallet ON wallet."accountId" = account."id"
        WHERE account."type" = 'PLAYER'
          AND COALESCE(profile."lastLoginAt", account."createdAt") <= ${input.cutoffAt}
          AND (${input.includePositiveBalances}::boolean OR wallet."balance" = 0)
          AND NOT EXISTS (
            SELECT 1 FROM "GameSession" session
            WHERE session."status" IN ('CREATED', 'ACTIVE')
              AND (session."ownerAccountId" = account."id" OR EXISTS (
                SELECT 1 FROM "GameSessionParticipant" participant
                WHERE participant."gameSessionId" = session."id" AND participant."accountId" = account."id"
              ))
        )
        ORDER BY COALESCE(profile."lastLoginAt", account."createdAt"), account."id"
        LIMIT ${input.batchSize}
        FOR UPDATE OF account, wallet SKIP LOCKED
      `;
      const playerIds = candidates.map((candidate) => candidate.id);
      const players = await transaction.account.findMany({
        where: { id: { in: playerIds }, type: "PLAYER" },
        select: deletionPlayerSelect
      });
      if (players.some((player) => player.wallet === null)) throw new Error("PLAYER account is missing its wallet");
      const usernames = players.map((player) => player.usernameNormalized);
      const walletIds = players.map((player) => player.wallet!.id);
      const deletedBalance = players.reduce((sum, player) => sum + player.wallet!.balance, 0n);
      const ownedSessions = await transaction.gameSession.findMany({ where: { ownerAccountId: { in: playerIds } }, select: { id: true } });
      const ownedSessionIds = ownedSessions.map((session) => session.id);
      const deletedRecords = await this.buildBulkDeletionCounts(transaction, playerIds, usernames, walletIds, ownedSessionIds);

      const cleanupRun = await transaction.dataCleanupRun.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          adminId: input.audit.adminId,
          action: "INACTIVE_PLAYERS_DELETED",
          cutoffAt: input.cutoffAt,
          recordCounts: {
            ...deletedRecords,
            inactivityDays: input.inactivityDays,
            includePositiveBalances: input.includePositiveBalances,
            batchSize: input.batchSize,
            deletedPlayers: players.length,
            deletedBalance: deletedBalance.toString(),
            remainingPlayers: 0
          },
          reason: input.audit.reason,
          ipAddress: input.audit.ipAddress,
          userAgent: input.audit.userAgent,
          createdAt: input.audit.occurredAt
        }
      });
      await transaction.$queryRaw`SELECT set_config('app.cleanup_run_id', ${cleanupRun.id}, true)`;

      const sessionFilter = { in: ownedSessionIds };
      await transaction.securityEvent.deleteMany({ where: { OR: [{ accountId: { in: playerIds } }, { gameSessionId: sessionFilter }] } });
      await transaction.gameResult.deleteMany({ where: { gameSessionId: sessionFilter } });
      await transaction.gameSessionParticipant.deleteMany({ where: { OR: [{ accountId: { in: playerIds } }, { gameSessionId: sessionFilter }] } });
      await transaction.gameSession.deleteMany({ where: { id: sessionFilter } });
      await transaction.adminAuditLog.deleteMany({ where: { targetAccountId: { in: playerIds } } });
      await transaction.ledgerEntry.deleteMany({ where: { walletId: { in: walletIds } } });
      await transaction.loginEvent.deleteMany({ where: { OR: [{ accountId: { in: playerIds } }, { usernameNormalized: { in: usernames } }] } });
      await transaction.account.deleteMany({ where: { id: { in: playerIds }, type: "PLAYER" } });

      const remaining = await this.inactiveCleanupStats(transaction, input.cutoffAt, input.includePositiveBalances);
      const recordCounts = {
        ...deletedRecords,
        inactivityDays: input.inactivityDays,
        includePositiveBalances: input.includePositiveBalances,
        batchSize: input.batchSize,
        deletedPlayers: players.length,
        deletedBalance: deletedBalance.toString(),
        remainingPlayers: remaining.deletablePlayers
      };
      await transaction.dataCleanupRun.update({ where: { id: cleanupRun.id }, data: { recordCounts } });
      return {
        cleanupRunId: cleanupRun.id,
        inactivityDays: input.inactivityDays,
        cutoffAt: input.cutoffAt,
        includePositiveBalances: input.includePositiveBalances,
        batchSize: input.batchSize,
        deletedPlayers: players.length,
        deletedBalance,
        deletedRecords,
        remainingPlayers: remaining.deletablePlayers
      };
      });
    } catch (error: unknown) {
      if (!isPrismaUniqueConflict(error)) throw error;
      const previousRun = await this.database.dataCleanupRun.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (previousRun === null) throw error;
      if (previousRun.action !== "INACTIVE_PLAYERS_DELETED" || previousRun.adminId !== input.audit.adminId) {
        throw new PlayerAdminError("CONFLICT", "Cleanup idempotency key was already used for another operation");
      }
      const replay = inactiveCleanupRunResult(previousRun);
      if (replay.inactivityDays !== input.inactivityDays || replay.includePositiveBalances !== input.includePositiveBalances || replay.batchSize !== input.batchSize) {
        throw new PlayerAdminError("CONFLICT", "Cleanup idempotency key was already used with different batch parameters");
      }
      return replay;
    }
  }

  private async buildDeletionPreview(
    database: DeletionQueryClient,
    player: DeletionPlayer
  ): Promise<PlayerDeletionPreview> {
    if (player.wallet === null) throw new Error("PLAYER account is missing its wallet");
    const ownedSessions = await database.gameSession.findMany({
      where: { ownerAccountId: player.id },
      select: { id: true }
    });
    const ownedSessionIds = ownedSessions.map((session) => session.id);
    const sessionFilter = { in: ownedSessionIds };
    const [authSessions, loginEvents, securityEvents, gameParticipations, gameResults, ledgerEntries, adminAuditLogs, activeGameSessions] = await Promise.all([
      database.authSession.count({ where: { accountId: player.id } }),
      database.loginEvent.count({ where: { OR: [{ accountId: player.id }, { usernameNormalized: player.usernameNormalized }] } }),
      database.securityEvent.count({ where: { OR: [{ accountId: player.id }, { gameSessionId: sessionFilter }] } }),
      database.gameSessionParticipant.count({ where: { OR: [{ accountId: player.id }, { gameSessionId: sessionFilter }] } }),
      database.gameResult.count({ where: { gameSessionId: sessionFilter } }),
      database.ledgerEntry.count({ where: { walletId: player.wallet.id } }),
      database.adminAuditLog.count({ where: { targetAccountId: player.id } }),
      database.gameSession.count({
        where: {
          status: { in: ["CREATED", "ACTIVE"] },
          OR: [{ ownerAccountId: player.id }, { participants: { some: { accountId: player.id } } }]
        }
      })
    ]);
    return {
      playerId: player.id,
      username: player.username,
      status: player.status,
      balance: player.wallet.balance,
      activeGameSessions,
      counts: {
        authSessions,
        loginEvents,
        securityEvents,
        ownedGameSessions: ownedSessionIds.length,
        gameParticipations,
        gameResults,
        ledgerEntries,
        adminAuditLogs
      }
    };
  }

  private async buildRecordCleanupPreview(
    database: DeletionQueryClient,
    player: DeletionPlayer,
    retentionDays: number,
    cutoffAt: Date,
    asOf: Date
  ): Promise<PlayerRecordCleanupPreview> {
    if (player.wallet === null) throw new Error("PLAYER account is missing its wallet");
    const oldOwnedSessionIds = await this.oldOwnedSessionIds(database, player.id, cutoffAt);
    const sessionFilter = { in: oldOwnedSessionIds };
    const terminalStatuses = ["COMPLETED", "ABANDONED", "FAILED"] as const;
    const [authSessions, loginEvents, securityEvents, gameParticipations, gameResults, ledgerEntries, adminAuditLogs] = await Promise.all([
      database.authSession.count({ where: { accountId: player.id, lastSeenAt: { lte: cutoffAt }, OR: [{ revokedAt: { not: null } }, { expiresAt: { lte: asOf } }] } }),
      database.loginEvent.count({ where: { createdAt: { lte: cutoffAt }, OR: [{ accountId: player.id }, { usernameNormalized: player.usernameNormalized }] } }),
      database.securityEvent.count({ where: { OR: [{ accountId: player.id, createdAt: { lte: cutoffAt } }, { gameSessionId: sessionFilter }] } }),
      database.gameSessionParticipant.count({
        where: {
          OR: [
            { gameSessionId: sessionFilter },
            { accountId: player.id, joinedAt: { lte: cutoffAt }, gameSession: { status: { in: [...terminalStatuses] }, completedAt: { lte: cutoffAt } } }
          ]
        }
      }),
      database.gameResult.count({ where: { gameSessionId: sessionFilter } }),
      database.ledgerEntry.count({ where: { walletId: player.wallet.id, createdAt: { lte: cutoffAt } } }),
      database.adminAuditLog.count({ where: { targetAccountId: player.id, createdAt: { lte: cutoffAt } } })
    ]);
    return {
      playerId: player.id,
      username: player.username,
      retentionDays,
      cutoffAt,
      counts: {
        authSessions,
        loginEvents,
        securityEvents,
        ownedGameSessions: oldOwnedSessionIds.length,
        gameParticipations,
        gameResults,
        ledgerEntries,
        adminAuditLogs
      }
    };
  }

  private async oldOwnedSessionIds(database: DeletionQueryClient, playerId: string, cutoffAt: Date): Promise<string[]> {
    const sessions = await database.gameSession.findMany({
      where: { ownerAccountId: playerId, status: { in: ["COMPLETED", "ABANDONED", "FAILED"] }, completedAt: { lte: cutoffAt } },
      select: { id: true }
    });
    return sessions.map((session) => session.id);
  }

  private async inactiveCleanupStats(database: RawQueryClient, cutoffAt: Date, includePositiveBalances: boolean): Promise<Omit<InactivePlayerCleanupPreview, "inactivityDays" | "cutoffAt" | "includePositiveBalances">> {
    const rows = await database.$queryRaw<readonly InactiveCleanupStatsRow[]>`
      WITH inactive AS (
        SELECT account."id", wallet."balance",
          EXISTS (
            SELECT 1 FROM "GameSession" session
            WHERE session."status" IN ('CREATED', 'ACTIVE')
              AND (session."ownerAccountId" = account."id" OR EXISTS (
                SELECT 1 FROM "GameSessionParticipant" participant
                WHERE participant."gameSessionId" = session."id" AND participant."accountId" = account."id"
              ))
          ) AS "hasActiveSession"
        FROM "Account" account
        JOIN "PlayerProfile" profile ON profile."accountId" = account."id"
        JOIN "Wallet" wallet ON wallet."accountId" = account."id"
        WHERE account."type" = 'PLAYER'
          AND COALESCE(profile."lastLoginAt", account."createdAt") <= ${cutoffAt}
      )
      SELECT
        COUNT(*) AS "inactivePlayers",
        COUNT(*) FILTER (WHERE "hasActiveSession") AS "activeSessionPlayers",
        COUNT(*) FILTER (WHERE "balance" > 0) AS "positiveBalancePlayers",
        COALESCE(SUM("balance") FILTER (WHERE "balance" > 0), 0) AS "positiveBalanceTotal",
        COUNT(*) FILTER (WHERE NOT "hasActiveSession" AND (${includePositiveBalances}::boolean OR "balance" = 0)) AS "deletablePlayers"
      FROM inactive
    `;
    const row = rows[0];
    if (row === undefined) throw new Error("Inactive player cleanup preview did not return statistics");
    return {
      inactivePlayers: Number(row.inactivePlayers),
      activeSessionPlayers: Number(row.activeSessionPlayers),
      positiveBalancePlayers: Number(row.positiveBalancePlayers),
      positiveBalanceTotal: BigInt(String(row.positiveBalanceTotal)),
      deletablePlayers: Number(row.deletablePlayers)
    };
  }

  private async buildBulkDeletionCounts(database: DeletionQueryClient, playerIds: string[], usernames: string[], walletIds: string[], ownedSessionIds: string[]): Promise<PlayerDeletionCounts> {
    const sessionFilter = { in: ownedSessionIds };
    const [authSessions, loginEvents, securityEvents, gameParticipations, gameResults, ledgerEntries, adminAuditLogs] = await Promise.all([
      database.authSession.count({ where: { accountId: { in: playerIds } } }),
      database.loginEvent.count({ where: { OR: [{ accountId: { in: playerIds } }, { usernameNormalized: { in: usernames } }] } }),
      database.securityEvent.count({ where: { OR: [{ accountId: { in: playerIds } }, { gameSessionId: sessionFilter }] } }),
      database.gameSessionParticipant.count({ where: { OR: [{ accountId: { in: playerIds } }, { gameSessionId: sessionFilter }] } }),
      database.gameResult.count({ where: { gameSessionId: sessionFilter } }),
      database.ledgerEntry.count({ where: { walletId: { in: walletIds } } }),
      database.adminAuditLog.count({ where: { targetAccountId: { in: playerIds } } })
    ]);
    return { authSessions, loginEvents, securityEvents, ownedGameSessions: ownedSessionIds.length, gameParticipations, gameResults, ledgerEntries, adminAuditLogs };
  }
}

const playerSelect = {
  id: true,
  username: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  playerProfile: { select: { lastLoginAt: true } },
  wallet: { select: { balance: true } }
} as const;

const deletionPlayerSelect = {
  id: true,
  username: true,
  usernameNormalized: true,
  status: true,
  wallet: { select: { id: true, balance: true } }
} as const;

interface DeletionPlayer {
  readonly id: string;
  readonly username: string;
  readonly usernameNormalized: string;
  readonly status: PlayerStatus;
  readonly wallet: { readonly id: string; readonly balance: bigint } | null;
}

type DeletionQueryClient = Pick<DatabaseClient,
  "authSession" | "loginEvent" | "securityEvent" | "gameSession" | "gameSessionParticipant" | "gameResult" | "ledgerEntry" | "adminAuditLog"
>;
type RawQueryClient = Pick<DatabaseClient, "$queryRaw">;

interface InactiveCleanupStatsRow {
  readonly inactivePlayers: bigint;
  readonly activeSessionPlayers: bigint;
  readonly positiveBalancePlayers: bigint;
  readonly positiveBalanceTotal: unknown;
  readonly deletablePlayers: bigint;
}

function auditData(audit: AuditContext) {
  return {
    adminId: audit.adminId,
    reason: audit.reason,
    ipAddress: audit.ipAddress,
    userAgent: audit.userAgent,
    createdAt: audit.occurredAt
  } as const;
}

function playerSnapshot(player: PlayerRecord) {
  return {
    username: player.username,
    status: player.status
  };
}

function toPlayerRecord(player: {
  id: string;
  username: string;
  status: PlayerStatus;
  createdAt: Date;
  updatedAt: Date;
  playerProfile: { lastLoginAt: Date | null } | null;
  wallet: { balance: bigint } | null;
}): PlayerRecord {
  if (player.wallet === null || player.playerProfile === null) throw new Error("PLAYER account is missing its profile or wallet");
  return { id: player.id, username: player.username, status: player.status, balance: player.wallet.balance, lastLoginAt: player.playerProfile.lastLoginAt, createdAt: player.createdAt, updatedAt: player.updatedAt };
}

function isPrismaUniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function isPrismaTransactionConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2034";
}

function auditAmount(action: AdminAuditRecord["action"], before: unknown, after: unknown, createdAt: Date, centsConversionAt: Date | null): bigint | null {
  if (action !== "WALLET_CREDITED" && action !== "WALLET_DEBITED") return null;
  const previous = jsonInteger(before, "balance");
  const next = jsonInteger(after, "balance");
  if (previous === null || next === null) return null;
  const difference = next - previous;
  const absolute = difference < 0n ? -difference : difference;
  return centsConversionAt !== null && createdAt < centsConversionAt ? absolute * 100n : absolute;
}

function jsonInteger(value: unknown, key: string): bigint | null {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !(key in value)) return null;
  const field = (value as Record<string, unknown>)[key];
  if (typeof field !== "string" || !/^-?[0-9]+$/u.test(field)) return null;
  return BigInt(field);
}

function cleanupRunResult(run: {
  id: string;
  targetAccountIdSnapshot: string | null;
  targetUsernameSnapshot: string | null;
  recordCounts: unknown;
}): PlayerDeletionResult {
  if (run.targetAccountIdSnapshot === null || run.targetUsernameSnapshot === null || typeof run.recordCounts !== "object" || run.recordCounts === null || Array.isArray(run.recordCounts)) {
    throw new Error("Stored player deletion cleanup run is incomplete");
  }
  const values = run.recordCounts as Record<string, unknown>;
  const count = (key: keyof PlayerDeletionCounts): number => {
    const value = values[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`Stored cleanup count ${key} is invalid`);
    return value;
  };
  const balanceValue = values.balanceDeleted;
  if (typeof balanceValue !== "string" || !/^[0-9]+$/u.test(balanceValue)) throw new Error("Stored cleanup balance is invalid");
  return {
    cleanupRunId: run.id,
    playerId: run.targetAccountIdSnapshot,
    username: run.targetUsernameSnapshot,
    balanceDeleted: BigInt(balanceValue),
    counts: {
      authSessions: count("authSessions"),
      loginEvents: count("loginEvents"),
      securityEvents: count("securityEvents"),
      ownedGameSessions: count("ownedGameSessions"),
      gameParticipations: count("gameParticipations"),
      gameResults: count("gameResults"),
      ledgerEntries: count("ledgerEntries"),
      adminAuditLogs: count("adminAuditLogs")
    }
  };
}

function recordCleanupRunResult(run: {
  id: string;
  targetAccountIdSnapshot: string | null;
  targetUsernameSnapshot: string | null;
  cutoffAt: Date | null;
  recordCounts: unknown;
}): PlayerRecordCleanupResult {
  if (run.targetAccountIdSnapshot === null || run.targetUsernameSnapshot === null || run.cutoffAt === null || typeof run.recordCounts !== "object" || run.recordCounts === null || Array.isArray(run.recordCounts)) {
    throw new Error("Stored player record cleanup run is incomplete");
  }
  const values = run.recordCounts as Record<string, unknown>;
  const retentionDays = values.retentionDays;
  if (typeof retentionDays !== "number" || !Number.isSafeInteger(retentionDays) || retentionDays < 1) throw new Error("Stored cleanup retention days are invalid");
  return {
    cleanupRunId: run.id,
    playerId: run.targetAccountIdSnapshot,
    username: run.targetUsernameSnapshot,
    retentionDays,
    cutoffAt: run.cutoffAt,
    counts: cleanupCounts(values)
  };
}

function cleanupCounts(values: Record<string, unknown>): PlayerDeletionCounts {
  const count = (key: keyof PlayerDeletionCounts): number => {
    const value = values[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`Stored cleanup count ${key} is invalid`);
    return value;
  };
  return {
    authSessions: count("authSessions"),
    loginEvents: count("loginEvents"),
    securityEvents: count("securityEvents"),
    ownedGameSessions: count("ownedGameSessions"),
    gameParticipations: count("gameParticipations"),
    gameResults: count("gameResults"),
    ledgerEntries: count("ledgerEntries"),
    adminAuditLogs: count("adminAuditLogs")
  };
}

function inactiveCleanupRunResult(run: { id: string; cutoffAt: Date | null; recordCounts: unknown }): InactivePlayerCleanupResult {
  if (run.cutoffAt === null || typeof run.recordCounts !== "object" || run.recordCounts === null || Array.isArray(run.recordCounts)) throw new Error("Stored inactive-player cleanup run is incomplete");
  const values = run.recordCounts as Record<string, unknown>;
  const integer = (key: string): number => {
    const value = values[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`Stored inactive cleanup value ${key} is invalid`);
    return value;
  };
  const includePositiveBalances = values.includePositiveBalances;
  const deletedBalance = values.deletedBalance;
  if (typeof includePositiveBalances !== "boolean") throw new Error("Stored positive-balance policy is invalid");
  if (typeof deletedBalance !== "string" || !/^[0-9]+$/u.test(deletedBalance)) throw new Error("Stored deleted balance is invalid");
  return {
    cleanupRunId: run.id,
    inactivityDays: integer("inactivityDays"),
    cutoffAt: run.cutoffAt,
    includePositiveBalances,
    batchSize: integer("batchSize"),
    deletedPlayers: integer("deletedPlayers"),
    deletedBalance: BigInt(deletedBalance),
    deletedRecords: cleanupCounts(values),
    remainingPlayers: integer("remainingPlayers")
  };
}
