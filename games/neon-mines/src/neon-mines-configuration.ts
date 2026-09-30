import type { GameDefinition } from "@game-platform/game-core";
import { NeonMinesEngine, NEON_MINES_SLUG, NEON_MINES_VERSION } from "./neon-mines-engine.js";
import { NEON_MINES_DIFFICULTIES, NEON_MINES_WAGERS_CENTS } from "./neon-mines-math.js";

export function parseNeonMinesConfiguration(raw: unknown) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("Invalid Mines configuration");
  const value = raw as Record<string, unknown>;
  const allowed = ["boardTiles", "returnBps", "maximumMultiplierBps", "maximumPayoutCents", "wagerDenominationsCents", "difficulties", "completionOnly"];
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("Unknown Mines configuration field");
  const legacy = value.completionOnly === undefined;
  if (value.boardTiles !== 9 || (!legacy && value.completionOnly !== true)) throw new Error("Invalid Mines completion configuration");
  if (!legacy && (value.returnBps !== undefined || value.maximumMultiplierBps !== undefined || value.maximumPayoutCents !== undefined)) throw new Error("Progressive payout fields are not supported for completion-only Mines");
  if (JSON.stringify(value.wagerDenominationsCents) !== JSON.stringify(NEON_MINES_WAGERS_CENTS.map(Number))) throw new Error("Invalid Mines denominations");
  const difficulties = value.difficulties as Record<string, { mines?: unknown; maximumWagerCents?: unknown; rewardMultiplier?: unknown }> | undefined;
  if (typeof difficulties !== "object" || difficulties === null || Array.isArray(difficulties)
    || Object.keys(difficulties).some((name) => !Object.hasOwn(NEON_MINES_DIFFICULTIES, name))) throw new Error("Invalid Mines difficulties");
  for (const [name, rule] of Object.entries(NEON_MINES_DIFFICULTIES)) {
    if (typeof difficulties[name] !== "object" || difficulties[name] === null || Array.isArray(difficulties[name])
      || Object.keys(difficulties[name]).some((key) => key !== "mines" && key !== "maximumWagerCents" && key !== "rewardMultiplier")) throw new Error("Invalid Mines difficulty fields");
    const configured = difficulties[name]!;
    if (configured.mines !== rule.mines || !Number.isSafeInteger(configured.maximumWagerCents)
      || (configured.maximumWagerCents as number) < 10 || (configured.maximumWagerCents as number) > (legacy ? 5_000 : 2_000)
      || (!legacy && (!Number.isSafeInteger(configured.rewardMultiplier) || (configured.rewardMultiplier as number) < 1 || (configured.rewardMultiplier as number) > 100))
      || (legacy && configured.rewardMultiplier !== undefined)) throw new Error("Invalid Mines difficulty configuration");
  }
  if (legacy && (value.returnBps !== 9600 || value.maximumMultiplierBps !== 5_000_000
    || !Number.isSafeInteger(value.maximumPayoutCents))) throw new Error("Invalid legacy Mines payout configuration");
  return {
    difficulties: Object.fromEntries(Object.entries(NEON_MINES_DIFFICULTIES).map(([name, rule]) => [name, {
      mines: rule.mines,
      maximumWagerCents: BigInt(difficulties[name]!.maximumWagerCents as number),
      rewardMultiplier: legacy ? rule.rewardMultiplier : difficulties[name]!.rewardMultiplier as number
    }])) as Record<keyof typeof NEON_MINES_DIFFICULTIES, { mines: number; maximumWagerCents: bigint; rewardMultiplier: number }>
  };
}

export class NeonMinesDefinition implements GameDefinition {
  public readonly slug = NEON_MINES_SLUG;
  public readonly version = NEON_MINES_VERSION;
  public validateConfiguration(configuration: Readonly<Record<string, unknown>>) {
    parseNeonMinesConfiguration(configuration);
    return configuration;
  }
  public createEngine(): NeonMinesEngine {
    throw new Error("Neon Mines requires a durable session with an explicit player difficulty");
  }
}
