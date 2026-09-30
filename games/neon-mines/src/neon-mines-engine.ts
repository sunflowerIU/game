import { randomInt } from "node:crypto";
import { parseNeonMinesAction, type NeonMinesPublicState, type NeonMinesRoundStatus } from "@game-platform/contracts";
export type { NeonMinesPublicState, NeonMinesRoundStatus } from "@game-platform/contracts";
import type { ActiveGameEngine, GameEngineTransition } from "@game-platform/game-core";
import { NEON_MINES_BOARD_TILES, NEON_MINES_DIFFICULTIES, validateDifficultyWager, type NeonMinesDifficulty } from "./neon-mines-math.js";

export const NEON_MINES_SLUG = "neon-mines" as const;
export const NEON_MINES_VERSION = "1.0.0" as const;
export type NeonMinesOutcome = "WON" | "MINE_HIT" | "ABANDONED";
export interface NeonMinesRandom { integer(minimum: number, maximumExclusive: number): number; }
export interface NeonMinesDifficultyConfiguration { readonly mines: number; readonly maximumWagerCents: bigint; readonly rewardMultiplier: number; }
export interface NeonMinesEngineConfiguration { readonly difficulties: Readonly<Record<NeonMinesDifficulty, NeonMinesDifficultyConfiguration>>; }

export const DEFAULT_NEON_MINES_ENGINE_CONFIGURATION: NeonMinesEngineConfiguration = {
  difficulties: Object.fromEntries(Object.entries(NEON_MINES_DIFFICULTIES).map(([name, rule]) => [name, {
    mines: rule.mines, maximumWagerCents: rule.maximumWagerCents, rewardMultiplier: rule.rewardMultiplier
  }])) as Record<NeonMinesDifficulty, NeonMinesDifficultyConfiguration>
};

export interface NeonMinesSnapshot {
  readonly version: typeof NEON_MINES_VERSION; readonly entryAmount: string; readonly difficulty: NeonMinesDifficulty;
  readonly mineTiles: readonly number[]; readonly selectedTiles: readonly number[]; readonly status: NeonMinesRoundStatus;
  readonly reward: string; readonly detonatedTile: number | null;
}
export interface NeonMinesAuthoritativeResult {
  readonly outcome: NeonMinesOutcome; readonly difficulty: NeonMinesDifficulty; readonly mineCount: number;
  readonly mineTiles: readonly number[]; readonly selectedTiles: readonly number[]; readonly detonatedTile: number | null;
  readonly safeSelections: number; readonly entryAmount: string; readonly reward: string;
}

export class NeonMinesEngine implements ActiveGameEngine {
  private readonly mineTiles: ReadonlySet<number>;
  private readonly selectedTiles = new Set<number>();
  private status: NeonMinesRoundStatus = "ACTIVE";
  private reward = 0n;
  private detonatedTile: number | null = null;

  public constructor(private readonly entryAmount: bigint, private readonly difficulty: NeonMinesDifficulty,
    private readonly configuration: NeonMinesEngineConfiguration = DEFAULT_NEON_MINES_ENGINE_CONFIGURATION,
    random: NeonMinesRandom = secureRandom, restoredSnapshot?: NeonMinesSnapshot) {
    validateConfiguration(configuration);
    validateDifficultyWager(difficulty, entryAmount, this.rule().maximumWagerCents);
    if (restoredSnapshot === undefined) this.mineTiles = new Set(placeMines(this.rule().mines, random));
    else {
      validateSnapshot(restoredSnapshot, entryAmount, difficulty, configuration);
      this.mineTiles = new Set(restoredSnapshot.mineTiles);
      for (const tile of restoredSnapshot.selectedTiles) this.selectedTiles.add(tile);
      this.status = restoredSnapshot.status; this.reward = BigInt(restoredSnapshot.reward); this.detonatedTile = restoredSnapshot.detonatedTile;
    }
  }

