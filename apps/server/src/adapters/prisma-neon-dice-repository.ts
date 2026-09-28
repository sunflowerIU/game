import type { DatabaseClient, Prisma } from "@game-platform/database";
import {
  NEON_DICE_VERSION,
  NeonDiceServiceError,
  parseNeonDiceConfiguration,
  parseNeonDiceResult,
  toNeonDiceResult,
  type NeonDiceRepository,
  type NeonDiceSessionRecord
} from "@game-platform/neon-dice";

export class PrismaNeonDiceRepository implements NeonDiceRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async playRoll(input: Parameters<NeonDiceRepository["playRoll"]>[0]) {
    try {
      return await this.database.$transaction(async (transaction) => {
        const walletIdentity = await transaction.wallet.findUnique({ where: { accountId: input.playerId }, select: { id: true } });
        if (walletIdentity === null) throw new NeonDiceServiceError("GAME_NOT_AVAILABLE", "Player wallet not found");
        await lockWallet(transaction, walletIdentity.id);
        const wallet = await transaction.wallet.findUniqueOrThrow({ where: { id: walletIdentity.id } });

        const replay = await transaction.gameSession.findUnique({
          where: { ownerAccountId_startIdempotencyKey: { ownerAccountId: input.playerId, startIdempotencyKey: input.idempotencyKey } },
          include: sessionInclude
        });
        if (replay !== null) {
          if (replay.gameId !== input.gameId || replay.entryAmount !== input.entryAmount) {
            throw new NeonDiceServiceError("IDEMPOTENCY_CONFLICT", "Idempotency key was used for a different Dice roll");
          }
          const replaySession = mapSession(replay);
          if (replaySession.details.selection !== input.selection) {
            throw new NeonDiceServiceError("IDEMPOTENCY_CONFLICT", "Idempotency key was used for a different Dice roll");
          }
          return { session: replaySession, replayed: true };
        }

        const game = await transaction.game.findFirst({
          where: { id: input.gameId, slug: "neon-dice", status: "ACTIVE" },
          include: { activeVersion: true }
        });
        if (game?.activeVersion === null || game?.activeVersion === undefined || game.activeVersion.version !== NEON_DICE_VERSION) {
          throw new NeonDiceServiceError("GAME_NOT_AVAILABLE", "Game is not available");
        }

        const active = await transaction.gameSession.findFirst({
          where: { ownerAccountId: input.playerId, status: { in: ["CREATED", "ACTIVE"] } },
          select: { id: true }
        });
        if (active !== null) throw new NeonDiceServiceError("SESSION_ALREADY_ACTIVE", "Player already has an active game session");

        const configuration = configurationFrom(game.activeVersion.configuration);
        if (input.entryAmount < game.activeVersion.minimumEntry || input.entryAmount > game.activeVersion.maximumEntry
          || !configuration.wagerDenominationsCents.some((amount) => BigInt(amount) === input.entryAmount)) {
          throw new NeonDiceServiceError("INVALID_ENTRY", "Choose an available Dice wager denomination");
        }
        if (wallet.balance < input.entryAmount) throw new NeonDiceServiceError("INSUFFICIENT_BALANCE", "Wallet has insufficient balance");

        const resolved = input.resolve(game.activeVersion.configuration as Readonly<Record<string, unknown>>);
        const roll = parseNeonDiceResult(toNeonDiceResult(resolved), input.entryAmount, configuration);
        if (roll.selection !== input.selection || roll.reward < 0n || roll.reward > BigInt(configuration.maximumPayoutCents)) {
          throw new NeonDiceServiceError("CONFLICT", "Game produced an invalid Dice result");
        }

        const session = await transaction.gameSession.create({ data: {
          ownerAccountId: input.playerId,
          gameId: game.id,
          gameVersionId: game.activeVersion.id,
          gameVersion: game.activeVersion.version,
          status: "ACTIVE",
          entryAmount: input.entryAmount,
          startIdempotencyKey: input.idempotencyKey,
          serverInstanceId: input.serverInstanceId,
          startedAt: input.occurredAt,
          participants: { create: { accountId: input.playerId } }
        } });

        const afterEntry = wallet.balance - input.entryAmount;
        await transaction.wallet.update({ where: { id: wallet.id }, data: { balance: afterEntry, version: { increment: 1 } } });
        await transaction.ledgerEntry.create({ data: {
          walletId: wallet.id,
          type: "GAME_ENTRY",
          amount: -input.entryAmount,
          balanceBefore: wallet.balance,
          balanceAfter: afterEntry,
          referenceType: "GAME_SESSION",
          referenceId: session.id,
          idempotencyKey: `game-start:${input.idempotencyKey}`,
          createdByType: "PLAYER",
          createdById: input.playerId,
          metadata: { gameSlug: game.slug, gameVersion: game.activeVersion.version, selection: input.selection }
        } });

        if (roll.reward > 0n) {
          const finalBalance = afterEntry + roll.reward;
          await transaction.wallet.update({ where: { id: wallet.id }, data: { balance: finalBalance, version: { increment: 1 } } });
          await transaction.ledgerEntry.create({ data: {
            walletId: wallet.id,
            type: "GAME_REWARD",
            amount: roll.reward,
            balanceBefore: afterEntry,
            balanceAfter: finalBalance,
            referenceType: "GAME_SESSION",
            referenceId: session.id,
            idempotencyKey: `game-settle:${session.id}`,
            createdByType: "GAME",
            metadata: { gameSlug: game.slug, gameVersion: game.activeVersion.version, selection: input.selection, multiplierBps: roll.multiplierBps, total: roll.total }
          } });
        }

        await transaction.gameResult.create({ data: {
          gameSessionId: session.id,
          outcome: "COMPLETED",
          score: roll.total,
          reward: roll.reward,
          details: toNeonDiceResult(roll) as unknown as Prisma.InputJsonValue
        } });
        await transaction.gameSession.update({
          where: { id: session.id },
          data: { status: "COMPLETED", completedAt: input.occurredAt, serverInstanceId: null, stateVersion: { increment: 1 } }
        });
        const completed = await transaction.gameSession.findUniqueOrThrow({ where: { id: session.id }, include: sessionInclude });
        return { session: mapSession(completed), replayed: false };
      });
    } catch (error: unknown) {
      if (isUniqueConflict(error)) throw new NeonDiceServiceError("CONFLICT", "Dice roll changed concurrently");
      throw error;
    }
  }
}

