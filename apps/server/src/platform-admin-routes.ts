import type { AdminGameRecord, AdminGameSessionRecord, ManagedGameStatus, PlayerDetailRecord, SecurityEventRecord } from "@game-platform/admin";
import type { AuthorizedPrincipal } from "@game-platform/auth";
import type { FastifyInstance, FastifyRequest } from "fastify";

interface GameParams { readonly gameId: string } interface PlayerParams { readonly playerId: string }
interface StatusBody { readonly status: "ACTIVE" | "DISABLED" | "MAINTENANCE" | "DEPRECATED"; readonly reason: string }
interface ConfigurationBody { readonly minimumEntry: string; readonly maximumEntry: string; readonly configuration: Readonly<Record<string, unknown>>; readonly reason: string }
const reason = { type: "string", minLength: 3, maxLength: 500 } as const;
const gameParams = { type: "object", required: ["gameId"], properties: { gameId: { type: "string", format: "uuid" } } } as const;

export async function registerPlatformAdminRoutes(app: FastifyInstance, service: PlatformAdminService): Promise<void> {
  app.get("/api/v1/admin/games", { preHandler: app.authorize("GAME_VIEW") }, async (request) => ({ games: (await service.listGames(principal(request))).map(gameResponse) }));
  app.post<{ Params: GameParams; Body: StatusBody }>("/api/v1/admin/games/:gameId/status", { preHandler: app.authorize("GAME_MANAGE"), schema: { params: gameParams, body: { type: "object", additionalProperties: false, required: ["status", "reason"], properties: { status: { type: "string", enum: ["ACTIVE", "DISABLED", "MAINTENANCE", "DEPRECATED"] }, reason } } } }, async (request) => gameResponse(await service.setGameStatus(principal(request), { gameId: request.params.gameId, ...request.body, ...context(request) })));
  app.post<{ Params: GameParams; Body: ConfigurationBody }>("/api/v1/admin/games/:gameId/configuration", { preHandler: app.authorize("GAME_MANAGE"), schema: { params: gameParams, body: { type: "object", additionalProperties: false, required: ["minimumEntry", "maximumEntry", "configuration", "reason"], properties: { minimumEntry: { type: "string", pattern: "^(0|[1-9][0-9]{0,18})$" }, maximumEntry: { type: "string", pattern: "^(0|[1-9][0-9]{0,18})$" }, configuration: { type: "object", additionalProperties: true }, reason } } } }, async (request) => gameResponse(await service.updateConfiguration(principal(request), { gameId: request.params.gameId, ...request.body, ...context(request) })));
  app.get("/api/v1/admin/game-sessions", { preHandler: app.authorize("GAME_VIEW") }, async (request) => ({ sessions: (await service.listGameSessions(principal(request))).map(sessionResponse) }));
  app.get("/api/v1/admin/security-events", { preHandler: app.authorize("SECURITY_VIEW") }, async (request) => ({ events: (await service.listSecurityEvents(principal(request))).map(securityResponse) }));
  app.get<{ Params: PlayerParams }>("/api/v1/admin/players/:playerId/details", { preHandler: app.authorize("PLAYER_VIEW"), schema: { params: { type: "object", required: ["playerId"], properties: { playerId: { type: "string", format: "uuid" } } } } }, async (request) => detailResponse(await service.getPlayerDetail(principal(request), request.params.playerId)));
}
export interface PlatformAdminService {
  listGames(principal: AuthorizedPrincipal): Promise<readonly AdminGameRecord[]>;
  listGameSessions(principal: AuthorizedPrincipal): Promise<readonly AdminGameSessionRecord[]>;
  listSecurityEvents(principal: AuthorizedPrincipal): Promise<readonly SecurityEventRecord[]>;
  getPlayerDetail(principal: AuthorizedPrincipal, playerId: string): Promise<PlayerDetailRecord>;
  setGameStatus(principal: AuthorizedPrincipal, input: { gameId: string; status: ManagedGameStatus; reason: string; ipAddress: string; userAgent: string | null }): Promise<AdminGameRecord>;
  updateConfiguration(principal: AuthorizedPrincipal, input: { gameId: string; minimumEntry: string; maximumEntry: string; configuration: Readonly<Record<string, unknown>>; reason: string; ipAddress: string; userAgent: string | null }): Promise<AdminGameRecord>;
}
function principal(request: FastifyRequest): AuthorizedPrincipal { if (request.principal === null) throw new Error("Authorization hook did not set a principal"); return request.principal; }
function context(request: FastifyRequest) { return { ipAddress: request.ip, userAgent: request.headers["user-agent"]?.slice(0, 512) ?? null }; }
function gameResponse(game: AdminGameRecord) { return { ...game, minimumEntry: game.minimumEntry.toString(), maximumEntry: game.maximumEntry.toString(), updatedAt: game.updatedAt.toISOString() }; }
function sessionResponse(session: AdminGameSessionRecord) { return { ...session, entryAmount: session.entryAmount.toString(), reward: session.reward?.toString() ?? null, startedAt: session.startedAt?.toISOString() ?? null, completedAt: session.completedAt?.toISOString() ?? null }; }
function securityResponse(event: SecurityEventRecord) { return { ...event, createdAt: event.createdAt.toISOString() }; }
function detailResponse(detail: PlayerDetailRecord) { return { player: { ...detail.player, balance: detail.player.balance.toString(), lastLoginAt: detail.player.lastLoginAt?.toISOString() ?? null, createdAt: detail.player.createdAt.toISOString(), updatedAt: detail.player.updatedAt.toISOString() }, loginEvents: detail.loginEvents.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })), ledgerEntries: detail.ledgerEntries.map((entry) => ({ ...entry, amount: entry.amount.toString(), balanceAfter: entry.balanceAfter.toString(), createdAt: entry.createdAt.toISOString() })), gameSessions: detail.gameSessions.map(sessionResponse) }; }
