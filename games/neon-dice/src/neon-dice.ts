import { randomInt } from "node:crypto";
import type { ActiveGameEngine, GameDefinition, GameEngineTransition } from "@game-platform/game-core";

export const NEON_DICE_SLUG = "neon-dice" as const;
export const NEON_DICE_VERSION = "1.0.0" as const;
export const NEON_DICE_RETURN_BPS = 9_500 as const;
export const NEON_DICE_MAXIMUM_WAGER_CENTS = 3_000 as const;
export const NEON_DICE_MAXIMUM_PAYOUT_CENTS = 20_000 as const;
export const NEON_DICE_SUPPORTED_WAGERS_CENTS = [50, 100, 200, 500, 1_000, 2_000, 3_000] as const;
export const NEON_DICE_SELECTIONS = ["UNDER_7", "EXACTLY_7", "OVER_7"] as const;
export type NeonDiceSelection = typeof NEON_DICE_SELECTIONS[number];

export const NEON_DICE_MULTIPLIER_BPS: Readonly<Record<NeonDiceSelection, number>> = {
  UNDER_7: 22_800,
  EXACTLY_7: 57_000,
  OVER_7: 22_800
};

export interface NeonDiceConfiguration {
  readonly returnBps: typeof NEON_DICE_RETURN_BPS;
  readonly multiplierBps: Readonly<Record<NeonDiceSelection, number>>;
  readonly wagerDenominationsCents: readonly number[];
  readonly maximumPayoutCents: number;
}

export interface NeonDiceRoll {
  readonly dice: readonly [number, number];
  readonly total: number;
  readonly selection: NeonDiceSelection;
  readonly multiplierBps: number;
  readonly win: boolean;
  readonly reward: bigint;
}

export interface NeonDiceRandom {
  integer(minimum: number, maximumExclusive: number): number;
}

export class NeonDiceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "NeonDiceError";
  }
}

export class NeonDiceDefinition implements GameDefinition {
  public readonly slug = NEON_DICE_SLUG;
  public readonly version = NEON_DICE_VERSION;

  public validateConfiguration(configuration: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
    return parseNeonDiceConfiguration(configuration) as unknown as Readonly<Record<string, unknown>>;
  }

  public createEngine(): ActiveGameEngine {
    throw new NeonDiceError("Neon Dice requires atomic settlement with an explicit player selection");
  }
}

export class NeonDiceEngine implements ActiveGameEngine {
  #roll: NeonDiceRoll | null = null;

  public constructor(
    private readonly entryAmount: bigint,
    private readonly selection: NeonDiceSelection,
    private readonly configuration: NeonDiceConfiguration,
    private readonly random: NeonDiceRandom = secureRandom
  ) {}

  public async handleInput(context: { readonly payload: unknown }): Promise<GameEngineTransition> {
    if (!isRollInput(context.payload)) throw new NeonDiceError("Invalid Neon Dice input");
    return this.complete(new Date());
  }

