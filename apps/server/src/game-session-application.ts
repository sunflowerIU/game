import type { AuthorizedPrincipal } from "@game-platform/auth";
import type { NeonMinesCommandRequest } from "@game-platform/contracts";
import type { DatabaseClient } from "@game-platform/database";
import { NeonDiceServiceError, type NeonDiceService } from "@game-platform/neon-dice";
import type { NeonReelsService } from "@game-platform/neon-reels";
import { NeonMinesError, type PrismaNeonMinesRepository } from "./adapters/prisma-neon-mines-repository.js";
import type { GameSessionApplication } from "./game-session-routes.js";

export class DurableGameSessions implements GameSessionApplication {
  public constructor(private readonly database: DatabaseClient, private readonly reels: NeonReelsService, private readonly mines: PrismaNeonMinesRepository, private readonly dice: NeonDiceService) {}
  public async start(principal: AuthorizedPrincipal, input: Parameters<GameSessionApplication["start"]>[1]) {
    requirePlayer(principal);
    const game = await this.database.game.findUnique({ where: { id: input.gameId }, select: { slug: true } });
    if (game?.slug === "neon-mines") {
      if (input.difficulty === undefined) throw new NeonMinesError("INVALID_ENTRY", "Choose a Mines difficulty");
      if (input.selection !== undefined) throw new NeonMinesError("INVALID_ENTRY", "Neon Mines does not accept a Dice selection");
      return this.mines.start({ ...input, playerId: principal.accountId, difficulty: input.difficulty });
    }
    if (game?.slug === "neon-dice") {
      if (input.selection === undefined) throw new NeonDiceServiceError("INVALID_ENTRY", "Choose a Dice selection");
      if (input.difficulty !== undefined) throw new NeonDiceServiceError("INVALID_ENTRY", "Neon Dice does not accept a difficulty");
      return this.dice.roll(principal, { ...input, selection: input.selection });
    }
    if (game?.slug === "neon-reels") {
      if (input.difficulty !== undefined || input.selection !== undefined) throw new NeonMinesError("INVALID_ENTRY", "Neon Reels accepts only a wager");
      return this.reels.spin(principal, input);
    }
    throw new NeonMinesError("GAME_NOT_AVAILABLE", "Game is not available");
  }
  public async command(principal: AuthorizedPrincipal, sessionId: string, input: NeonMinesCommandRequest) {
    requirePlayer(principal);
    return this.mines.command(principal.accountId, sessionId, input);
  }
  public async resume(principal: AuthorizedPrincipal) {
    requirePlayer(principal);
    return this.mines.resume(principal.accountId);
  }
  public async history(principal: AuthorizedPrincipal) {
    requirePlayer(principal);
    const rows = await this.database.gameSession.findMany({ where: { ownerAccountId: principal.accountId, status: { in: ["COMPLETED", "ABANDONED", "FAILED"] } }, include: { result: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50 });
    return rows.map((row) => ({ id: row.id, gameId: row.gameId, gameVersion: row.gameVersion, status: row.status, entryAmount: row.entryAmount, startedAt: row.startedAt!, completedAt: row.completedAt, score: row.result?.score ?? null, reward: row.result?.reward ?? null }));
  }
}
function requirePlayer(principal: AuthorizedPrincipal) { if (principal.type !== "PLAYER") throw new NeonMinesError("ACCESS_DENIED", "Player game access required"); }
