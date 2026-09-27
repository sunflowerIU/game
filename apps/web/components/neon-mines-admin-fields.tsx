import { coinsToCents, formatCents } from "../lib/money";

const denominations = [10, 25, 50, 100, 200, 500, 1_000, 2_000, 5_000];
const inputClass = "mt-2 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2.5 text-sm text-white";

export function minesConfigurationFromForm(configuration: Record<string, unknown>, form: FormData): Record<string, unknown> {
  return { ...configuration, maximumPayoutCents: coinsToCents(form.get("maximumPayout")) };
}

export function NeonMinesAdminFields({ configuration, minimumEntry, maximumEntry }: Readonly<{
  configuration: Record<string, unknown>; minimumEntry: string; maximumEntry: string;
}>) {
  return <>
    <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/5 p-3 text-xs leading-relaxed text-slate-300">
      <strong className="text-cyan-200">Fixed game rules</strong>
      <p>25 tiles · 96% theoretical RTP · 4% theoretical house edge · 500× multiplier ceiling.</p>
      <p>Easy: 3 mines / 50 coin max. Medium: 5 / 50. Hard: 10 / 20. Expert: 15 / 10.</p>
      <p>The house edge is a long-run expectation, not guaranteed profit. Payouts include the original wager.</p>
    </div>
    {([['minimumEntry', 'Minimum wager', minimumEntry], ['maximumEntry', 'Maximum wager', maximumEntry]] as const).map(([name, label, value]) =>
      <label className="block text-xs font-semibold text-slate-400" key={name}>{label} (coins)
        <select className={inputClass} name={name} defaultValue={formatCents(value)} required>
          {denominations.map((amount) => <option key={amount} value={formatCents(amount)}>{formatCents(amount)}</option>)}
        </select>
      </label>)}
    <label className="block text-xs font-semibold text-slate-400">Maximum gross payout (coins)
      <input className={inputClass} name="maximumPayout" type="number" min="0.25" max="500" step="0.01" defaultValue={formatCents(String(configuration.maximumPayoutCents))} required />
    </label>
    <p className="text-xs leading-relaxed text-slate-400">Limits must allow a wager on every difficulty and cover its first safe payout. New revisions apply only to new rounds; active rounds retain their original settings. Save changes here before changing availability.</p>
  </>;
}
