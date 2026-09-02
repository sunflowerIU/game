export const GAME_PROTOCOL_VERSION = 1 as const;

export interface GameInputMessage {
  readonly protocolVersion: typeof GAME_PROTOCOL_VERSION;
  readonly type: "GAME_INPUT";
  readonly sessionId: string;
  readonly commandId: string;
  readonly sequence: number;
  readonly payload: unknown;
}

export type GameServerMessage =
  | { readonly protocolVersion: 1; readonly type: "GAME_STATE"; readonly sessionId: string; readonly sequence: number; readonly publicState: unknown; readonly events: readonly unknown[]; readonly complete: boolean }
  | { readonly protocolVersion: 1; readonly type: "GAME_ERROR"; readonly code: GameProtocolErrorCode; readonly message: string; readonly sessionId?: string };

export type GameProtocolErrorCode = "INVALID_GAME_INPUT" | "INVALID_SESSION" | "RATE_LIMITED" | "REPLAYED_SEQUENCE" | "SESSION_NOT_FOUND";

export class GameProtocolError extends Error {
  public constructor(public readonly code: GameProtocolErrorCode, message: string) { super(message); this.name = "GameProtocolError"; }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function parseGameInput(raw: unknown): GameInputMessage {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new GameProtocolError("INVALID_GAME_INPUT", "Message must be an object");
  const value = raw as Record<string, unknown>;
  if (value.protocolVersion !== GAME_PROTOCOL_VERSION || value.type !== "GAME_INPUT"
    || typeof value.sessionId !== "string" || !uuidPattern.test(value.sessionId)
    || typeof value.commandId !== "string" || !uuidPattern.test(value.commandId)
    || typeof value.sequence !== "number" || !Number.isSafeInteger(value.sequence) || value.sequence < 1
    || !("payload" in value)) {
    throw new GameProtocolError("INVALID_GAME_INPUT", "Message does not match game protocol version 1");
  }
  return { protocolVersion: 1, type: "GAME_INPUT", sessionId: value.sessionId, commandId: value.commandId, sequence: value.sequence, payload: value.payload };
}
