import type { ActiveGameEngine, GameEngineTransition } from "./catalog.js";
import { GameProtocolError, type GameInputMessage, type GameServerMessage } from "./protocol.js";

export interface ActiveGameSession {
  readonly id: string;
  readonly participantIds: ReadonlySet<string>;
  readonly engine: ActiveGameEngine;
  readonly lastSequenceByParticipant: Map<string, number>;
  readonly processedCommandIds: Set<string>;
  readonly lastInputAtByParticipant: Map<string, number>;
  readonly onComplete: (result: unknown) => Promise<void>;
  readonly minimumInputIntervalMs?: number;
}

export interface ActiveSessionStore {
  get(sessionId: string): Promise<ActiveGameSession | null>;
  set(session: ActiveGameSession): Promise<void>;
  delete(sessionId: string): Promise<void>;
}

export class InMemoryActiveSessionStore implements ActiveSessionStore {
  readonly #sessions = new Map<string, ActiveGameSession>();
  public async get(sessionId: string) { return this.#sessions.get(sessionId) ?? null; }
  public async set(session: ActiveGameSession) { this.#sessions.set(session.id, session); }
  public async delete(sessionId: string) { this.#sessions.delete(sessionId); }
}

export class GameRuntime {
  readonly #queues = new Map<string, Promise<void>>();
  public constructor(private readonly sessions: ActiveSessionStore, private readonly minimumInputIntervalMs = 25) {}

  public async handleInput(playerId: string, message: GameInputMessage, receivedAt = new Date()): Promise<GameServerMessage> {
    return this.enqueue(message.sessionId, () => this.processInput(playerId, message, receivedAt));
  }

  public async completeSession(sessionId: string, receivedAt = new Date()): Promise<void> {
    await this.enqueue(sessionId, async () => {
      const session = await this.sessions.get(sessionId);
      if (session === null) return;
      await this.finalize(session, await session.engine.complete(receivedAt));
    });
  }

  private async enqueue<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    this.#queues.set(sessionId, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#queues.get(sessionId) === queued) this.#queues.delete(sessionId);
    }
  }

  private async processInput(playerId: string, message: GameInputMessage, receivedAt: Date): Promise<GameServerMessage> {
    const session = await this.sessions.get(message.sessionId);
    if (session === null) throw new GameProtocolError("SESSION_NOT_FOUND", "Game session not found");
    if (!session.participantIds.has(playerId)) throw new GameProtocolError("INVALID_SESSION", "Game session does not belong to this player");
    if (session.processedCommandIds.has(message.commandId)) throw new GameProtocolError("REPLAYED_SEQUENCE", "Command was already processed");
    const expectedSequence = (session.lastSequenceByParticipant.get(playerId) ?? 0) + 1;
    if (message.sequence !== expectedSequence) throw new GameProtocolError("REPLAYED_SEQUENCE", "Unexpected input sequence");
    const lastInputAt = session.lastInputAtByParticipant.get(playerId);
    if (lastInputAt !== undefined && receivedAt.getTime() - lastInputAt < (session.minimumInputIntervalMs ?? this.minimumInputIntervalMs)) throw new GameProtocolError("RATE_LIMITED", "Game input rate exceeded");

    const result = await session.engine.handleInput({ actorId: playerId, payload: message.payload, receivedAt });
    session.processedCommandIds.add(message.commandId);
    session.lastSequenceByParticipant.set(playerId, message.sequence);
    session.lastInputAtByParticipant.set(playerId, receivedAt.getTime());
    if (result.complete) await this.finalize(session, result);
    return { protocolVersion: 1, type: "GAME_STATE", sessionId: session.id, sequence: message.sequence, publicState: result.publicState, events: result.events, complete: result.complete };
  }

  private async finalize(session: ActiveGameSession, transition: GameEngineTransition): Promise<void> {
    if (!transition.complete || transition.authoritativeResult === undefined) throw new GameProtocolError("INVALID_GAME_INPUT", "Game engine did not produce a completion result");
    await session.onComplete(transition.authoritativeResult);
    await this.sessions.delete(session.id);
  }
}
