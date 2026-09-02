export type DurableSessionStatus = "CREATED" | "ACTIVE" | "COMPLETED" | "ABANDONED" | "FAILED";

export interface DurableSessionRecord {
  readonly id: string;
  readonly status: DurableSessionStatus;
  readonly stateVersion: number;
  readonly gameId: string;
  readonly gameVersion: string;
  readonly ownerAccountId: string;
}

export interface GameSessionPersistence {
  transition(input: { readonly sessionId: string; readonly expectedStateVersion: number; readonly from: DurableSessionStatus; readonly to: DurableSessionStatus; readonly occurredAt: Date; readonly serverInstanceId: string | null }): Promise<DurableSessionRecord | null>;
}

export class SessionLifecycleError extends Error {
  public constructor(public readonly code: "CONFLICT" | "INVALID_SESSION_TRANSITION" | "SESSION_NOT_FOUND", message: string) { super(message); this.name = "SessionLifecycleError"; }
}

const allowedTransitions: Readonly<Record<DurableSessionStatus, readonly DurableSessionStatus[]>> = {
  CREATED: ["ACTIVE", "FAILED"],
  ACTIVE: ["COMPLETED", "ABANDONED", "FAILED"],
  COMPLETED: [], ABANDONED: [], FAILED: []
};

export class GameSessionLifecycle {
  public constructor(private readonly persistence: GameSessionPersistence, private readonly serverInstanceId: string) {}

  public async transition(session: DurableSessionRecord, to: DurableSessionStatus, occurredAt = new Date()): Promise<DurableSessionRecord> {
    if (!allowedTransitions[session.status].includes(to)) throw new SessionLifecycleError("INVALID_SESSION_TRANSITION", `Cannot transition ${session.status} to ${to}`);
    const updated = await this.persistence.transition({ sessionId: session.id, expectedStateVersion: session.stateVersion, from: session.status, to, occurredAt, serverInstanceId: to === "ACTIVE" ? this.serverInstanceId : null });
    if (updated === null) throw new SessionLifecycleError("CONFLICT", "Game session changed concurrently");
    return updated;
  }
}