  public async complete(_receivedAt?: Date): Promise<GameEngineTransition> {
    this.#roll ??= createNeonDiceRoll(this.entryAmount, this.selection, this.configuration, this.random);
    return {
      publicState: toNeonDicePublicState(this.entryAmount, this.#roll),
      events: [{ type: this.#roll.win ? "DICE_WIN" : "DICE_LOSS" }],
      complete: true,
      authoritativeResult: toNeonDiceResult(this.#roll)
    };
  }

  public getPublicState(): unknown {
    return this.#roll === null
      ? { status: "READY", entryAmount: this.entryAmount.toString(), selection: this.selection }
      : toNeonDicePublicState(this.entryAmount, this.#roll);
  }
}

export function parseNeonDiceConfiguration(raw: unknown): NeonDiceConfiguration {
  const value = strictObject(raw, "Neon Dice configuration", ["returnBps", "multiplierBps", "wagerDenominationsCents", "maximumPayoutCents"]);
  if (value.returnBps !== NEON_DICE_RETURN_BPS) throw new NeonDiceError("Neon Dice return must remain 95 percent in version 1");

  const rawMultipliers = strictObject(value.multiplierBps, "Neon Dice multipliers", NEON_DICE_SELECTIONS);
  const multiplierBps = Object.fromEntries(NEON_DICE_SELECTIONS.map((selection) => {
    const expected = NEON_DICE_MULTIPLIER_BPS[selection];
    if (rawMultipliers[selection] !== expected) throw new NeonDiceError(`Invalid Neon Dice multiplier for ${selection}`);
    return [selection, expected];
  })) as unknown as Readonly<Record<NeonDiceSelection, number>>;

  const wagerDenominationsCents = parseDenominations(value.wagerDenominationsCents);
  const maximumPayoutCents = integer(value.maximumPayoutCents, 1, NEON_DICE_MAXIMUM_PAYOUT_CENTS, "maximumPayoutCents");
  const largestWager = wagerDenominationsCents.at(-1);
  if (largestWager === undefined) throw new NeonDiceError("At least one Neon Dice wager denomination is required");
  const requiredPayout = rewardFor(largestWager, NEON_DICE_MULTIPLIER_BPS.EXACTLY_7);
  if (requiredPayout > BigInt(maximumPayoutCents)) throw new NeonDiceError("Neon Dice payout cap cannot cover the largest enabled wager");

  return { returnBps: NEON_DICE_RETURN_BPS, multiplierBps, wagerDenominationsCents, maximumPayoutCents };
}

export function createNeonDiceRoll(
  entryAmount: bigint,
  selection: NeonDiceSelection,
  configuration: NeonDiceConfiguration,
  random: NeonDiceRandom = secureRandom
): NeonDiceRoll {
  if (!isSelection(selection)) throw new NeonDiceError("Invalid Neon Dice selection");
  if (entryAmount <= 0n || !configuration.wagerDenominationsCents.some((amount) => BigInt(amount) === entryAmount)) {
    throw new NeonDiceError("Invalid Neon Dice wager denomination");
  }
  const first = rollDie(random);
  const second = rollDie(random);
  const total = first + second;
  const win = selection === "UNDER_7" ? total < 7 : selection === "EXACTLY_7" ? total === 7 : total > 7;
  const multiplierBps = configuration.multiplierBps[selection];
  const reward = win ? rewardForBigInt(entryAmount, multiplierBps) : 0n;
  if (reward > BigInt(configuration.maximumPayoutCents)) throw new NeonDiceError("Neon Dice reward exceeds the configured payout cap");
  return { dice: [first, second], total, selection, multiplierBps, win, reward };
}

export function toNeonDiceResult(roll: NeonDiceRoll) {
  return { ...roll, dice: [...roll.dice] as [number, number], reward: roll.reward.toString() };
}

export function parseNeonDiceResult(raw: unknown, entryAmount: bigint, configuration: NeonDiceConfiguration): NeonDiceRoll {
  const value = strictObject(raw, "Neon Dice result", ["dice", "total", "selection", "multiplierBps", "win", "reward"]);
  if (!Array.isArray(value.dice) || value.dice.length !== 2) throw new NeonDiceError("Invalid Neon Dice result dice");
  const first = integer(value.dice[0], 1, 6, "dice.0");
  const second = integer(value.dice[1], 1, 6, "dice.1");
  if (!isSelection(value.selection)) throw new NeonDiceError("Invalid Neon Dice result selection");
  if (typeof value.reward !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value.reward)) throw new NeonDiceError("Invalid Neon Dice result reward");

  const expected = resolveKnownDice(entryAmount, value.selection, configuration, first, second);
  if (value.total !== expected.total || value.multiplierBps !== expected.multiplierBps || value.win !== expected.win || BigInt(value.reward) !== expected.reward) {
    throw new NeonDiceError("Neon Dice result does not match its authoritative outcome");
  }
  return expected;
}

export function toNeonDicePublicState(entryAmount: bigint, roll: NeonDiceRoll) {
  return {
    status: "COMPLETED",
    entryAmount: entryAmount.toString(),
    dice: roll.dice,
    total: roll.total,
    selection: roll.selection,
    multiplierBps: roll.multiplierBps,
    win: roll.win,
    reward: roll.reward.toString(),
    outcome: roll.win ? "WIN" : "LOSE"
  };
}

export function selectionWins(selection: NeonDiceSelection, total: number): boolean {
  if (!isSelection(selection) || !Number.isSafeInteger(total) || total < 2 || total > 12) throw new NeonDiceError("Invalid Neon Dice outcome");
  return selection === "UNDER_7" ? total < 7 : selection === "EXACTLY_7" ? total === 7 : total > 7;
}

function resolveKnownDice(entryAmount: bigint, selection: NeonDiceSelection, configuration: NeonDiceConfiguration, first: number, second: number): NeonDiceRoll {
  if (entryAmount <= 0n || !configuration.wagerDenominationsCents.some((amount) => BigInt(amount) === entryAmount)) throw new NeonDiceError("Invalid Neon Dice wager denomination");
  const total = first + second;
  const win = selectionWins(selection, total);
  const multiplierBps = configuration.multiplierBps[selection];
  const reward = win ? rewardForBigInt(entryAmount, multiplierBps) : 0n;
  if (reward > BigInt(configuration.maximumPayoutCents)) throw new NeonDiceError("Neon Dice reward exceeds the configured payout cap");
  return { dice: [first, second], total, selection, multiplierBps, win, reward };
}

function parseDenominations(raw: unknown): readonly number[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > NEON_DICE_SUPPORTED_WAGERS_CENTS.length) throw new NeonDiceError("Invalid Neon Dice wager denominations");
  const supported = new Set<number>(NEON_DICE_SUPPORTED_WAGERS_CENTS);
  const values = raw.map((amount, index) => integer(amount, 1, NEON_DICE_MAXIMUM_WAGER_CENTS, `wagerDenominationsCents.${index}`));
  if (values.some((amount) => !supported.has(amount))) throw new NeonDiceError("Unsupported Neon Dice wager denomination");
  if (new Set(values).size !== values.length || values.some((amount, index) => index > 0 && amount <= (values[index - 1] ?? 0))) {
    throw new NeonDiceError("Neon Dice wager denominations must be unique and ascending");
  }
  for (const amount of values) for (const multiplier of Object.values(NEON_DICE_MULTIPLIER_BPS)) {
    if ((BigInt(amount) * BigInt(multiplier)) % 10_000n !== 0n) throw new NeonDiceError("Neon Dice wager produces a fractional-cent reward");
  }
  return values;
}

function rewardFor(entryAmount: number, multiplierBps: number): bigint {
  return rewardForBigInt(BigInt(entryAmount), multiplierBps);
}

function rewardForBigInt(entryAmount: bigint, multiplierBps: number): bigint {
  const scaled = entryAmount * BigInt(multiplierBps);
  if (scaled % 10_000n !== 0n) throw new NeonDiceError("Neon Dice reward is not a whole-cent amount");
  return scaled / 10_000n;
}

function rollDie(random: NeonDiceRandom): number {
  const result = random.integer(1, 7);
  if (!Number.isSafeInteger(result) || result < 1 || result > 6) throw new NeonDiceError("Random source produced an invalid die value");
  return result;
}

function isSelection(value: unknown): value is NeonDiceSelection {
  return typeof value === "string" && (NEON_DICE_SELECTIONS as readonly string[]).includes(value);
}

function isRollInput(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).length === 1 && (value as Record<string, unknown>).action === "ROLL";
}

function strictObject(value: unknown, name: string, allowedKeys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new NeonDiceError(`Invalid ${name}`);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowedKeys.includes(key)) || allowedKeys.some((key) => !(key in record))) throw new NeonDiceError(`Invalid ${name} fields`);
  return record;
}

function integer(value: unknown, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new NeonDiceError(`Invalid ${name}`);
  return value as number;
}

const secureRandom: NeonDiceRandom = { integer: randomInt };
