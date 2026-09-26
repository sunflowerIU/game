import type { AdminAuditRecord, InactivePlayerCleanupPreview, InactivePlayerCleanupResult, PlayerDeletionPreview, PlayerDeletionResult, PlayerRecord, PlayerRecordCleanupPreview, PlayerRecordCleanupResult, SessionCleanupPreview, SessionCleanupResult } from "@game-platform/admin";
import type { AuthorizedPrincipal } from "@game-platform/auth";
import type { AdminAuditListResponse, AdminAuditSummary, InactivePlayerCleanupPreviewResponse, InactivePlayerCleanupResponse, PlayerDeletionPreviewResponse, PlayerDeletionResponse, PlayerListResponse, PlayerRecordCleanupPreviewResponse, PlayerRecordCleanupResponse, PlayerSummary, SessionCleanupPreviewResponse, SessionCleanupResponse } from "@game-platform/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";

interface CreatePlayerBody { readonly username: string; readonly password: string; readonly reason: string }
interface StatusBody { readonly enabled: boolean; readonly reason: string }
interface ResetPasswordBody { readonly password: string; readonly reason: string }
interface DeletePlayerBody { readonly confirmationUsername: string; readonly allowPositiveBalance: boolean; readonly reason: string }
interface RetentionPreviewBody { readonly retentionDays: number }
interface RetentionDeleteBody extends RetentionPreviewBody { readonly reason: string }
interface InactivePreviewBody { readonly inactivityDays: number; readonly includePositiveBalances: boolean }
interface InactiveDeleteBody extends InactivePreviewBody { readonly batchSize: number; readonly reason: string }
interface SessionDeleteBody extends RetentionPreviewBody { readonly batchSize: number; readonly reason: string }
interface IdempotencyHeaders { readonly "idempotency-key": string }
interface PlayerParams { readonly playerId: string }

