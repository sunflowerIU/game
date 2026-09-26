import { randomInt } from "node:crypto";
import { parseNeonMinesAction, type NeonMinesPublicState, type NeonMinesRoundStatus } from "@game-platform/contracts";
export type { NeonMinesPublicState, NeonMinesRoundStatus } from "@game-platform/contracts";
import type { ActiveGameEngine, GameEngineTransition } from "@game-platform/game-core";
import {
  NEON_MINES_BOARD_TILES,
  NEON_MINES_DIFFICULTIES,
  NEON_MINES_MAX_MULTIPLIER_BPS,
  NEON_MINES_MAX_PAYOUT_CENTS,
  NEON_MINES_RETURN_BPS,
  liabilityDecision,
  payoutQuote,
  validateDifficultyWager,
  type NeonMinesDifficulty
} from "./neon-mines-math.js";

export const NEON_MINES_SLUG = "neon-mines" as const;
export const NEON_MINES_VERSION = "1.0.0" as const;

export type NeonMinesOutcome = "CASHED_OUT" | "MINE_HIT" | "AUTO_CASHOUT" | "ABANDONED";

export interface NeonMinesRandom {
  integer(minimum: number, maximumExclusive: number): number;
}

export interface NeonMinesEngineConfiguration {
  readonly returnBps: number;
  readonly maximumMultiplierBps: number;
  readonly maximumPayoutCents: bigint;
}

export const DEFAULT_NEON_MINES_ENGINE_CONFIGURATION: NeonMinesEngineConfiguration = {
  returnBps: NEON_MINES_RETURN_BPS,
  maximumMultiplierBps: NEON_MINES_MAX_MULTIPLIER_BPS,
  maximumPayoutCents: NEON_MINES_MAX_PAYOUT_CENTS
};

export interface NeonMinesSnapshot {
  readonly version: typeof NEON_MINES_VERSION;
  readonly entryAmount: string;
  readonly difficulty: NeonMinesDifficulty;
  readonly mineTiles: readonly number[];
  readonly selectedTiles: readonly number[];
  readonly status: NeonMinesRoundStatus;
  readonly reward: string;
  readonly detonatedTile: number | null;
}

export interface NeonMinesAuthoritativeResult {
  readonly outcome: NeonMinesOutcome;
  readonly difficulty: NeonMinesDifficulty;
  readonly mineCount: number;
  readonly mineTiles: readonly number[];
  readonly selectedTiles: readonly number[];
  readonly detonatedTile: number | null;
  readonly safeSelections: number;
  readonly entryAmount: string;
  readonly reward: string;
}

export class NeonMinesEngine implements ActiveGameEngine {
  private readonly mineTiles: ReadonlySet<number>;
  private readonly selectedTiles = new Set<number>();
  private status: NeonMinesRoundStatus = "ACTIVE";
  private reward = 0n;
  private detonatedTile: number | null = null;

  public constructor(
    private readonly entryAmount: bigint,
    private readonly difficulty: NeonMinesDifficulty,
    private readonly configuration: NeonMinesEngineConfiguration = DEFAULT_NEON_MINES_ENGINE_CONFIGURATION,
    random: NeonMinesRandom = secureRandom,
    restoredSnapshot?: NeonMinesSnapshot
  ) {
    validateDifficultyWager(difficulty, entryAmount);
    validateConfiguration(configuration);
    if (restoredSnapshot === undefined) {
      this.mineTiles = new Set(placeMines(NEON_MINES_DIFFICULTIES[difficulty].mines, random));
    } else {
      validateSnapshot(restoredSnapshot, entryAmount, difficulty, configuration);
      this.mineTiles = new Set(restoredSnapshot.mineTiles);
      for (const tile of restoredSnapshot.selectedTiles) this.selectedTiles.add(tile);
      this.status = restoredSnapshot.status;
      this.reward = BigInt(restoredSnapshot.reward);
      this.detonatedTile = restoredSnapshot.detonatedTile;
    }
  }

  public static restore(snapshot: NeonMinesSnapshot, configuration: NeonMinesEngineConfiguration = DEFAULT_NEON_MINES_ENGINE_CONFIGURATION): NeonMinesEngine {
    return new NeonMinesEngine(BigInt(snapshot.entryAmount), snapshot.difficulty, configuration, secureRandom, snapshot);
  }

