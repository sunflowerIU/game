import type { GameSessionSummary } from "./index.js";

export type NeonMinesDifficulty = "EASY" | "MEDIUM" | "HARD";
export type NeonMinesRoundStatus = "ACTIVE" | "WON" | "MINE_HIT" | "ABANDONED";
export type NeonMinesAction = { readonly action: "SELECT_TILE"; readonly tile: number } | { readonly action: "LEAVE" };

export interface StartNeonMinesSessionRequest {
  /** Integer cents, not display coins. Denominations and difficulty limits are checked by the game. */
  readonly entryAmount: number;
  readonly difficulty: NeonMinesDifficulty;
}

export interface NeonMinesCommandRequest {
  readonly commandId: string;
  readonly sequence: number;
  readonly payload: NeonMinesAction;
}

export interface NeonMinesPublicState {
  readonly status: NeonMinesRoundStatus;
  readonly boardTiles: 9;
  readonly difficulty: NeonMinesDifficulty;
  readonly mineCount: number;
  readonly entryAmount: string;
  readonly selectedTiles: readonly number[];
  readonly revealedMines: readonly number[];
  readonly detonatedTile: number | null;
  readonly safeSelections: number;
  readonly rewardMultiplier: number;
  readonly currentCashOut: string;
  readonly nextSafePayout: string | null;
  readonly cashOutAvailable: boolean;
  readonly nextSelectionAllowed: boolean;
}

export interface NeonMinesSessionResponse {
  readonly session: GameSessionSummary;
  readonly publicState: NeonMinesPublicState;
  readonly replayed: boolean;
  readonly nextSequence: number;
  readonly expiresAt: string | null;
}

export interface NeonMinesCommandResponse extends NeonMinesSessionResponse {
  readonly acceptedSequence: number;
}

export interface ActiveNeonMinesSessionResponse {
  readonly active: NeonMinesSessionResponse | null;
}

export class NeonMinesRequestError extends Error {
  public readonly code = "INVALID_REQUEST";
  public constructor(message: string) { super(message); this.name = "NeonMinesRequestError"; }
}

export function parseStartNeonMinesSessionRequest(raw: unknown): StartNeonMinesSessionRequest {
  const value = exactObject(raw, ["entryAmount", "difficulty"]);
  if (!Number.isSafeInteger(value.entryAmount) || (value.entryAmount as number) < 1 || (value.entryAmount as number) > 1_000_000_000) {
    throw new NeonMinesRequestError("Wager must be a positive integer amount in cents");
  }
  if (value.difficulty !== "EASY" && value.difficulty !== "MEDIUM" && value.difficulty !== "HARD") {
    throw new NeonMinesRequestError("Invalid Neon Mines difficulty");
  }
  return { entryAmount: value.entryAmount as number, difficulty: value.difficulty };
}

export function parseNeonMinesAction(raw: unknown): NeonMinesAction {
  const fields = typeof raw === "object" && raw !== null && "action" in raw && raw.action === "LEAVE" ? ["action"] : ["action", "tile"];
  const value = exactObject(raw, fields);
  if (value.action === "LEAVE") return { action: "LEAVE" };
  if (value.action !== "SELECT_TILE") throw new NeonMinesRequestError("Invalid Neon Mines input");
  if (!Number.isSafeInteger(value.tile) || (value.tile as number) < 0 || (value.tile as number) > 8) {
    throw new NeonMinesRequestError("Tile must be a whole number from 0 through 8");
  }
  return { action: "SELECT_TILE", tile: value.tile as number };
}

export function parseNeonMinesCommandRequest(raw: unknown): NeonMinesCommandRequest {
  const value = exactObject(raw, ["commandId", "sequence", "payload"]);
  if (typeof value.commandId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.commandId)) {
    throw new NeonMinesRequestError("Command ID must be a UUID");
  }
  if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1 || (value.sequence as number) > 2_147_483_646) {
    throw new NeonMinesRequestError("Sequence must be a positive database-safe integer");
  }
  return { commandId: value.commandId.toLowerCase(), sequence: value.sequence as number, payload: parseNeonMinesAction(value.payload) };
}

function exactObject(raw: unknown, fields: readonly string[]): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new NeonMinesRequestError("Invalid Neon Mines input");
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).length !== fields.length || fields.some((field) => !Object.hasOwn(value, field))) throw new NeonMinesRequestError("Invalid Neon Mines input");
  return value;
}