const reasonProperty = { type: "string", minLength: 3, maxLength: 500 } as const;
const passwordProperty = { type: "string", minLength: 8, maxLength: 1024 } as const;
const retentionDaysProperty = { type: "integer", minimum: 1, maximum: 3650 } as const;
const headersSchema = { type: "object", required: ["idempotency-key"], properties: { "idempotency-key": { type: "string", minLength: 16, maxLength: 100, pattern: "^[A-Za-z0-9._:-]+$" } } } as const;
const playerParamsSchema = { type: "object", required: ["playerId"], properties: { playerId: { type: "string", format: "uuid" } } } as const;
const cleanupCountsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["authSessions", "loginEvents", "securityEvents", "ownedGameSessions", "gameParticipations", "gameResults", "ledgerEntries", "adminAuditLogs"],
  properties: {
    authSessions: { type: "integer", minimum: 0 },
    loginEvents: { type: "integer", minimum: 0 },
    securityEvents: { type: "integer", minimum: 0 },
    ownedGameSessions: { type: "integer", minimum: 0 },
    gameParticipations: { type: "integer", minimum: 0 },
    gameResults: { type: "integer", minimum: 0 },
    ledgerEntries: { type: "integer", minimum: 0 },
    adminAuditLogs: { type: "integer", minimum: 0 }
  }
} as const;
const playerDeletionPreviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["playerId", "username", "status", "balance", "activeGameSessions", "counts"],
  properties: {
    playerId: { type: "string", format: "uuid" },
    username: { type: "string" },
    status: { type: "string", enum: ["ACTIVE", "DISABLED"] },
    balance: { type: "string", pattern: "^[0-9]+$" },
    activeGameSessions: { type: "integer", minimum: 0 },
    counts: cleanupCountsSchema
  }
} as const;
const playerDeletionResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["cleanupRunId", "playerId", "username", "balanceDeleted", "counts"],
  properties: {
    cleanupRunId: { type: "string", format: "uuid" },
    playerId: { type: "string", format: "uuid" },
    username: { type: "string" },
    balanceDeleted: { type: "string", pattern: "^[0-9]+$" },
    counts: cleanupCountsSchema
  }
} as const;
const recordCleanupPreviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["playerId", "username", "retentionDays", "cutoffAt", "counts"],
  properties: {
    playerId: { type: "string", format: "uuid" },
    username: { type: "string" },
    retentionDays: retentionDaysProperty,
    cutoffAt: { type: "string", format: "date-time" },
    counts: cleanupCountsSchema
  }
} as const;
const inactiveCleanupPreviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["inactivityDays", "cutoffAt", "includePositiveBalances", "inactivePlayers", "activeSessionPlayers", "positiveBalancePlayers", "positiveBalanceTotal", "deletablePlayers"],
  properties: {
    inactivityDays: retentionDaysProperty,
    cutoffAt: { type: "string", format: "date-time" },
    includePositiveBalances: { type: "boolean" },
    inactivePlayers: { type: "integer", minimum: 0 },
    activeSessionPlayers: { type: "integer", minimum: 0 },
    positiveBalancePlayers: { type: "integer", minimum: 0 },
    positiveBalanceTotal: { type: "string", pattern: "^[0-9]+$" },
    deletablePlayers: { type: "integer", minimum: 0 }
  }
} as const;
const inactiveCleanupResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["cleanupRunId", "inactivityDays", "cutoffAt", "includePositiveBalances", "batchSize", "deletedPlayers", "deletedBalance", "deletedRecords", "remainingPlayers"],
  properties: {
    cleanupRunId: { type: "string", format: "uuid" },
    inactivityDays: retentionDaysProperty,
    cutoffAt: { type: "string", format: "date-time" },
    includePositiveBalances: { type: "boolean" },
    batchSize: { type: "integer", minimum: 1, maximum: 100 },
    deletedPlayers: { type: "integer", minimum: 0 },
    deletedBalance: { type: "string", pattern: "^[0-9]+$" },
    deletedRecords: cleanupCountsSchema,
    remainingPlayers: { type: "integer", minimum: 0 }
  }
} as const;
const sessionCountsSchema = {
  type: "object", additionalProperties: false,
  required: ["authSessions", "gameSessions", "gameParticipations", "gameResults", "securityEvents"],
  properties: {
    authSessions: { type: "integer", minimum: 0 }, gameSessions: { type: "integer", minimum: 0 },
    gameParticipations: { type: "integer", minimum: 0 }, gameResults: { type: "integer", minimum: 0 }, securityEvents: { type: "integer", minimum: 0 }
  }
} as const;
const sessionCleanupPreviewSchema = {
  type: "object", additionalProperties: false, required: ["retentionDays", "cutoffAt", "counts"],
  properties: { retentionDays: retentionDaysProperty, cutoffAt: { type: "string", format: "date-time" }, counts: sessionCountsSchema }
} as const;
const sessionCleanupResponseSchema = {
  type: "object", additionalProperties: false, required: ["cleanupRunId", "retentionDays", "cutoffAt", "batchSize", "counts", "remaining"],
  properties: { ...sessionCleanupPreviewSchema.properties, cleanupRunId: { type: "string", format: "uuid" }, batchSize: { type: "integer", minimum: 1, maximum: 1000 }, remaining: sessionCountsSchema }
} as const;
const playerResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "username", "status", "balance", "lastLoginAt", "createdAt", "updatedAt"],
  properties: {
    id: { type: "string", format: "uuid" },
    username: { type: "string" },
    status: { type: "string", enum: ["ACTIVE", "DISABLED"] },
    balance: { type: "string", pattern: "^[0-9]+$" },
    lastLoginAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" }
  }
} as const;
const auditResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "adminUsername", "targetType", "targetLabel", "action", "amount", "reason", "ipAddress", "createdAt"],
  properties: {
    id: { type: "string" },
    adminUsername: { type: "string" },
    targetType: { type: "string", enum: ["ACCOUNT", "GAME"] },
    targetLabel: { type: "string" },
    action: { type: "string", enum: ["PLAYER_CREATED", "PLAYER_ENABLED", "PLAYER_DISABLED", "PLAYER_PASSWORD_RESET", "WALLET_CREDITED", "WALLET_DEBITED", "GAME_STATUS_CHANGED", "GAME_CONFIG_UPDATED"] },
    amount: { anyOf: [{ type: "string", pattern: "^[0-9]+$" }, { type: "null" }] },
    reason: { type: "string" },
    ipAddress: { type: "string" },
    createdAt: { type: "string", format: "date-time" }
  }
} as const;