  public async handleInput(context: { readonly payload: unknown }): Promise<GameEngineTransition> {
    if (this.status !== "ACTIVE") throw new Error("Neon Mines round is already complete");
    const input = parseNeonMinesAction(context.payload);
    if (input.action === "CASH_OUT") return this.cashOut("CASHED_OUT");
    return this.selectTile(input.tile);
  }

  public async complete(): Promise<GameEngineTransition> {
    if (this.status !== "ACTIVE") return this.completedTransition([]);
    if (this.safeSelectionCount() === 0) return this.finishAbandoned();
    return this.cashOut("AUTO_CASH_OUT");
  }

  public getPublicState(): NeonMinesPublicState {
    const complete = this.status !== "ACTIVE";
    const safeSelections = this.safeSelectionCount();
    const decision = complete ? null : liabilityDecision({
      wagerCents: this.entryAmount,
      mines: this.mineCount(),
      safeSelections,
      maximumPayoutCents: this.configuration.maximumPayoutCents,
      maximumMultiplierBps: this.configuration.maximumMultiplierBps,
      returnBps: this.configuration.returnBps
    });
    return {
      status: this.status,
      boardTiles: NEON_MINES_BOARD_TILES,
      difficulty: this.difficulty,
      mineCount: this.mineCount(),
      entryAmount: this.entryAmount.toString(),
      selectedTiles: [...this.selectedTiles].sort(numericSort),
      revealedMines: complete ? [...this.mineTiles].sort(numericSort) : [],
      detonatedTile: this.detonatedTile,
      safeSelections,
      currentCashOut: (complete ? this.reward : safeSelections === 0 ? 0n : payoutQuote(this.entryAmount, this.mineCount(), safeSelections, this.configuration.returnBps).grossPayoutCents).toString(),
      nextSafePayout: decision?.nextSafeQuote?.grossPayoutCents.toString() ?? null,
      cashOutAvailable: !complete && safeSelections > 0,
      nextSelectionAllowed: decision?.nextSelectionAllowed ?? false
    };
  }

  public toSnapshot(): NeonMinesSnapshot {
    return {
      version: NEON_MINES_VERSION,
      entryAmount: this.entryAmount.toString(),
      difficulty: this.difficulty,
      mineTiles: [...this.mineTiles].sort(numericSort),
      selectedTiles: [...this.selectedTiles].sort(numericSort),
      status: this.status,
      reward: this.reward.toString(),
      detonatedTile: this.detonatedTile
    };
  }

  private selectTile(tile: number): GameEngineTransition {
    validateTile(tile);
    if (this.selectedTiles.has(tile)) throw new Error("Tile was already selected");
    const beforeSelection = liabilityDecision({
      wagerCents: this.entryAmount,
      mines: this.mineCount(),
      safeSelections: this.safeSelectionCount(),
      maximumPayoutCents: this.configuration.maximumPayoutCents,
      maximumMultiplierBps: this.configuration.maximumMultiplierBps,
      returnBps: this.configuration.returnBps
    });
    if (!beforeSelection.nextSelectionAllowed) throw new Error("The next tile would exceed the round payout limit");
    this.selectedTiles.add(tile);
    if (this.mineTiles.has(tile)) return this.finishMineLoss(tile);

    const afterSelection = liabilityDecision({
      wagerCents: this.entryAmount,
      mines: this.mineCount(),
      safeSelections: this.safeSelectionCount(),
      maximumPayoutCents: this.configuration.maximumPayoutCents,
      maximumMultiplierBps: this.configuration.maximumMultiplierBps,
      returnBps: this.configuration.returnBps
    });
    if (afterSelection.cashOutRequired) return this.cashOut("AUTO_CASH_OUT", [{ type: "SAFE_TILE_REVEALED", tile }, { type: "PAYOUT_LIMIT_REACHED", reason: afterSelection.reason }]);
    return { publicState: this.getPublicState(), events: [{ type: "SAFE_TILE_REVEALED", tile }], complete: false };
  }

