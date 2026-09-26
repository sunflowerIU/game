import type { GameDefinition } from "@game-platform/game-core";
import { NeonMinesEngine, NEON_MINES_SLUG, NEON_MINES_VERSION } from "./neon-mines-engine.js";
import { NEON_MINES_DIFFICULTIES, NEON_MINES_WAGERS_CENTS } from "./neon-mines-math.js";

export function parseNeonMinesConfiguration(raw: unknown) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("Invalid Mines configuration");
  const value = raw as Record<string, unknown>;
  const allowed = ["boardTiles", "returnBps", "maximumMultiplierBps", "maximumPayoutCents", "wagerDenominationsCents", "difficulties"];
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("Unknown Mines configuration field");
  if (value.boardTiles !== 25 || value.returnBps !== 9600 || value.maximumMultiplierBps !== 5_000_000
    || !Number.isSafeInteger(value.maximumPayoutCents) || (value.maximumPayoutCents as number) < 25 || (value.maximumPayoutCents as number) > 50_000) throw new Error("Invalid Mines payout configuration");
  if (JSON.stringify(value.wagerDenominationsCents) !== JSON.stringify(NEON_MINES_WAGERS_CENTS.map(Number))) throw new Error("Invalid Mines denominations");
  const difficulties = value.difficulties as Record<string, { mines?: unknown; maximumWagerCents?: unknown }> | undefined;
  if (typeof difficulties !== "object" || difficulties === null || Array.isArray(difficulties)
    || Object.keys(difficulties).some((name) => !Object.hasOwn(NEON_MINES_DIFFICULTIES, name))) throw new Error("Invalid Mines difficulties");
  for (const [name, rule] of Object.entries(NEON_MINES_DIFFICULTIES)) {
    if (typeof difficulties[name] !== "object" || difficulties[name] === null || Array.isArray(difficulties[name])
      || Object.keys(difficulties[name]).some((key) => key !== "mines" && key !== "maximumWagerCents")) throw new Error("Invalid Mines difficulty fields");
    if (difficulties?.[name]?.mines !== rule.mines || difficulties?.[name]?.maximumWagerCents !== Number(rule.maximumWagerCents)) throw new Error("Invalid Mines difficulty configuration");
  }
  return { returnBps: 9600, maximumMultiplierBps: 5_000_000, maximumPayoutCents: BigInt(value.maximumPayoutCents as number) };
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
