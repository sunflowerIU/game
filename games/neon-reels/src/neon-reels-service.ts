import type { AuthorizedPrincipal } from "@game-platform/auth";
import { createNeonReelsSpin, parseNeonReelsConfiguration, toNeonReelsPublicState, type NeonReelsSpin } from "./neon-reels.js";

export interface NeonReelsSessionRecord {
  readonly id: string; readonly gameId: string; readonly gameVersion: string; readonly status: "COMPLETED"; readonly entryAmount: bigint;
  readonly startedAt: Date; readonly completedAt: Date; readonly score: number; readonly reward: bigint; readonly details: NeonReelsSpin;
}
export interface NeonReelsRepository {
  playSpin(input: { readonly playerId: string; readonly gameId: string; readonly entryAmount: bigint; readonly idempotencyKey: string; readonly serverInstanceId: string; readonly occurredAt: Date; readonly ipAddress: string; readonly resolve: (configuration: Readonly<Record<string, unknown>>) => NeonReelsSpin }): Promise<{ readonly session: NeonReelsSessionRecord; readonly replayed: boolean }>;
  listHistory(playerId: string, limit: number): Promise<readonly NeonReelsSessionRecord[]>;
}
export class NeonReelsError extends Error {
  public constructor(public readonly code: "ACCESS_DENIED" | "CONFLICT" | "GAME_NOT_AVAILABLE" | "IDEMPOTENCY_CONFLICT" | "INSUFFICIENT_BALANCE" | "INVALID_ENTRY" | "SESSION_ALREADY_ACTIVE" | "SESSION_NOT_FOUND", message: string) { super(message); this.name = "NeonReelsError"; }
}
export class NeonReelsService {
  public constructor(private readonly repository: NeonReelsRepository, private readonly serverInstanceId: string, private readonly clock: { now(): Date } = { now: () => new Date() }) {}
  public async spin(principal: AuthorizedPrincipal, input: { readonly gameId: string; readonly entryAmount: bigint; readonly idempotencyKey: string; readonly ipAddress: string }) {
    requirePlayer(principal);
    if (input.entryAmount <= 0n || input.entryAmount > 1_000_000_000n) throw new NeonReelsError("INVALID_ENTRY", "Invalid wager amount");
    if (!/^[A-Za-z0-9._:-]{16,80}$/u.test(input.idempotencyKey)) throw new NeonReelsError("IDEMPOTENCY_CONFLICT", "Invalid idempotency key");
    const result = await this.repository.playSpin({ ...input, playerId: principal.accountId, serverInstanceId: this.serverInstanceId, occurredAt: this.clock.now(), resolve: (configuration) => createNeonReelsSpin(input.entryAmount, parseNeonReelsConfiguration(configuration)) });
    return { session: result.session, publicState: toNeonReelsPublicState(result.session.entryAmount, result.session.details), replayed: result.replayed, nextSequence: 1 };
  }
  public async history(principal: AuthorizedPrincipal): Promise<readonly NeonReelsSessionRecord[]> {
    requirePlayer(principal);
    return this.repository.listHistory(principal.accountId, 50);
  }
  public async resume(principal: AuthorizedPrincipal): Promise<null> {
    requirePlayer(principal);
    return null;
  }
}
function requirePlayer(principal: AuthorizedPrincipal): void { if (principal.type !== "PLAYER") throw new NeonReelsError("ACCESS_DENIED", "Player game access required"); }
