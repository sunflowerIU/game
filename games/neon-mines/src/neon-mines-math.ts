import type { NeonMinesDifficulty } from "@game-platform/contracts";
export type { NeonMinesDifficulty } from "@game-platform/contracts";

export const NEON_MINES_BOARD_TILES = 25;
export const NEON_MINES_RETURN_BPS = 9_600;
export const NEON_MINES_MAX_MULTIPLIER_BPS = 5_000_000;
export const NEON_MINES_MAX_PAYOUT_CENTS = 50_000n;
export const NEON_MINES_WAGERS_CENTS = [10n, 25n, 50n, 100n, 200n, 500n, 1_000n, 2_000n, 5_000n] as const;

export interface NeonMinesDifficultyRule {
  readonly difficulty: NeonMinesDifficulty;
  readonly mines: number;
  readonly maximumWagerCents: bigint;
}

export const NEON_MINES_DIFFICULTIES: Readonly<Record<NeonMinesDifficulty, NeonMinesDifficultyRule>> = {
  EASY: { difficulty: "EASY", mines: 3, maximumWagerCents: 5_000n },
  MEDIUM: { difficulty: "MEDIUM", mines: 5, maximumWagerCents: 5_000n },
  HARD: { difficulty: "HARD", mines: 10, maximumWagerCents: 2_000n },
  EXPERT: { difficulty: "EXPERT", mines: 15, maximumWagerCents: 1_000n }
};

export interface ExactFraction {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

export interface NeonMinesPayoutQuote {
  readonly safeSelections: number;
  readonly survivalProbability: ExactFraction;
  readonly ownerRoundWinProbability: ExactFraction;
  readonly grossPayoutCents: bigint;
  readonly netProfitCents: bigint;
}

export interface NeonMinesLiabilityDecision {
  readonly nextSelectionAllowed: boolean;
  readonly cashOutRequired: boolean;
  readonly reason: "NONE" | "NO_SAFE_TILES_REMAIN" | "MAXIMUM_MULTIPLIER" | "MAXIMUM_PAYOUT";
  readonly currentQuote: NeonMinesPayoutQuote | null;
  readonly nextSafeQuote: NeonMinesPayoutQuote | null;
}

export class NeonMinesMathError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "NeonMinesMathError";
  }
}

export function combination(total: number, selected: number): bigint {
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(selected) || total < 0 || selected < 0 || selected > total) {
    throw new NeonMinesMathError("Combination inputs must be non-negative whole numbers with selected not exceeding total");
  }
  const count = Math.min(selected, total - selected);
  let result = 1n;
  for (let index = 1; index <= count; index += 1) result = result * BigInt(total - count + index) / BigInt(index);
  return result;
}

export function survivalProbability(mines: number, safeSelections: number, boardTiles = NEON_MINES_BOARD_TILES): ExactFraction {
  validateBoard(mines, safeSelections, boardTiles);
  return reduceFraction(combination(boardTiles - mines, safeSelections), combination(boardTiles, safeSelections));
}

export function payoutQuote(
  wagerCents: bigint,
  mines: number,
  safeSelections: number,
  returnBps = NEON_MINES_RETURN_BPS,
  boardTiles = NEON_MINES_BOARD_TILES
): NeonMinesPayoutQuote {
  if (wagerCents <= 0n) throw new NeonMinesMathError("Wager must be positive");
  if (!Number.isSafeInteger(returnBps) || returnBps < 1 || returnBps > 10_000) throw new NeonMinesMathError("Return basis points must be between 1 and 10000");
  if (safeSelections < 1) throw new NeonMinesMathError("A payout requires at least one safe selection");
  const probability = survivalProbability(mines, safeSelections, boardTiles);
  const grossPayoutCents = wagerCents * BigInt(returnBps) * probability.denominator / (10_000n * probability.numerator);
  return {
    safeSelections,
    survivalProbability: probability,
    ownerRoundWinProbability: reduceFraction(probability.denominator - probability.numerator, probability.denominator),
    grossPayoutCents,
    netProfitCents: grossPayoutCents - wagerCents
  };
}

