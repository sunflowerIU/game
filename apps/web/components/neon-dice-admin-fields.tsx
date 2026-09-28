"use client";

import { useState } from "react";
import { coinsToCents, formatCents } from "../lib/money";

const supportedDenominations = [50, 100, 200, 500, 1_000, 2_000, 3_000] as const;
const inputClass = "mt-2 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2.5 text-sm text-white";

export function diceConfigurationFromForm(configuration: Record<string, unknown>, form: FormData): Record<string, unknown> {
  const wagerDenominationsCents = form.getAll("wagerDenomination").map((value) => Number(value)).sort((left, right) => left - right);
  if (wagerDenominationsCents.length === 0 || wagerDenominationsCents.some((value, index) => !supportedDenominations.includes(value as typeof supportedDenominations[number]) || value === wagerDenominationsCents[index - 1])) {
    throw new Error("Choose at least one supported Dice wager");
  }
  return { ...configuration, wagerDenominationsCents, maximumPayoutCents: coinsToCents(form.get("maximumPayout")) };
}

export function NeonDiceAdminFields({ configuration }: Readonly<{ configuration: Record<string, unknown> }>) {
  const configured = Array.isArray(configuration.wagerDenominationsCents)
    ? configuration.wagerDenominationsCents.filter((amount): amount is number => typeof amount === "number" && supportedDenominations.includes(amount as typeof supportedDenominations[number]))
    : [];
  const [selected, setSelected] = useState<readonly number[]>(configured.length > 0 ? configured : supportedDenominations);
  const minimum = selected[0] ?? supportedDenominations[0];
  const maximum = selected.at(-1) ?? supportedDenominations[0];
  const requiredPayout = maximum * 57_000 / 10_000;

  function toggle(amount: number) {
    setSelected((current) => current.includes(amount)
      ? current.length === 1 ? current : current.filter((candidate) => candidate !== amount)
      : [...current, amount].sort((left, right) => left - right));
  }

  return <>
    <div className="rounded-lg border border-violet-300/20 bg-gradient-to-br from-cyan-300/5 to-fuchsia-300/5 p-3 text-xs leading-relaxed text-slate-300">
      <strong className="text-cyan-200">Verified fixed-odds profile</strong>
      <p>95% theoretical RTP · 5% theoretical house edge · two independent six-sided dice.</p>
      <p>Under 7: 15/36 at 2.28× · Exactly 7: 6/36 at 5.70× · Over 7: 15/36 at 2.28×.</p>
      <p>Payouts include the original wager. Odds and multipliers are locked for version 1.</p>
    </div>

    <section>
      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Available wagers</h4>
      <p className="mt-1 text-xs text-slate-500">Choose the coin buttons players may use. At least one must remain enabled.</p>
      <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-7" role="group" aria-label="Enabled Dice wagers">
        {supportedDenominations.map((amount) => {
          const active = selected.includes(amount);
          return <label className={`cursor-pointer rounded-lg border px-2 py-2.5 text-center text-xs font-bold transition ${active ? "border-cyan-300/50 bg-cyan-300/10 text-cyan-100 shadow-sm shadow-cyan-400/10" : "border-white/10 bg-black/10 text-slate-500"}`} key={amount}>
            <input className="sr-only" type="checkbox" name="wagerDenomination" value={amount} checked={active} onChange={() => toggle(amount)} />
            {compactCoins(amount)}
          </label>;
        })}
      </div>
      <input type="hidden" name="minimumEntry" value={formatCents(minimum)} />
      <input type="hidden" name="maximumEntry" value={formatCents(maximum)} />
      <p className="mt-2 text-xs text-slate-400">Player range: <strong className="text-white">{formatCents(minimum)}–{formatCents(maximum)} coins</strong></p>
    </section>

    <label className="block text-xs font-semibold text-slate-400">Maximum gross payout reserve (coins)
      <input className={inputClass} name="maximumPayout" type="number" min={formatCents(requiredPayout)} max="200" step="0.01" defaultValue={formatCents(String(configuration.maximumPayoutCents ?? 20_000))} required />
    </label>
    <p className="text-xs leading-relaxed text-slate-400">The current wager set needs at least <strong className="text-fuchsia-200">{formatCents(requiredPayout)} coins</strong> to cover an Exactly 7 win at the largest wager. The hard game limit is 200 coins.</p>
    <p className="text-xs leading-relaxed text-amber-200/80">Saving creates an immutable audited revision for new rolls. Existing completed rolls always retain their original settings.</p>
  </>;
}

function compactCoins(cents: number): string {
  const formatted = formatCents(cents);
  return formatted.endsWith(".00") ? formatted.slice(0, -3) : formatted;
}