  private cashOut(eventType: "CASHED_OUT" | "AUTO_CASH_OUT", precedingEvents: readonly unknown[] = []): GameEngineTransition {
    const safeSelections = this.safeSelectionCount();
    if (safeSelections === 0) throw new Error("At least one safe tile is required before cash-out");
    this.reward = payoutQuote(this.entryAmount, this.mineCount(), safeSelections, this.configuration.returnBps).grossPayoutCents;
    this.status = eventType === "CASHED_OUT" ? "CASHED_OUT" : "AUTO_CASHED_OUT";
    return this.completedTransition([...precedingEvents, { type: eventType, reward: this.reward.toString() }]);
  }

  private finishMineLoss(tile: number): GameEngineTransition {
    this.detonatedTile = tile;
    this.reward = 0n;
    this.status = "MINE_HIT";
    return this.completedTransition([{ type: "MINE_HIT", tile }]);
  }

  private finishAbandoned(): GameEngineTransition {
    this.reward = 0n;
    this.status = "ABANDONED";
    return this.completedTransition([{ type: "ROUND_EXPIRED" }]);
  }

  private completedTransition(events: readonly unknown[]): GameEngineTransition {
    return { publicState: this.getPublicState(), events, complete: true, authoritativeResult: this.authoritativeResult() };
  }

  private authoritativeResult(): NeonMinesAuthoritativeResult {
    const outcome: NeonMinesOutcome = this.status === "CASHED_OUT" ? "CASHED_OUT" : this.status === "AUTO_CASHED_OUT" ? "AUTO_CASHOUT" : this.status === "ABANDONED" ? "ABANDONED" : "MINE_HIT";
    return {
      outcome,
      difficulty: this.difficulty,
      mineCount: this.mineCount(),
      mineTiles: [...this.mineTiles].sort(numericSort),
      selectedTiles: [...this.selectedTiles].sort(numericSort),
      detonatedTile: this.detonatedTile,
      safeSelections: this.safeSelectionCount(),
      entryAmount: this.entryAmount.toString(),
      reward: this.reward.toString()
    };
  }

  private mineCount(): number { return NEON_MINES_DIFFICULTIES[this.difficulty].mines; }
  private safeSelectionCount(): number { return [...this.selectedTiles].filter((tile) => !this.mineTiles.has(tile)).length; }
}

export function placeMines(mineCount: number, random: NeonMinesRandom = secureRandom): readonly number[] {
  if (!Number.isSafeInteger(mineCount) || mineCount < 1 || mineCount >= NEON_MINES_BOARD_TILES) throw new Error("Invalid Neon Mines mine count");
  const tiles = Array.from({ length: NEON_MINES_BOARD_TILES }, (_, index) => index);
  for (let index = 0; index < mineCount; index += 1) {
    const selected = random.integer(index, tiles.length);
    if (!Number.isSafeInteger(selected) || selected < index || selected >= tiles.length) throw new Error("Random source produced an invalid tile index");
    [tiles[index], tiles[selected]] = [tiles[selected]!, tiles[index]!];
  }
  return tiles.slice(0, mineCount).sort(numericSort);
}

function validateConfiguration(configuration: NeonMinesEngineConfiguration): void {
  if (!Number.isSafeInteger(configuration.returnBps) || configuration.returnBps < 1 || configuration.returnBps > 10_000) throw new Error("Invalid Neon Mines return basis points");
  if (!Number.isSafeInteger(configuration.maximumMultiplierBps) || configuration.maximumMultiplierBps < 10_000) throw new Error("Invalid Neon Mines maximum multiplier");
  if (configuration.maximumPayoutCents <= 0n) throw new Error("Invalid Neon Mines maximum payout");
}