export interface AdminApplication {
  listPlayers(principal: AuthorizedPrincipal): Promise<readonly PlayerRecord[]>;
  listAuditLogs(principal: AuthorizedPrincipal): Promise<readonly AdminAuditRecord[]>;
  createPlayer(principal: AuthorizedPrincipal, input: CreatePlayerBody & ReturnType<typeof requestContext>): Promise<PlayerRecord>;
  setPlayerEnabled(principal: AuthorizedPrincipal, input: StatusBody & PlayerParams & ReturnType<typeof requestContext>): Promise<PlayerRecord>;
  resetPassword(principal: AuthorizedPrincipal, input: ResetPasswordBody & PlayerParams & ReturnType<typeof requestContext>): Promise<void>;
  previewPlayerDeletion(principal: AuthorizedPrincipal, input: PlayerParams): Promise<PlayerDeletionPreview>;
  deletePlayer(principal: AuthorizedPrincipal, input: DeletePlayerBody & PlayerParams & { readonly idempotencyKey: string } & ReturnType<typeof requestContext>): Promise<PlayerDeletionResult>;
  previewPlayerRecordCleanup(principal: AuthorizedPrincipal, input: RetentionPreviewBody & PlayerParams): Promise<PlayerRecordCleanupPreview>;
  deletePlayerRecords(principal: AuthorizedPrincipal, input: RetentionDeleteBody & PlayerParams & { readonly idempotencyKey: string } & ReturnType<typeof requestContext>): Promise<PlayerRecordCleanupResult>;
  previewInactivePlayerCleanup(principal: AuthorizedPrincipal, input: InactivePreviewBody): Promise<InactivePlayerCleanupPreview>;
  deleteInactivePlayerBatch(principal: AuthorizedPrincipal, input: InactiveDeleteBody & { readonly idempotencyKey: string } & ReturnType<typeof requestContext>): Promise<InactivePlayerCleanupResult>;
  previewSessionCleanup(principal: AuthorizedPrincipal, input: RetentionPreviewBody): Promise<SessionCleanupPreview>;
  deleteSessionBatch(principal: AuthorizedPrincipal, input: SessionDeleteBody & { readonly idempotencyKey: string } & ReturnType<typeof requestContext>): Promise<SessionCleanupResult>;
}

