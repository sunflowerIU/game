import type { GameSessionSummary } from "./index.js";

export const NEON_DICE_SELECTIONS = ["UNDER_7", "EXACTLY_7", "OVER_7"] as const;
export type NeonDiceSelection = typeof NEON_DICE_SELECTIONS[number];

export interface StartNeonDiceSessionRequest {
  /** Integer cents, not display coins. */
  readonly entryAmount: number;
  readonly selection: NeonDiceSelection;
}

export interface NeonDicePublicState {
  readonly status: "COMPLETED";
  readonly entryAmount: string;
  readonly dice: readonly [number, number];
  readonly total: number;
  readonly selection: NeonDiceSelection;
  readonly multiplierBps: number;
  readonly win: boolean;
  readonly reward: string;
  readonly outcome: "WIN" | "LOSE";
}

export interface NeonDiceSessionResponse {
  readonly session: GameSessionSummary;
  readonly publicState: NeonDicePublicState;
  readonly replayed: boolean;
  readonly nextSequence: 1;
}

export class NeonDiceRequestError extends Error {
  public readonly code = "INVALID_REQUEST";
  public constructor(message: string) { super(message); this.name = "NeonDiceRequestError"; }
}

export function parseStartNeonDiceSessionRequest(raw: unknown): StartNeonDiceSessionRequest {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new NeonDiceRequestError("Invalid Neon Dice start input");
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).length !== 2 || !Object.hasOwn(value, "entryAmount") || !Object.hasOwn(value, "selection")) {
    throw new NeonDiceRequestError("Invalid Neon Dice start input");
  }
  if (!Number.isSafeInteger(value.entryAmount) || (value.entryAmount as number) < 1 || (value.entryAmount as number) > 1_000_000_000) {
    throw new NeonDiceRequestError("Wager must be a positive integer amount in cents");
  }
  if (!isNeonDiceSelection(value.selection)) throw new NeonDiceRequestError("Invalid Neon Dice selection");
  return { entryAmount: value.entryAmount as number, selection: value.selection };
}

export function isNeonDiceSelection(value: unknown): value is NeonDiceSelection {
  return typeof value === "string" && (NEON_DICE_SELECTIONS as readonly string[]).includes(value);
}