const sessionInclude = { result: true, version: true } as const;

function mapSession(session: {
  id: string;
  gameId: string;
  gameVersion: string;
  status: "CREATED" | "ACTIVE" | "COMPLETED" | "ABANDONED" | "FAILED";
  entryAmount: bigint;
  startedAt: Date | null;
  completedAt: Date | null;
  result: { score: number; reward: bigint; details: unknown } | null;
  version: { configuration: unknown };
}): NeonDiceSessionRecord {
  if (session.status !== "COMPLETED" || session.startedAt === null || session.completedAt === null || session.result === null) {
    throw new NeonDiceServiceError("CONFLICT", "Completed Dice record is incomplete");
  }
  const configuration = configurationFrom(session.version.configuration);
  const details = parseNeonDiceResult(session.result.details, session.entryAmount, configuration);
  if (session.result.score !== details.total || session.result.reward !== details.reward) {
    throw new NeonDiceServiceError("CONFLICT", "Stored Dice result disagrees with the session result");
  }
  return {
    id: session.id,
    gameId: session.gameId,
    gameVersion: session.gameVersion,
    status: "COMPLETED",
    entryAmount: session.entryAmount,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    score: session.result.score,
    reward: session.result.reward,
    details
  };
}

function configurationFrom(value: unknown) {
  try { return parseNeonDiceConfiguration(value); }
  catch { throw new NeonDiceServiceError("GAME_NOT_AVAILABLE", "Dice configuration is unavailable"); }
}

async function lockWallet(transaction: { $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T> }, walletId: string): Promise<void> {
  await transaction.$queryRaw`SELECT "id" FROM "Wallet" WHERE "id" = ${walletId}::uuid FOR UPDATE`;
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
