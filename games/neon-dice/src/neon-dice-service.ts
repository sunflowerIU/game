import type { AuthorizedPrincipal } from "@game-platform/auth";
import {
  createNeonDiceRoll,
  parseNeonDiceConfiguration,
  toNeonDicePublicState,
  type NeonDiceRoll,
  type NeonDiceSelection
} from "./neon-dice.js";

export interface NeonDiceSessionRecord {
  readonly id: string;
  readonly gameId: string;
  readonly gameVersion: string;
  readonly status: "COMPLETED";
  readonly entryAmount: bigint;
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly score: number;
  readonly reward: bigint;
  readonly details: NeonDiceRoll;
}

export interface NeonDiceRepository {
  playRoll(input: {
    readonly playerId: string;
    readonly gameId: string;
    readonly entryAmount: bigint;
    readonly selection: NeonDiceSelection;
    readonly idempotencyKey: string;
    readonly serverInstanceId: string;
    readonly occurredAt: Date;
    readonly ipAddress: string;
    readonly resolve: (configuration: Readonly<Record<string, unknown>>) => NeonDiceRoll;
  }): Promise<{ readonly session: NeonDiceSessionRecord; readonly replayed: boolean }>;
}

export type NeonDiceServiceErrorCode = "ACCESS_DENIED" | "CONFLICT" | "GAME_NOT_AVAILABLE" | "IDEMPOTENCY_CONFLICT" | "INSUFFICIENT_BALANCE" | "INVALID_ENTRY" | "SESSION_ALREADY_ACTIVE";

export class NeonDiceServiceError extends Error {
  public constructor(public readonly code: NeonDiceServiceErrorCode, message: string) {
    super(message);
    this.name = "NeonDiceServiceError";
  }
}

export class NeonDiceService {
  public constructor(
    private readonly repository: NeonDiceRepository,
    private readonly serverInstanceId: string,
    private readonly clock: { now(): Date } = { now: () => new Date() }
  ) {}

  public async roll(principal: AuthorizedPrincipal, input: {
    readonly gameId: string;
    readonly entryAmount: bigint;
    readonly selection: NeonDiceSelection;
    readonly idempotencyKey: string;
    readonly ipAddress: string;
  }) {
    if (principal.type !== "PLAYER") throw new NeonDiceServiceError("ACCESS_DENIED", "Player game access required");
    if (input.entryAmount <= 0n || input.entryAmount > 1_000_000_000n) throw new NeonDiceServiceError("INVALID_ENTRY", "Invalid wager amount");
    if (!/^[A-Za-z0-9._:-]{16,80}$/u.test(input.idempotencyKey)) throw new NeonDiceServiceError("IDEMPOTENCY_CONFLICT", "Invalid idempotency key");
    const result = await this.repository.playRoll({
      ...input,
      playerId: principal.accountId,
      serverInstanceId: this.serverInstanceId,
      occurredAt: this.clock.now(),
      resolve: (configuration) => createNeonDiceRoll(input.entryAmount, input.selection, parseNeonDiceConfiguration(configuration))
    });
    return {
      session: result.session,
      publicState: toNeonDicePublicState(result.session.entryAmount, result.session.details),
      replayed: result.replayed,
      nextSequence: 1 as const
    };
  }
}
