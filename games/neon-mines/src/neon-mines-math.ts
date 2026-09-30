import type { NeonMinesDifficulty } from "@game-platform/contracts";
export type { NeonMinesDifficulty } from "@game-platform/contracts";

export const NEON_MINES_BOARD_TILES = 9;
export const NEON_MINES_WAGERS_CENTS = [10n, 25n, 50n, 100n, 200n, 500n, 1_000n, 2_000n, 5_000n] as const;

export interface NeonMinesDifficultyRule {
  readonly difficulty: NeonMinesDifficulty;
  readonly mines: number;
  readonly maximumWagerCents: bigint;
  readonly rewardMultiplier: number;
}

export const NEON_MINES_DIFFICULTIES: Readonly<Record<NeonMinesDifficulty, NeonMinesDifficultyRule>> = {
  EASY: { difficulty: "EASY", mines: 2, maximumWagerCents: 1_000n, rewardMultiplier: 2 },
  MEDIUM: { difficulty: "MEDIUM", mines: 3, maximumWagerCents: 2_000n, rewardMultiplier: 3 },
  HARD: { difficulty: "HARD", mines: 4, maximumWagerCents: 2_000n, rewardMultiplier: 4 }
};

export class NeonMinesMathError extends Error {
  public constructor(message: string) { super(message); this.name = "NeonMinesMathError"; }
}

export function allowedWagers(difficulty: NeonMinesDifficulty, maximumWagerCents = NEON_MINES_DIFFICULTIES[difficulty].maximumWagerCents): readonly bigint[] {
  return NEON_MINES_WAGERS_CENTS.filter((wager) => wager <= maximumWagerCents);
}

export function validateDifficultyWager(difficulty: NeonMinesDifficulty, wagerCents: bigint, maximumWagerCents = NEON_MINES_DIFFICULTIES[difficulty].maximumWagerCents): void {
  if (!allowedWagers(difficulty, maximumWagerCents).includes(wagerCents as (typeof NEON_MINES_WAGERS_CENTS)[number])) {
    throw new NeonMinesMathError(`Wager is not allowed for ${difficulty.toLowerCase()} difficulty`);
  }
}
