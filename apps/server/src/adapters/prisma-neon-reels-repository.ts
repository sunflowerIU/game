import type { DatabaseClient, Prisma } from "@game-platform/database";
import { NeonReelsError, parseNeonReelsResult, toNeonReelsResult, type NeonReelsRepository, type NeonReelsSessionRecord } from "@game-platform/neon-reels";

export class PrismaNeonReelsRepository implements NeonReelsRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async playSpin(input: Parameters<NeonReelsRepository["playSpin"]>[0]) {
    try {
      return await this.database.$transaction(async (transaction) => {
        const game = await transaction.game.findFirst({ where: { id: input.gameId, slug: "neon-reels", status: "ACTIVE" }, include: { activeVersion: true } });
        if (game?.activeVersion === null || game?.activeVersion === undefined) throw new NeonReelsError("GAME_NOT_AVAILABLE", "Game is not available");
        const wallet = await transaction.wallet.findUnique({ where: { accountId: input.playerId } });
        if (wallet === null) throw new NeonReelsError("GAME_NOT_AVAILABLE", "Player wallet not found");
        await lockWallet(transaction, wallet.id);

        const replay = await transaction.gameSession.findUnique({ where: { ownerAccountId_startIdempotencyKey: { ownerAccountId: input.playerId, startIdempotencyKey: input.idempotencyKey } }, include: sessionInclude });
        if (replay !== null) {
          if (replay.gameId !== input.gameId || replay.entryAmount !== input.entryAmount) throw new NeonReelsError("IDEMPOTENCY_CONFLICT", "Idempotency key was used for a different spin");
          return { session: mapSession(replay), replayed: true };
        }
        const active = await transaction.gameSession.findFirst({ where: { ownerAccountId: input.playerId, status: { in: ["CREATED", "ACTIVE"] } }, select: { id: true } });
        if (active !== null) throw new NeonReelsError("SESSION_ALREADY_ACTIVE", "Player already has an active game session");
        if (input.entryAmount < game.activeVersion.minimumEntry || input.entryAmount > game.activeVersion.maximumEntry) throw new NeonReelsError("INVALID_ENTRY", "Wager is outside the configured range");
        const configuration = jsonObject(game.activeVersion.configuration);
        if (!isAllowedWager(configuration.wagerDenominationsCents, input.entryAmount)) throw new NeonReelsError("INVALID_ENTRY", "Choose an available wager denomination");
        if (wallet.balance < input.entryAmount) throw new NeonReelsError("INSUFFICIENT_BALANCE", "Wallet has insufficient balance");

        const spin = input.resolve(configuration);
        if (spin.reward < 0n) throw new NeonReelsError("CONFLICT", "Game produced an invalid reward");
        const session = await transaction.gameSession.create({ data: {
          ownerAccountId: input.playerId, gameId: game.id, gameVersionId: game.activeVersion.id, gameVersion: game.activeVersion.version,
          status: "ACTIVE", entryAmount: input.entryAmount, startIdempotencyKey: input.idempotencyKey, serverInstanceId: input.serverInstanceId,
          startedAt: input.occurredAt, participants: { create: { accountId: input.playerId } }
        } });

        const afterEntry = wallet.balance - input.entryAmount;
        await transaction.wallet.update({ where: { id: wallet.id }, data: { balance: afterEntry, version: { increment: 1 } } });
        await transaction.ledgerEntry.create({ data: {
          walletId: wallet.id, type: "GAME_ENTRY", amount: -input.entryAmount, balanceBefore: wallet.balance, balanceAfter: afterEntry,
          referenceType: "GAME_SESSION", referenceId: session.id, idempotencyKey: `game-start:${input.idempotencyKey}`,
          createdByType: "PLAYER", createdById: input.playerId, metadata: { gameSlug: game.slug, gameVersion: game.activeVersion.version }
        } });

        let finalBalance = afterEntry;
        if (spin.reward > 0n) {
          finalBalance += spin.reward;
          await transaction.wallet.update({ where: { id: wallet.id }, data: { balance: finalBalance, version: { increment: 1 } } });
          await transaction.ledgerEntry.create({ data: {
            walletId: wallet.id, type: "GAME_REWARD", amount: spin.reward, balanceBefore: afterEntry, balanceAfter: finalBalance,
            referenceType: "GAME_SESSION", referenceId: session.id, idempotencyKey: `game-settle:${session.id}`,
            createdByType: "GAME", metadata: { gameSlug: game.slug, gameVersion: game.activeVersion.version, multiplier: spin.totalMultiplier }
          } });
        }

        await transaction.gameResult.create({ data: { gameSessionId: session.id, outcome: "COMPLETED", score: spin.totalMultiplier, reward: spin.reward, details: toNeonReelsResult(spin) as unknown as Prisma.InputJsonValue } });
        await transaction.gameSession.update({ where: { id: session.id }, data: { status: "COMPLETED", completedAt: input.occurredAt, serverInstanceId: null, stateVersion: { increment: 1 } } });
        const completed = await transaction.gameSession.findUniqueOrThrow({ where: { id: session.id }, include: sessionInclude });
        return { session: mapSession(completed), replayed: false };
      });
    } catch (error: unknown) {
      if (isUniqueConflict(error)) throw new NeonReelsError("CONFLICT", "Spin changed concurrently");
      throw error;
    }
  }

  public async listHistory(playerId: string, limit: number): Promise<readonly NeonReelsSessionRecord[]> {
    const sessions = await this.database.gameSession.findMany({
      where: { ownerAccountId: playerId, game: { slug: "neon-reels" }, status: "COMPLETED" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      include: sessionInclude
    });
    return sessions.map(mapSession);
  }
}

const sessionInclude = { result: true } as const;
function mapSession(session: { id: string; gameId: string; gameVersion: string; status: "CREATED" | "ACTIVE" | "COMPLETED" | "ABANDONED" | "FAILED"; entryAmount: bigint; startedAt: Date | null; completedAt: Date | null; result: { score: number; reward: bigint; details: unknown } | null }): NeonReelsSessionRecord {
  if (session.status !== "COMPLETED" || session.startedAt === null || session.completedAt === null || session.result === null) throw new NeonReelsError("CONFLICT", "Completed spin record is incomplete");
  return { id: session.id, gameId: session.gameId, gameVersion: session.gameVersion, status: "COMPLETED", entryAmount: session.entryAmount, startedAt: session.startedAt, completedAt: session.completedAt, score: session.result.score, reward: session.result.reward, details: parseNeonReelsResult(session.result.details) };
}
function jsonObject(value: unknown): Readonly<Record<string, unknown>> { if (typeof value !== "object" || value === null || Array.isArray(value)) throw new NeonReelsError("GAME_NOT_AVAILABLE", "Game configuration is invalid"); return value as Readonly<Record<string, unknown>>; }
function isAllowedWager(value: unknown, amount: bigint): boolean { return Array.isArray(value) && value.some((candidate) => Number.isSafeInteger(candidate) && BigInt(candidate as number) === amount); }
async function lockWallet(transaction: { $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T> }, walletId: string): Promise<void> { await transaction.$queryRaw`SELECT "id" FROM "Wallet" WHERE "id" = ${walletId}::uuid FOR UPDATE`; }
function isUniqueConflict(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === "P2002"; }
