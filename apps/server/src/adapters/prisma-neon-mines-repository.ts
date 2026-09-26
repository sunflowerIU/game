import { createHash } from "node:crypto";
import type { DatabaseClient, Prisma } from "@game-platform/database";
import type { NeonMinesCommandRequest, NeonMinesDifficulty } from "@game-platform/contracts";
import { NeonMinesEngine, parseNeonMinesConfiguration, validateDifficultyWager, type NeonMinesRandom, type NeonMinesSnapshot } from "@game-platform/neon-mines";

export class NeonMinesError extends Error {
  public constructor(public readonly code: "ACCESS_DENIED" | "GAME_NOT_AVAILABLE" | "INVALID_ENTRY" | "INVALID_GAME_INPUT" | "SESSION_NOT_FOUND" | "SESSION_ALREADY_ACTIVE" | "SESSION_COMPLETE" | "IDEMPOTENCY_CONFLICT" | "REPLAYED_SEQUENCE" | "INSUFFICIENT_BALANCE", message: string) { super(message); this.name = "NeonMinesError"; }
}
const include = { privateState: true, version: true, result: true } as const;
type Stored = Prisma.GameSessionGetPayload<{ include: typeof include }>;
type Transaction = Prisma.TransactionClient;
const idleTimeoutMs = 15 * 60 * 1000;

export class PrismaNeonMinesRepository {
  public constructor(private readonly database: DatabaseClient, private readonly clock = () => new Date(), private readonly random?: NeonMinesRandom) {}

  public async start(input: { playerId: string; gameId: string; entryAmount: bigint; difficulty: NeonMinesDifficulty; idempotencyKey: string }) {
    return this.database.$transaction(async (tx) => {
      const wallet = await lockPlayerWallet(tx, input.playerId, true);
      const replay = await tx.gameSession.findUnique({ where: { ownerAccountId_startIdempotencyKey: { ownerAccountId: input.playerId, startIdempotencyKey: input.idempotencyKey } }, include });
      if (replay) {
        if (replay.gameId !== input.gameId || replay.entryAmount !== input.entryAmount || (replay.privateState?.engineSnapshot as unknown as NeonMinesSnapshot)?.difficulty !== input.difficulty) throw new NeonMinesError("IDEMPOTENCY_CONFLICT", "Start key was used for a different round");
        const engine = restore(replay);
        if (isExpired(replay, this.clock())) await this.expire(tx, replay, engine, wallet);
        return response(await readSession(tx, replay.id), true);
      }
      const game = await tx.game.findFirst({ where: { id: input.gameId, slug: "neon-mines", status: "ACTIVE" }, include: { activeVersion: true } });
      if (!game?.activeVersion || game.activeVersion.version !== "1.0.0") throw new NeonMinesError("GAME_NOT_AVAILABLE", "Game is not available");
      try { validateDifficultyWager(input.difficulty, input.entryAmount); } catch { throw new NeonMinesError("INVALID_ENTRY", "Choose an available wager for this difficulty"); }
      if (input.entryAmount < game.activeVersion.minimumEntry || input.entryAmount > game.activeVersion.maximumEntry) throw new NeonMinesError("INVALID_ENTRY", "Wager is outside the configured range");
      const active = await tx.gameSession.findFirst({ where: { ownerAccountId: input.playerId, status: { in: ["CREATED", "ACTIVE"] } } });
      if (active) throw new NeonMinesError("SESSION_ALREADY_ACTIVE", "Resume the active round before starting another");
      if (wallet.balance < input.entryAmount) throw new NeonMinesError("INSUFFICIENT_BALANCE", "Wallet has insufficient balance");
      const engine = new NeonMinesEngine(input.entryAmount, input.difficulty, configuration(game.activeVersion.configuration), this.random);
      if (!engine.getPublicState().nextSelectionAllowed) throw new NeonMinesError("INVALID_ENTRY", "Wager exceeds the configured payout limit");
      const now = this.clock();
      const session = await tx.gameSession.create({ data: {
        ownerAccountId: input.playerId, gameId: game.id, gameVersionId: game.activeVersion.id, gameVersion: game.activeVersion.version,
        entryAmount: input.entryAmount, startIdempotencyKey: input.idempotencyKey, status: "ACTIVE", startedAt: now,
        participants: { create: { accountId: input.playerId } },
        privateState: { create: { engineSnapshot: json(engine.toSnapshot()), expiresAt: deadline(now) } }
      } });
      const balance = wallet.balance - input.entryAmount;
      await tx.wallet.update({ where: { id: wallet.id }, data: { balance, version: { increment: 1 } } });
      await tx.ledgerEntry.create({ data: {
        walletId: wallet.id, type: "GAME_ENTRY", amount: -input.entryAmount, balanceBefore: wallet.balance, balanceAfter: balance,
        referenceType: "GAME_SESSION", referenceId: session.id, idempotencyKey: `game-start:${input.idempotencyKey}`,
        createdByType: "PLAYER", createdById: input.playerId, metadata: { gameSlug: "neon-mines", difficulty: input.difficulty }
      } });
      return response(await readSession(tx, session.id), false);
    });
  }

