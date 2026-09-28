import type { AuthorizedPrincipal } from "@game-platform/auth";
import type { GameCatalogItem, GameCatalogResponse } from "@game-platform/contracts";
import type { GameCatalogRecord } from "@game-platform/game-core";
import type { FastifyInstance, FastifyRequest } from "fastify";

export interface GameCatalogApplication { listGames(principal: AuthorizedPrincipal): Promise<readonly GameCatalogRecord[]>; }

const gameSchema = { type: "object", additionalProperties: false, required: ["id", "slug", "name", "status", "gameType", "version", "minimumEntry", "maximumEntry", "configuration"], properties: {
  id: { type: "string", format: "uuid" }, slug: { type: "string" }, name: { type: "string" }, status: { type: "string", const: "ACTIVE" },
  gameType: { type: "string", enum: ["SINGLE_PLAYER", "MULTIPLAYER"] }, version: { type: "string" }, minimumEntry: { type: "string", pattern: "^[0-9]+$" }, maximumEntry: { type: "string", pattern: "^[0-9]+$" }, configuration: { type: "object", additionalProperties: true }
} } as const;

export async function registerGameRoutes(app: FastifyInstance, catalog: GameCatalogApplication): Promise<void> {
  app.get<{ Reply: GameCatalogResponse }>("/api/v1/games", { preHandler: app.authenticate, schema: { response: { 200: { type: "object", required: ["games"], properties: { games: { type: "array", items: gameSchema } } } } } }, async (request) => ({ games: (await catalog.listGames(requirePrincipal(request))).map(toGameItem) }));
}
function requirePrincipal(request: FastifyRequest): AuthorizedPrincipal { if (request.principal === null) throw new Error("Authorization hook did not set a principal"); return request.principal; }
function toGameItem(game: GameCatalogRecord): GameCatalogItem { return { ...game, status: "ACTIVE", minimumEntry: game.minimumEntry.toString(), maximumEntry: game.maximumEntry.toString() }; }
