import type { AuthorizedPrincipal } from "@game-platform/auth";
import type { ActiveGameSessionResponse, GameHistoryResponse, GameSessionSummary, StartGameSessionResponse } from "@game-platform/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";

interface GameParams { readonly gameId: string }
interface StartBody { readonly entryAmount: number }
interface StartHeaders { readonly "idempotency-key": string }
interface GameSessionRecord { readonly id: string; readonly gameId: string; readonly gameVersion: string; readonly status: "CREATED" | "ACTIVE" | "COMPLETED" | "ABANDONED" | "FAILED"; readonly entryAmount: bigint; readonly startedAt: Date; readonly completedAt: Date | null; readonly score: number | null; readonly reward: bigint | null }
export interface GameSessionApplication {
  start(principal: AuthorizedPrincipal, input: { readonly gameId: string; readonly entryAmount: bigint; readonly idempotencyKey: string; readonly ipAddress: string }): Promise<{ readonly session: GameSessionRecord; readonly publicState: unknown; readonly replayed: boolean; readonly nextSequence: number }>;
  history(principal: AuthorizedPrincipal): Promise<readonly GameSessionRecord[]>;
  resume(principal: AuthorizedPrincipal): Promise<{ readonly session: GameSessionRecord; readonly publicState: unknown; readonly nextSequence: number } | null>;
}
const sessionSchema = { type: "object", additionalProperties: false, required: ["id", "gameId", "gameVersion", "status", "entryAmount", "startedAt", "completedAt", "score", "reward"], properties: {
  id: { type: "string", format: "uuid" }, gameId: { type: "string", format: "uuid" }, gameVersion: { type: "string" }, status: { type: "string", enum: ["CREATED", "ACTIVE", "COMPLETED", "ABANDONED", "FAILED"] },
  entryAmount: { type: "string", pattern: "^[0-9]+$" }, startedAt: { type: "string", format: "date-time" }, completedAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] }, score: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] }, reward: { anyOf: [{ type: "string", pattern: "^[0-9]+$" }, { type: "null" }] }
} } as const;

export async function registerGameSessionRoutes(app: FastifyInstance, sessions: GameSessionApplication): Promise<void> {
  app.post<{ Params: GameParams; Body: StartBody; Headers: StartHeaders; Reply: StartGameSessionResponse }>("/api/v1/games/:gameId/sessions", {
    preHandler: app.authenticate,
    schema: {
      params: { type: "object", additionalProperties: false, required: ["gameId"], properties: { gameId: { type: "string", format: "uuid" } } },
      headers: { type: "object", required: ["idempotency-key"], properties: { "idempotency-key": { type: "string", minLength: 16, maxLength: 80, pattern: "^[A-Za-z0-9._:-]+$" } } },
      body: { type: "object", additionalProperties: false, required: ["entryAmount"], properties: { entryAmount: { type: "integer", minimum: 0, maximum: 1_000_000_000 } } },
      response: { 200: { type: "object", additionalProperties: false, required: ["session", "publicState", "replayed", "nextSequence"], properties: { session: sessionSchema, publicState: {}, replayed: { type: "boolean" }, nextSequence: { type: "integer", minimum: 1 } } } }
    }
  }, async (request) => {
    const result = await sessions.start(requirePrincipal(request), { gameId: request.params.gameId, entryAmount: BigInt(request.body.entryAmount), idempotencyKey: request.headers["idempotency-key"], ipAddress: request.ip });
    return { ...result, session: toSummary(result.session) };
  });
  app.get<{ Reply: GameHistoryResponse }>("/api/v1/game-sessions", { preHandler: app.authenticate, schema: { response: { 200: { type: "object", required: ["sessions"], properties: { sessions: { type: "array", items: sessionSchema } } } } } }, async (request) => ({ sessions: (await sessions.history(requirePrincipal(request))).map(toSummary) }));
  app.get<{ Reply: ActiveGameSessionResponse }>("/api/v1/game-sessions/active", { preHandler: app.authenticate }, async (request) => {
    const active = await sessions.resume(requirePrincipal(request));
    return { active: active === null ? null : { session: toSummary(active.session), publicState: active.publicState, replayed: true, nextSequence: active.nextSequence } };
  });
}
function requirePrincipal(request: FastifyRequest): AuthorizedPrincipal { if (request.principal === null) throw new Error("Authorization hook did not set a principal"); return request.principal; }
function toSummary(session: GameSessionRecord): GameSessionSummary { return { id: session.id, gameId: session.gameId, gameVersion: session.gameVersion, status: session.status, entryAmount: session.entryAmount.toString(), startedAt: session.startedAt.toISOString(), completedAt: session.completedAt?.toISOString() ?? null, score: session.score, reward: session.reward?.toString() ?? null }; }