  public async command(playerId: string, sessionId: string, command: NeonMinesCommandRequest) {
    const result = await this.database.$transaction(async (tx) => {
      const wallet = await lockPlayerWallet(tx, playerId, true);
      const session = await ownedSession(tx, playerId, sessionId);
      const state = session.privateState!;
      const engine = restore(session);
      const fingerprint = createHash("sha256").update(JSON.stringify({ sequence: command.sequence, payload: command.payload })).digest("hex");
      const now = this.clock();
      if (isExpired(session, now)) await this.expire(tx, session, engine, wallet);
      if (state.lastCommandId === command.commandId) {
        if (state.lastSequence !== command.sequence || state.lastCommandFingerprint !== fingerprint) return new NeonMinesError("IDEMPOTENCY_CONFLICT", "Command ID was used with different input");
        return { ...response(await readSession(tx, session.id), true), acceptedSequence: state.lastSequence };
      }
      if (engine.getPublicState().status !== "ACTIVE") return new NeonMinesError("SESSION_COMPLETE", "Round is already complete");
      if (command.sequence !== state.lastSequence + 1) return new NeonMinesError("REPLAYED_SEQUENCE", "Resume the round to obtain the next sequence");
      try { await engine.handleInput({ payload: command.payload }); } catch { throw new NeonMinesError("INVALID_GAME_INPUT", "Action is not available in the current round"); }
      await this.persist(tx, session, engine, wallet, now);
      await tx.gameSessionState.update({ where: { gameSessionId: session.id }, data: { lastSequence: command.sequence, lastCommandId: command.commandId, lastCommandFingerprint: fingerprint } });
      return { ...response(await readSession(tx, session.id), false), acceptedSequence: command.sequence };
    });
    // Errors discovered after expiry must not roll back the expiry settlement.
    if (result instanceof NeonMinesError) throw result;
    return result;
  }

  public async resume(playerId: string) {
    return this.database.$transaction(async (tx) => {
      const wallet = await lockPlayerWallet(tx, playerId, true);
      const session = await tx.gameSession.findFirst({ where: { ownerAccountId: playerId, game: { slug: "neon-mines" }, status: "ACTIVE" }, include });
      if (!session) return null;
      if (isExpired(session, this.clock())) await this.expire(tx, session, restore(session), wallet);
      return response(await readSession(tx, session.id), true);
    });
  }

  public async expireBatch(limit = 50) {
    const candidates = await this.database.gameSessionState.findMany({ where: { expiresAt: { lte: this.clock() }, gameSession: { status: "ACTIVE", game: { slug: "neon-mines" } } }, orderBy: { expiresAt: "asc" }, take: limit, select: { gameSessionId: true, gameSession: { select: { ownerAccountId: true } } } });
    const failures: unknown[] = [];
    for (const candidate of candidates) {
      try { await this.database.$transaction(async (tx) => {
        const wallet = await lockPlayerWallet(tx, candidate.gameSession.ownerAccountId, false);
        const session = await tx.gameSession.findUnique({ where: { id: candidate.gameSessionId }, include });
        if (session && isExpired(session, this.clock())) await this.expire(tx, session, restore(session), wallet);
      }); } catch (error: unknown) { failures.push(error); }
    }
    if (failures.length > 0) throw new AggregateError(failures, "Some Mines expiry settlements failed");
    return candidates.length;
  }

  private async expire(tx: Transaction, session: Stored, engine: NeonMinesEngine, wallet: Wallet) {
    await engine.complete();
    await this.persist(tx, session, engine, wallet, this.clock());
  }