  public static restore(snapshot: NeonMinesSnapshot, configuration: NeonMinesEngineConfiguration = DEFAULT_NEON_MINES_ENGINE_CONFIGURATION): NeonMinesEngine {
    return new NeonMinesEngine(BigInt(snapshot.entryAmount), snapshot.difficulty, configuration, secureRandom, snapshot);
  }
  public async handleInput(context: { readonly payload: unknown }): Promise<GameEngineTransition> {
    if (this.status !== "ACTIVE") throw new Error("Neon Mines round is already complete");
    const input = parseNeonMinesAction(context.payload);
    return input.action === "LEAVE" ? this.finishAbandoned("PLAYER_LEFT") : this.selectTile(input.tile);
  }
  public async complete(): Promise<GameEngineTransition> {
    if (this.status !== "ACTIVE") return this.completedTransition([]);
    return this.finishAbandoned("ROUND_EXPIRED");
  }
  public getPublicState(): NeonMinesPublicState {
    const complete = this.status !== "ACTIVE";
    return { status: this.status, boardTiles: NEON_MINES_BOARD_TILES, difficulty: this.difficulty, mineCount: this.mineCount(),
      entryAmount: this.entryAmount.toString(), selectedTiles: [...this.selectedTiles].sort(numericSort),
      revealedMines: complete ? [...this.mineTiles].sort(numericSort) : [], detonatedTile: this.detonatedTile,
      safeSelections: this.safeSelectionCount(), rewardMultiplier: this.rule().rewardMultiplier,
      currentCashOut: (complete ? this.reward : 0n).toString(), nextSafePayout: (this.entryAmount * BigInt(this.rule().rewardMultiplier)).toString(),
      cashOutAvailable: false, nextSelectionAllowed: !complete };
  }
  public toSnapshot(): NeonMinesSnapshot {
    return { version: NEON_MINES_VERSION, entryAmount: this.entryAmount.toString(), difficulty: this.difficulty,
      mineTiles: [...this.mineTiles].sort(numericSort), selectedTiles: [...this.selectedTiles].sort(numericSort),
      status: this.status, reward: this.reward.toString(), detonatedTile: this.detonatedTile };
  }
  private selectTile(tile: number): GameEngineTransition {
    validateTile(tile);
    if (this.selectedTiles.has(tile)) throw new Error("Tile was already selected");
    this.selectedTiles.add(tile);
    if (this.mineTiles.has(tile)) return this.finishMineLoss(tile);
    if (this.safeSelectionCount() === NEON_MINES_BOARD_TILES - this.mineCount()) return this.finishWin(tile);
    return { publicState: this.getPublicState(), events: [{ type: "SAFE_TILE_REVEALED", tile }], complete: false };
  }
  private finishWin(tile: number): GameEngineTransition {
    this.reward = this.entryAmount * BigInt(this.rule().rewardMultiplier); this.status = "WON";
    return this.completedTransition([{ type: "SAFE_TILE_REVEALED", tile }, { type: "GAME_COMPLETED", reward: this.reward.toString() }]);
  }
  private finishMineLoss(tile: number): GameEngineTransition {
    this.detonatedTile = tile; this.reward = 0n; this.status = "MINE_HIT";
    return this.completedTransition([{ type: "MINE_HIT", tile }]);
  }
  private finishAbandoned(eventType: "PLAYER_LEFT" | "ROUND_EXPIRED"): GameEngineTransition {
    this.reward = this.selectedTiles.size === 0 ? this.entryAmount : 0n; this.status = "ABANDONED";
    return this.completedTransition([{ type: eventType, refunded: this.reward > 0n }]);
  }
  private completedTransition(events: readonly unknown[]): GameEngineTransition {
    return { publicState: this.getPublicState(), events, complete: true, authoritativeResult: this.authoritativeResult() };
  }
  private authoritativeResult(): NeonMinesAuthoritativeResult {
    return { outcome: this.status === "WON" ? "WON" : this.status === "MINE_HIT" ? "MINE_HIT" : "ABANDONED",
      difficulty: this.difficulty, mineCount: this.mineCount(), mineTiles: [...this.mineTiles].sort(numericSort),
      selectedTiles: [...this.selectedTiles].sort(numericSort), detonatedTile: this.detonatedTile,
      safeSelections: this.safeSelectionCount(), entryAmount: this.entryAmount.toString(), reward: this.reward.toString() };
  }
  private rule(): NeonMinesDifficultyConfiguration { return this.configuration.difficulties[this.difficulty]; }
  private mineCount(): number { return this.rule().mines; }
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
  for (const difficulty of Object.keys(NEON_MINES_DIFFICULTIES) as NeonMinesDifficulty[]) {
    const rule = configuration.difficulties[difficulty];
    if (!rule || rule.mines !== NEON_MINES_DIFFICULTIES[difficulty].mines || !Number.isSafeInteger(rule.rewardMultiplier) || rule.rewardMultiplier < 1 || rule.rewardMultiplier > 100
      || rule.maximumWagerCents < 10n || rule.maximumWagerCents > 5_000n) throw new Error("Invalid Neon Mines engine configuration");
  }
}
function validateSnapshot(snapshot: NeonMinesSnapshot, entryAmount: bigint, difficulty: NeonMinesDifficulty, configuration: NeonMinesEngineConfiguration): void {
  if (snapshot.version !== NEON_MINES_VERSION || snapshot.entryAmount !== entryAmount.toString() || snapshot.difficulty !== difficulty) throw new Error("Invalid Neon Mines snapshot identity");
  if (!isRoundStatus(snapshot.status) || !/^[0-9]+$/u.test(snapshot.reward)) throw new Error("Invalid Neon Mines snapshot result");
  const rule = configuration.difficulties[difficulty]; const mines = uniqueValidTiles(snapshot.mineTiles); const selected = uniqueValidTiles(snapshot.selectedTiles);
  if (mines.size !== rule.mines || snapshot.mineTiles.length !== mines.size || snapshot.selectedTiles.length !== selected.size) throw new Error("Invalid Neon Mines snapshot board");
  const selectedMines = [...selected].filter((tile) => mines.has(tile)); const safe = selected.size - selectedMines.length; const allSafe = NEON_MINES_BOARD_TILES - rule.mines;
  if (snapshot.status === "ACTIVE" && (selectedMines.length !== 0 || safe >= allSafe || snapshot.reward !== "0" || snapshot.detonatedTile !== null)) throw new Error("Active Neon Mines snapshot exposes an invalid state");
  if (snapshot.status === "MINE_HIT" && (snapshot.reward !== "0" || snapshot.detonatedTile === null || selectedMines.length !== 1 || !selectedMines.includes(snapshot.detonatedTile))) throw new Error("Invalid Neon Mines mine-hit snapshot");
  if (snapshot.status === "WON" && (selectedMines.length !== 0 || safe !== allSafe || snapshot.detonatedTile !== null || BigInt(snapshot.reward) !== entryAmount * BigInt(rule.rewardMultiplier))) throw new Error("Invalid Neon Mines winning snapshot");
  if (snapshot.status === "ABANDONED" && (selectedMines.length !== 0 || snapshot.detonatedTile !== null || BigInt(snapshot.reward) !== (selected.size === 0 ? entryAmount : 0n))) throw new Error("Invalid Neon Mines abandoned snapshot");
}
function uniqueValidTiles(tiles: readonly number[]): ReadonlySet<number> { for (const tile of tiles) validateTile(tile); return new Set(tiles); }
function validateTile(tile: number): void { if (!Number.isSafeInteger(tile) || tile < 0 || tile >= NEON_MINES_BOARD_TILES) throw new Error("Tile must be a whole number from 0 through 8"); }
function isRoundStatus(value: unknown): value is NeonMinesRoundStatus { return value === "ACTIVE" || value === "WON" || value === "MINE_HIT" || value === "ABANDONED"; }
function numericSort(left: number, right: number): number { return left - right; }
const secureRandom: NeonMinesRandom = { integer: randomInt };
