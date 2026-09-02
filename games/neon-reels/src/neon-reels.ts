import { randomInt } from "node:crypto";
import type { ActiveGameEngine, GameDefinition, GameEngineTransition } from "@game-platform/game-core";

export const NEON_REELS_SLUG = "neon-reels" as const;
export const NEON_REELS_VERSION = "1.0.0" as const;
export const NEON_REELS_SYMBOLS = ["LEMON", "CHERRY", "GEM", "BELL", "STAR", "SEVEN", "WILD", "SCATTER"] as const;
export type NeonReelsSymbol = typeof NEON_REELS_SYMBOLS[number];

export interface NeonReelsConfiguration {
  readonly rows: 3;
  readonly reels: 5;
  readonly weights: Readonly<Record<NeonReelsSymbol, number>>;
  readonly payouts: Readonly<Record<Exclude<NeonReelsSymbol, "SCATTER">, Readonly<Record<3 | 4 | 5, number>>>>;
  readonly scatterPayouts: Readonly<Record<3 | 4 | 5, number>>;
  readonly maxWinMultiplier: number;
  readonly wagerDenominationsCents: readonly number[];
}
export interface NeonReelsWinLine { readonly payline: number; readonly symbol: Exclude<NeonReelsSymbol, "SCATTER">; readonly count: 3 | 4 | 5; readonly multiplier: number }
export interface NeonReelsSpin {
  readonly reels: readonly (readonly NeonReelsSymbol[])[];
  readonly winLines: readonly NeonReelsWinLine[];
  readonly scatterCount: number;
  readonly totalMultiplier: number;
  readonly reward: bigint;
}
export interface NeonReelsRandom { integer(minimum: number, maximumExclusive: number): number }

const PAYLINES: readonly (readonly [number, number, number, number, number])[] = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2]
];