function validateSnapshot(snapshot: NeonMinesSnapshot, entryAmount: bigint, difficulty: NeonMinesDifficulty, configuration: NeonMinesEngineConfiguration): void {
  if (snapshot.version !== NEON_MINES_VERSION || snapshot.entryAmount !== entryAmount.toString() || snapshot.difficulty !== difficulty) throw new Error("Neon Mines snapshot identity does not match the round");
  const expectedMines = NEON_MINES_DIFFICULTIES[difficulty].mines;
  validateTileList(snapshot.mineTiles, expectedMines, "mine tiles");
  validateTileList(snapshot.selectedTiles, undefined, "selected tiles");
  if (!isRoundStatus(snapshot.status) || !/^[0-9]+$/u.test(snapshot.reward)) throw new Error("Invalid Neon Mines snapshot result");
  if (snapshot.detonatedTile !== null) validateTile(snapshot.detonatedTile);
  const mines = new Set(snapshot.mineTiles);
  const selectedMines = snapshot.selectedTiles.filter((tile) => mines.has(tile));
  const safeSelections = snapshot.selectedTiles.length - selectedMines.length;
  // Every recorded safe pick must have been reachable before automatic cash-out.
  // A correct payout alone does not establish that the stored path was legal.
  for (let safe = 0; safe < safeSelections; safe += 1) {
    if (!liabilityDecision({ wagerCents: entryAmount, mines: expectedMines, safeSelections: safe, maximumPayoutCents: configuration.maximumPayoutCents, maximumMultiplierBps: configuration.maximumMultiplierBps, returnBps: configuration.returnBps }).nextSelectionAllowed) {
      throw new Error("Neon Mines snapshot exceeds reachable payout limits");
    }
  }
  const currentDecision = liabilityDecision({ wagerCents: entryAmount, mines: expectedMines, safeSelections, maximumPayoutCents: configuration.maximumPayoutCents, maximumMultiplierBps: configuration.maximumMultiplierBps, returnBps: configuration.returnBps });
  if ((snapshot.status === "ACTIVE" || snapshot.status === "MINE_HIT") && !currentDecision.nextSelectionAllowed) throw new Error("Neon Mines snapshot contains a move after the payout limit");
  if (snapshot.status === "CASHED_OUT" && currentDecision.cashOutRequired) throw new Error("Neon Mines snapshot must record automatic cash-out at the payout limit");
  if (snapshot.status === "ACTIVE") {
    const decision = liabilityDecision({ wagerCents: entryAmount, mines: expectedMines, safeSelections, maximumPayoutCents: configuration.maximumPayoutCents, maximumMultiplierBps: configuration.maximumMultiplierBps, returnBps: configuration.returnBps });
    if (selectedMines.length > 0 || snapshot.reward !== "0" || snapshot.detonatedTile !== null || decision.cashOutRequired) throw new Error("Active Neon Mines snapshot exposes an invalid state");
  }
  if (snapshot.status === "MINE_HIT" && (snapshot.reward !== "0" || snapshot.detonatedTile === null || selectedMines.length !== 1 || !selectedMines.includes(snapshot.detonatedTile))) throw new Error("Invalid Neon Mines mine-hit snapshot");
  if (snapshot.status === "ABANDONED" && (snapshot.reward !== "0" || snapshot.detonatedTile !== null || snapshot.selectedTiles.length !== 0)) throw new Error("Invalid Neon Mines abandoned snapshot");
  if (snapshot.status === "CASHED_OUT" || snapshot.status === "AUTO_CASHED_OUT") {
    const expectedReward = safeSelections === 0 ? 0n : payoutQuote(entryAmount, expectedMines, safeSelections, configuration.returnBps).grossPayoutCents;
    if (selectedMines.length > 0 || expectedReward <= 0n || BigInt(snapshot.reward) !== expectedReward || snapshot.detonatedTile !== null) throw new Error("Invalid Neon Mines cash-out snapshot");
  }
}

function validateTileList(tiles: readonly number[], requiredLength: number | undefined, name: string): void {
  if (!Array.isArray(tiles) || (requiredLength !== undefined && tiles.length !== requiredLength) || new Set(tiles).size !== tiles.length) throw new Error(`Invalid Neon Mines ${name}`);
  for (const tile of tiles) validateTile(tile);
}

function validateTile(tile: number): void {
  if (!Number.isSafeInteger(tile) || tile < 0 || tile >= NEON_MINES_BOARD_TILES) throw new Error("Tile must be a whole number from 0 through 24");
}

function isRoundStatus(value: unknown): value is NeonMinesRoundStatus { return value === "ACTIVE" || value === "CASHED_OUT" || value === "MINE_HIT" || value === "AUTO_CASHED_OUT" || value === "ABANDONED"; }
function numericSort(left: number, right: number): number { return left - right; }
const secureRandom: NeonMinesRandom = { integer: randomInt };