  private async persist(tx: Transaction, session: Stored, engine: NeonMinesEngine, wallet: Wallet, now: Date) {
    const snapshot = engine.toSnapshot();
    const terminal = snapshot.status !== "ACTIVE";
    if (terminal) {
      const reward = BigInt(snapshot.reward);
      if (reward > 0n) {
        const balance = wallet.balance + reward;
        await tx.wallet.update({ where: { id: wallet.id }, data: { balance, version: { increment: 1 } } });
        await tx.ledgerEntry.create({ data: {
          walletId: wallet.id, type: "GAME_REWARD", amount: reward, balanceBefore: wallet.balance, balanceAfter: balance,
          referenceType: "GAME_SESSION", referenceId: session.id, idempotencyKey: `game-settle:${session.id}`,
          createdByType: "GAME", metadata: { gameSlug: "neon-mines", outcome: snapshot.status }
        } });
      }
      await tx.gameResult.create({ data: { gameSessionId: session.id, outcome: snapshot.status === "ABANDONED" ? "ABANDONED" : "COMPLETED", score: engine.getPublicState().safeSelections, reward, details: json(snapshot) } });
    }
    await tx.gameSession.update({ where: { id: session.id }, data: {
      stateVersion: { increment: 1 }, ...(terminal ? { status: snapshot.status === "ABANDONED" ? "ABANDONED" : "COMPLETED", completedAt: now, serverInstanceId: null } : {})
    } });
    await tx.gameSessionState.update({ where: { gameSessionId: session.id }, data: { engineSnapshot: json(snapshot), expiresAt: terminal ? null : deadline(now) } });
  }
}

type Wallet = { id: string; balance: bigint };
async function lockPlayerWallet(tx: Transaction, playerId: string, requireActive: boolean): Promise<Wallet> {
  const accounts = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "Account" WHERE "id" = ${playerId}::uuid AND "type" = 'PLAYER' FOR UPDATE`;
  if (!accounts[0] || (requireActive && accounts[0].status !== "ACTIVE")) throw new NeonMinesError("ACCESS_DENIED", "Active player access required");
  const wallets = await tx.$queryRaw<Wallet[]>`SELECT "id", "balance" FROM "Wallet" WHERE "accountId" = ${playerId}::uuid FOR UPDATE`;
  if (!wallets[0]) throw new NeonMinesError("ACCESS_DENIED", "Player wallet not found");
  return wallets[0];
}
async function ownedSession(tx: Transaction, playerId: string, sessionId: string): Promise<Stored> {
  const session = await tx.gameSession.findFirst({ where: { id: sessionId, ownerAccountId: playerId, game: { slug: "neon-mines" } }, include });
  if (!session?.privateState) throw new NeonMinesError("SESSION_NOT_FOUND", "Game session not found");
  return session;
}
function readSession(tx: Transaction, id: string) { return tx.gameSession.findUniqueOrThrow({ where: { id }, include }); }
function configuration(raw: unknown) { try { return parseNeonMinesConfiguration(raw); } catch { throw new NeonMinesError("GAME_NOT_AVAILABLE", "Game configuration is unavailable"); } }
function restore(session: Stored) {
  if (!session.privateState || session.gameVersion !== "1.0.0") throw new Error("Missing or unsupported Mines state");
  const snapshot = session.privateState.engineSnapshot as unknown as NeonMinesSnapshot;
  if (snapshot.entryAmount !== session.entryAmount.toString() || (session.status === "ACTIVE") !== (snapshot.status === "ACTIVE")) throw new Error("Mines session and snapshot disagree");
  return NeonMinesEngine.restore(snapshot, configuration(session.version.configuration));
}
function response(session: Stored, replayed: boolean) {
  return {
    session: { id: session.id, gameId: session.gameId, gameVersion: session.gameVersion, status: session.status, entryAmount: session.entryAmount, startedAt: session.startedAt!, completedAt: session.completedAt, score: session.result?.score ?? null, reward: session.result?.reward ?? null },
    publicState: restore(session).getPublicState(), nextSequence: session.privateState!.lastSequence + 1, replayed, expiresAt: session.privateState!.expiresAt?.toISOString() ?? null
  };
}
function deadline(now: Date) { return new Date(now.getTime() + idleTimeoutMs); }
function isExpired(session: Stored, now: Date) { return session.status === "ACTIVE" && session.privateState?.expiresAt != null && session.privateState.expiresAt <= now; }
function json(value: unknown) { return value as Prisma.InputJsonValue; }