export async function registerAdminRoutes(app: FastifyInstance, admin: AdminApplication): Promise<void> {
  app.get<{ Reply: AdminAuditListResponse }>("/api/v1/admin/audit-logs", {
    preHandler: app.authorize("SECURITY_VIEW"),
    schema: { response: { 200: { type: "object", additionalProperties: false, required: ["auditLogs"], properties: { auditLogs: { type: "array", items: auditResponseSchema } } } } }
  }, async (request) => ({ auditLogs: (await admin.listAuditLogs(requirePrincipal(request))).map(toAuditResponse) }));

  app.get<{ Reply: PlayerListResponse }>("/api/v1/admin/players", {
    preHandler: app.authorize("PLAYER_VIEW"),
    schema: { response: { 200: { type: "object", required: ["players"], properties: { players: { type: "array", items: playerResponseSchema } } } } }
  }, async (request) => ({ players: (await admin.listPlayers(requirePrincipal(request))).map(toPlayerResponse) }));

  app.post<{ Body: InactivePreviewBody; Reply: InactivePlayerCleanupPreviewResponse }>("/api/v1/admin/players/inactive-deletion-preview", {
    preHandler: app.authorize("DATA_RETENTION_MANAGE"),
    schema: {
      body: { type: "object", additionalProperties: false, required: ["inactivityDays", "includePositiveBalances"], properties: { inactivityDays: retentionDaysProperty, includePositiveBalances: { type: "boolean" } } },
      response: { 200: inactiveCleanupPreviewSchema }
    }
  }, async (request) => toInactivePlayerCleanupPreviewResponse(await admin.previewInactivePlayerCleanup(requirePrincipal(request), request.body)));

  app.post<{ Body: InactiveDeleteBody; Headers: IdempotencyHeaders; Reply: InactivePlayerCleanupResponse }>("/api/v1/admin/players/delete-inactive", {
    preHandler: app.authorize("DATA_RETENTION_MANAGE"),
    schema: {
      headers: headersSchema,
      body: { type: "object", additionalProperties: false, required: ["inactivityDays", "includePositiveBalances", "batchSize", "reason"], properties: {
        inactivityDays: retentionDaysProperty,
        includePositiveBalances: { type: "boolean" },
        batchSize: { type: "integer", minimum: 1, maximum: 100 },
        reason: reasonProperty
      } },
      response: { 200: inactiveCleanupResponseSchema }
    }
  }, async (request) => toInactivePlayerCleanupResponse(await admin.deleteInactivePlayerBatch(requirePrincipal(request), {
    ...request.body,
    idempotencyKey: request.headers["idempotency-key"],
    ...requestContext(request)
  })));

  app.post<{ Body: RetentionPreviewBody; Reply: SessionCleanupPreviewResponse }>("/api/v1/admin/sessions/deletion-preview", {
    preHandler: app.authorize("DATA_RETENTION_MANAGE"),
    schema: {
      body: { type: "object", additionalProperties: false, required: ["retentionDays"], properties: { retentionDays: retentionDaysProperty } },
      response: { 200: sessionCleanupPreviewSchema }
    }
  }, async (request) => toSessionCleanupPreviewResponse(await admin.previewSessionCleanup(requirePrincipal(request), request.body)));

  app.post<{ Body: SessionDeleteBody; Headers: IdempotencyHeaders; Reply: SessionCleanupResponse }>("/api/v1/admin/sessions/delete", {
    preHandler: app.authorize("DATA_RETENTION_MANAGE"),
    schema: {
      headers: headersSchema,
      body: { type: "object", additionalProperties: false, required: ["retentionDays", "batchSize", "reason"], properties: { retentionDays: retentionDaysProperty, batchSize: { type: "integer", minimum: 1, maximum: 1000 }, reason: reasonProperty } },
      response: { 200: sessionCleanupResponseSchema }
    }
  }, async (request) => toSessionCleanupResponse(await admin.deleteSessionBatch(requirePrincipal(request), {
    ...request.body,
    idempotencyKey: request.headers["idempotency-key"],
    ...requestContext(request)
  })));

  app.post<{ Body: CreatePlayerBody; Reply: PlayerSummary }>("/api/v1/admin/players", {
    preHandler: app.authorize("PLAYER_CREATE"),
    schema: {
      body: { type: "object", additionalProperties: false, required: ["username", "password", "reason"], properties: {
        username: { type: "string", minLength: 3, maxLength: 32, pattern: "^[A-Za-z0-9_.-]+$" },
        password: passwordProperty,
        reason: reasonProperty
      } },
      response: { 201: playerResponseSchema }
    }
  }, async (request, reply) => {
    const player = await admin.createPlayer(requirePrincipal(request), { ...request.body, ...requestContext(request) });
    return reply.status(201).send(toPlayerResponse(player));
  });

  app.post<{ Params: PlayerParams; Body: StatusBody; Reply: PlayerSummary }>("/api/v1/admin/players/:playerId/status", {
    preHandler: app.authorize("PLAYER_DISABLE"),
    schema: {
      params: { type: "object", required: ["playerId"], properties: { playerId: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["enabled", "reason"], properties: { enabled: { type: "boolean" }, reason: reasonProperty } },
      response: { 200: playerResponseSchema }
    }
  }, async (request) => toPlayerResponse(await admin.setPlayerEnabled(requirePrincipal(request), {
    playerId: request.params.playerId, ...request.body, ...requestContext(request)
  })));

  app.post<{ Params: PlayerParams; Body: ResetPasswordBody }>("/api/v1/admin/players/:playerId/password", {
    preHandler: app.authorize("PLAYER_PASSWORD_RESET"),
    schema: {
      params: { type: "object", required: ["playerId"], properties: { playerId: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["password", "reason"], properties: { password: passwordProperty, reason: reasonProperty } }
    }
  }, async (request, reply) => {
    await admin.resetPassword(requirePrincipal(request), { playerId: request.params.playerId, ...request.body, ...requestContext(request) });
    return reply.status(204).send();
  });

  app.post<{ Params: PlayerParams; Reply: PlayerDeletionPreviewResponse }>("/api/v1/admin/players/:playerId/deletion-preview", {
    preHandler: app.authorize("PLAYER_DELETE"),
    schema: { params: playerParamsSchema, response: { 200: playerDeletionPreviewSchema } }
  }, async (request) => toPlayerDeletionPreviewResponse(await admin.previewPlayerDeletion(requirePrincipal(request), request.params)));

  app.post<{ Params: PlayerParams; Body: DeletePlayerBody; Headers: IdempotencyHeaders; Reply: PlayerDeletionResponse }>("/api/v1/admin/players/:playerId/delete", {
    preHandler: app.authorize("PLAYER_DELETE"),
    schema: {
      params: playerParamsSchema,
      headers: headersSchema,
      body: { type: "object", additionalProperties: false, required: ["confirmationUsername", "allowPositiveBalance", "reason"], properties: {
        confirmationUsername: { type: "string", minLength: 1, maxLength: 32 },
        allowPositiveBalance: { type: "boolean" },
        reason: reasonProperty
      } },
      response: { 200: playerDeletionResponseSchema }
    }
  }, async (request) => toPlayerDeletionResponse(await admin.deletePlayer(requirePrincipal(request), {
    playerId: request.params.playerId,
    ...request.body,
    idempotencyKey: request.headers["idempotency-key"],
    ...requestContext(request)
  })));

  app.post<{ Params: PlayerParams; Body: RetentionPreviewBody; Reply: PlayerRecordCleanupPreviewResponse }>("/api/v1/admin/players/:playerId/records/deletion-preview", {
    preHandler: app.authorize("DATA_RETENTION_MANAGE"),
    schema: {
      params: playerParamsSchema,
      body: { type: "object", additionalProperties: false, required: ["retentionDays"], properties: { retentionDays: retentionDaysProperty } },
      response: { 200: recordCleanupPreviewSchema }
    }
  }, async (request) => toPlayerRecordCleanupPreviewResponse(await admin.previewPlayerRecordCleanup(requirePrincipal(request), { playerId: request.params.playerId, ...request.body })));

  app.post<{ Params: PlayerParams; Body: RetentionDeleteBody; Headers: IdempotencyHeaders; Reply: PlayerRecordCleanupResponse }>("/api/v1/admin/players/:playerId/records/delete", {
    preHandler: app.authorize("DATA_RETENTION_MANAGE"),
    schema: {
      params: playerParamsSchema,
      headers: headersSchema,
      body: { type: "object", additionalProperties: false, required: ["retentionDays", "reason"], properties: { retentionDays: retentionDaysProperty, reason: reasonProperty } },
      response: { 200: { ...recordCleanupPreviewSchema, required: [...recordCleanupPreviewSchema.required, "cleanupRunId"], properties: { ...recordCleanupPreviewSchema.properties, cleanupRunId: { type: "string", format: "uuid" } } } }
    }
  }, async (request) => toPlayerRecordCleanupResponse(await admin.deletePlayerRecords(requirePrincipal(request), {
    playerId: request.params.playerId,
    ...request.body,
    idempotencyKey: request.headers["idempotency-key"],
    ...requestContext(request)
  })));
}

function requirePrincipal(request: FastifyRequest) {
  if (request.principal === null) throw new Error("Authorization hook did not set a principal");
  return request.principal;
}

function requestContext(request: FastifyRequest) {
  return { ipAddress: request.ip, userAgent: request.headers["user-agent"]?.slice(0, 512) ?? null };
}

function toPlayerResponse(player: PlayerRecord): PlayerSummary {
  return { ...player, balance: player.balance.toString(), lastLoginAt: player.lastLoginAt?.toISOString() ?? null, createdAt: player.createdAt.toISOString(), updatedAt: player.updatedAt.toISOString() };
}

function toAuditResponse(record: AdminAuditRecord): AdminAuditSummary {
  return { ...record, amount: record.amount?.toString() ?? null, createdAt: record.createdAt.toISOString() };
}

function toPlayerDeletionPreviewResponse(preview: PlayerDeletionPreview): PlayerDeletionPreviewResponse {
  return { ...preview, balance: preview.balance.toString() };
}

function toPlayerDeletionResponse(result: PlayerDeletionResult): PlayerDeletionResponse {
  return { ...result, balanceDeleted: result.balanceDeleted.toString() };
}

function toPlayerRecordCleanupPreviewResponse(preview: PlayerRecordCleanupPreview): PlayerRecordCleanupPreviewResponse {
  return { ...preview, cutoffAt: preview.cutoffAt.toISOString() };
}

function toPlayerRecordCleanupResponse(result: PlayerRecordCleanupResult): PlayerRecordCleanupResponse {
  return { ...result, cutoffAt: result.cutoffAt.toISOString() };
}

function toInactivePlayerCleanupPreviewResponse(preview: InactivePlayerCleanupPreview): InactivePlayerCleanupPreviewResponse {
  return { ...preview, cutoffAt: preview.cutoffAt.toISOString(), positiveBalanceTotal: preview.positiveBalanceTotal.toString() };
}

function toInactivePlayerCleanupResponse(result: InactivePlayerCleanupResult): InactivePlayerCleanupResponse {
  return { ...result, cutoffAt: result.cutoffAt.toISOString(), deletedBalance: result.deletedBalance.toString() };
}

function toSessionCleanupPreviewResponse(preview: SessionCleanupPreview): SessionCleanupPreviewResponse {
  return { ...preview, cutoffAt: preview.cutoffAt.toISOString() };
}

function toSessionCleanupResponse(result: SessionCleanupResult): SessionCleanupResponse {
  return { ...result, cutoffAt: result.cutoffAt.toISOString() };
}