export function liabilityDecision(input: {
  readonly wagerCents: bigint;
  readonly mines: number;
  readonly safeSelections: number;
  readonly maximumPayoutCents?: bigint;
  readonly maximumMultiplierBps?: number;
  readonly returnBps?: number;
}): NeonMinesLiabilityDecision {
  const maximumPayoutCents = input.maximumPayoutCents ?? NEON_MINES_MAX_PAYOUT_CENTS;
  const maximumMultiplierBps = input.maximumMultiplierBps ?? NEON_MINES_MAX_MULTIPLIER_BPS;
  const returnBps = input.returnBps ?? NEON_MINES_RETURN_BPS;
  if (maximumPayoutCents <= 0n) throw new NeonMinesMathError("Maximum payout must be positive");
  if (!Number.isSafeInteger(maximumMultiplierBps) || maximumMultiplierBps < 10_000) throw new NeonMinesMathError("Maximum multiplier must be at least 1x");
  validateBoard(input.mines, input.safeSelections, NEON_MINES_BOARD_TILES);
  const currentQuote = input.safeSelections === 0 ? null : payoutQuote(input.wagerCents, input.mines, input.safeSelections, returnBps);
  if (input.safeSelections === NEON_MINES_BOARD_TILES - input.mines) {
    return { nextSelectionAllowed: false, cashOutRequired: true, reason: "NO_SAFE_TILES_REMAIN", currentQuote, nextSafeQuote: null };
  }
  const nextSafeQuote = payoutQuote(input.wagerCents, input.mines, input.safeSelections + 1, returnBps);
  if (nextSafeQuote.grossPayoutCents > maximumPayoutCents) {
    return { nextSelectionAllowed: false, cashOutRequired: currentQuote !== null, reason: "MAXIMUM_PAYOUT", currentQuote, nextSafeQuote };
  }
  if (nextSafeQuote.grossPayoutCents * 10_000n > input.wagerCents * BigInt(maximumMultiplierBps)) {
    return { nextSelectionAllowed: false, cashOutRequired: currentQuote !== null, reason: "MAXIMUM_MULTIPLIER", currentQuote, nextSafeQuote };
  }
  return { nextSelectionAllowed: true, cashOutRequired: false, reason: "NONE", currentQuote, nextSafeQuote };
}

export function allowedWagers(difficulty: NeonMinesDifficulty): readonly bigint[] {
  const maximum = NEON_MINES_DIFFICULTIES[difficulty].maximumWagerCents;
  return NEON_MINES_WAGERS_CENTS.filter((wager) => wager <= maximum);
}

export function validateDifficultyWager(difficulty: NeonMinesDifficulty, wagerCents: bigint): void {
  if (!allowedWagers(difficulty).includes(wagerCents as (typeof NEON_MINES_WAGERS_CENTS)[number])) {
    throw new NeonMinesMathError(`Wager is not allowed for ${difficulty.toLowerCase()} difficulty`);
  }
}

export function fractionAsNumber(fraction: ExactFraction): number {
  return Number(fraction.numerator) / Number(fraction.denominator);
}

function validateBoard(mines: number, safeSelections: number, boardTiles: number): void {
  if (!Number.isSafeInteger(boardTiles) || boardTiles < 2) throw new NeonMinesMathError("Board must contain at least two tiles");
  if (!Number.isSafeInteger(mines) || mines < 1 || mines >= boardTiles) throw new NeonMinesMathError("Mine count must leave at least one safe tile");
  if (!Number.isSafeInteger(safeSelections) || safeSelections < 0 || safeSelections > boardTiles - mines) throw new NeonMinesMathError("Safe selection count is outside the board");
}

function reduceFraction(numerator: bigint, denominator: bigint): ExactFraction {
  if (denominator <= 0n || numerator < 0n) throw new NeonMinesMathError("Invalid probability fraction");
  const divisor = greatestCommonDivisor(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left;
  let b = right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}
