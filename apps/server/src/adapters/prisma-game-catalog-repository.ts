import type { DatabaseClient } from "@game-platform/database";
import type { GameCatalogRecord, GameCatalogRepository } from "@game-platform/game-core";

export class PrismaGameCatalogRepository implements GameCatalogRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async listActiveGames(): Promise<readonly GameCatalogRecord[]> {
    const games = await this.database.game.findMany({
      where: { status: "ACTIVE", activeVersionId: { not: null } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      include: { activeVersion: true }
    });
    return games.map((game) => {
      if (game.activeVersion === null) throw new Error("ACTIVE game is missing its active version");
      const configuration = game.activeVersion.configuration;
      if (typeof configuration !== "object" || configuration === null || Array.isArray(configuration)) throw new Error("Game configuration must be a JSON object");
      return {
        id: game.id, slug: game.slug, name: game.name, status: game.status, gameType: game.gameType,
        version: game.activeVersion.version, minimumEntry: game.activeVersion.minimumEntry,
        maximumEntry: game.activeVersion.maximumEntry, configuration
      };
    });
  }
}