export class NeonReelsDefinition implements GameDefinition {
  public readonly slug = NEON_REELS_SLUG;
  public readonly version = NEON_REELS_VERSION;
  public constructor(private readonly random: NeonReelsRandom = secureRandom) {}
  public validateConfiguration(configuration: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> { return parseNeonReelsConfiguration(configuration) as unknown as Readonly<Record<string, unknown>>; }
  public createEngine(context: Parameters<GameDefinition["createEngine"]>[0]): ActiveGameEngine { return new NeonReelsEngine(context.entryAmount, parseNeonReelsConfiguration(context.configuration), this.random); }
}

export class NeonReelsEngine implements ActiveGameEngine {
  #spin: NeonReelsSpin | null = null;
  public constructor(private readonly entryAmount: bigint, private readonly configuration: NeonReelsConfiguration, private readonly random: NeonReelsRandom = secureRandom) {}
  public async handleInput(context: { readonly payload: unknown }): Promise<GameEngineTransition> {
    if (!isSpinInput(context.payload)) throw new Error("Invalid Neon Reels input");
    return this.complete(new Date());
  }
  public async complete(_receivedAt?: Date): Promise<GameEngineTransition> {
    this.#spin ??= createNeonReelsSpin(this.entryAmount, this.configuration, this.random);
    return { publicState: toPublicState(this.entryAmount, this.#spin), events: [{ type: this.#spin.reward > 0n ? "SLOT_WIN" : "SLOT_LOSS" }], complete: true, authoritativeResult: toResult(this.#spin) };
  }
  public getPublicState(): unknown { return this.#spin === null ? { status: "READY" } : toPublicState(this.entryAmount, this.#spin); }
}

export function createNeonReelsSpin(entryAmount: bigint, configuration: NeonReelsConfiguration, random: NeonReelsRandom = secureRandom): NeonReelsSpin {
  if (entryAmount < 0n || !configuration.wagerDenominationsCents.includes(Number(entryAmount))) throw new Error("Invalid Neon Reels wager denomination");
  const reels = Array.from({ length: configuration.reels }, () => Array.from({ length: configuration.rows }, () => pickWeighted(configuration.weights, random)));
  const winLines = evaluateLines(reels, configuration);
  const scatterCount = reels.flat().filter((symbol) => symbol === "SCATTER").length;
  const scatterMultiplier = scatterCount >= 3 ? configuration.scatterPayouts[Math.min(scatterCount, 5) as 3 | 4 | 5] : 0;
  const totalMultiplier = Math.min(configuration.maxWinMultiplier, winLines.reduce((sum, line) => sum + line.multiplier, 0) + scatterMultiplier);
  return { reels, winLines, scatterCount, totalMultiplier, reward: entryAmount * BigInt(totalMultiplier) };
}

export function parseNeonReelsConfiguration(value: Readonly<Record<string, unknown>>): NeonReelsConfiguration {
  if (value.rows !== 3 || value.reels !== 5) throw new Error("Neon Reels requires exactly 5 reels and 3 rows");
  const weights = symbolNumbers(value.weights, 1, 10_000, "weights");
  const rawPayouts = object(value.payouts, "payouts");
  const payouts = Object.fromEntries(NEON_REELS_SYMBOLS.filter((symbol) => symbol !== "SCATTER").map((symbol) => [symbol, countPayouts(rawPayouts[symbol], `payouts.${symbol}`)])) as unknown as NeonReelsConfiguration["payouts"];
  const scatterPayouts = countPayouts(value.scatterPayouts, "scatterPayouts");
  const maxWinMultiplier = integer(value.maxWinMultiplier, 1, 10_000, "maxWinMultiplier");
  const wagerDenominationsCents = denominations(value.wagerDenominationsCents);
  return { rows: 3, reels: 5, weights, payouts, scatterPayouts, maxWinMultiplier, wagerDenominationsCents };
}

export function parseNeonReelsResult(value: unknown): Omit<NeonReelsSpin, "reward"> & { readonly reward: bigint } {
  const result = object(value, "result");
  if (!Array.isArray(result.reels) || result.reels.length !== 5 || result.reels.some((reel) => !Array.isArray(reel) || reel.length !== 3 || reel.some((symbol) => !isSymbol(symbol)))) throw new Error("Invalid Neon Reels result reels");
  if (!Array.isArray(result.winLines)) throw new Error("Invalid Neon Reels win lines");
  const winLines = result.winLines.map((value, index) => parseWinLine(value, index));
  const scatterCount = integer(result.scatterCount, 0, 15, "scatterCount");
  const totalMultiplier = integer(result.totalMultiplier, 0, 10_000, "totalMultiplier");
  if (typeof result.reward !== "string" || !/^[0-9]+$/u.test(result.reward)) throw new Error("Invalid Neon Reels reward");
  return { reels: result.reels as NeonReelsSpin["reels"], winLines, scatterCount, totalMultiplier, reward: BigInt(result.reward) };
}

export function toNeonReelsResult(spin: NeonReelsSpin) { return { reels: spin.reels, winLines: spin.winLines, scatterCount: spin.scatterCount, totalMultiplier: spin.totalMultiplier, reward: spin.reward.toString() }; }
export function toNeonReelsPublicState(entryAmount: bigint, spin: NeonReelsSpin) { return toPublicState(entryAmount, spin); }

function evaluateLines(reels: readonly (readonly NeonReelsSymbol[])[], configuration: NeonReelsConfiguration): NeonReelsWinLine[] {
  const wins: NeonReelsWinLine[] = [];
  PAYLINES.forEach((rows, payline) => {
    const line = rows.map((row, reel) => reels[reel]?.[row]);
    const base = line.find((symbol) => symbol !== "WILD" && symbol !== "SCATTER") ?? (line[0] === "WILD" ? "WILD" : null);
    if (base === null || base === undefined) return;
    let count = 0;
    for (const symbol of line) { if (symbol === base || symbol === "WILD") count += 1; else break; }
    if (count < 3) return;
    const paidCount = Math.min(count, 5) as 3 | 4 | 5;
    const multiplier = configuration.payouts[base][paidCount];
    if (multiplier > 0) wins.push({ payline, symbol: base, count: paidCount, multiplier });
  });
  return wins;
}
function pickWeighted(weights: NeonReelsConfiguration["weights"], random: NeonReelsRandom): NeonReelsSymbol {
  const total = NEON_REELS_SYMBOLS.reduce((sum, symbol) => sum + weights[symbol], 0);
  const roll = random.integer(0, total); let boundary = 0;
  for (const symbol of NEON_REELS_SYMBOLS) { boundary += weights[symbol]; if (roll < boundary) return symbol; }
  throw new Error("Random source produced an invalid value");
}
function toResult(spin: NeonReelsSpin) { return toNeonReelsResult(spin); }
function toPublicState(entryAmount: bigint, spin: NeonReelsSpin) { return { status: "COMPLETED", entryAmount: entryAmount.toString(), reels: spin.reels, winLines: spin.winLines, scatterCount: spin.scatterCount, totalMultiplier: spin.totalMultiplier, reward: spin.reward.toString(), outcome: spin.reward > 0n ? "WIN" : "LOSE" }; }
function isSpinInput(value: unknown): boolean { return typeof value === "object" && value !== null && !Array.isArray(value) && (value as Record<string, unknown>).action === "SPIN"; }
function isSymbol(value: unknown): value is NeonReelsSymbol { return typeof value === "string" && (NEON_REELS_SYMBOLS as readonly string[]).includes(value); }
function parseWinLine(value: unknown, index: number): NeonReelsWinLine { const line = object(value, `winLines.${index}`); const payline = integer(line.payline, 0, 4, "payline"); if (!isSymbol(line.symbol) || line.symbol === "SCATTER") throw new Error("Invalid win symbol"); const count = integer(line.count, 3, 5, "count") as 3 | 4 | 5; const multiplier = integer(line.multiplier, 0, 10_000, "multiplier"); return { payline, symbol: line.symbol, count, multiplier }; }
function object(value: unknown, name: string): Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`Invalid ${name}`); return value as Record<string, unknown>; }
function symbolNumbers(value: unknown, minimum: number, maximum: number, name: string): Record<NeonReelsSymbol, number> { const record = object(value, name); return Object.fromEntries(NEON_REELS_SYMBOLS.map((symbol) => [symbol, integer(record[symbol], minimum, maximum, `${name}.${symbol}`)])) as Record<NeonReelsSymbol, number>; }
function countPayouts(value: unknown, name: string): Record<3 | 4 | 5, number> { const record = object(value, name); return { 3: integer(record["3"], 0, 10_000, `${name}.3`), 4: integer(record["4"], 0, 10_000, `${name}.4`), 5: integer(record["5"], 0, 10_000, `${name}.5`) }; }
function denominations(value: unknown): readonly number[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) throw new Error("Invalid wagerDenominationsCents");
  const parsed = value.map((amount, index) => integer(amount, 1, 1_000_000_000, `wagerDenominationsCents.${index}`));
  if (new Set(parsed).size !== parsed.length || parsed.some((amount, index) => index > 0 && amount <= (parsed[index - 1] ?? 0))) throw new Error("Wager denominations must be unique and ascending");
  return parsed;
}
function integer(value: unknown, minimum: number, maximum: number, name: string): number { if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new Error(`Invalid ${name}`); return value as number; }
const secureRandom: NeonReelsRandom = { integer: randomInt };
