import { coinsToCents, formatCents } from "../lib/money";

const denominations = [10, 25, 50, 100, 200, 500, 1_000, 2_000, 5_000];
const inputClass = "mt-2 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2.5 text-sm text-white";

export function minesConfigurationFromForm(configuration: Record<string, unknown>, form: FormData): Record<string, unknown> {
  const current = difficultyConfiguration(configuration);
  return {
    boardTiles: 9,
    completionOnly: true,
    wagerDenominationsCents: denominations,
    difficulties: Object.fromEntries(Object.entries(current).map(([name, rule]) => [name, {
      mines: rule.mines,
      rewardMultiplier: positiveInteger(form.get(`${name.toLowerCase()}Reward`), `${name} reward multiplier`),
      maximumWagerCents: coinsToCents(form.get(`${name.toLowerCase()}Maximum`))
    }]))
  };
}

export function NeonMinesAdminFields({ configuration, minimumEntry, maximumEntry }: Readonly<{
  configuration: Record<string, unknown>; minimumEntry: string; maximumEntry: string;
}>) {
  return <>
    <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/5 p-3 text-xs leading-relaxed text-slate-300">
      <strong className="text-cyan-200">Completion-only rewards</strong>
      <p>The player must reveal every safe tile. A mine or a post-click exit loses the deposit.</p>
      <p>3×3 board. Easy: 2 mines / 2×. Medium: 3 / 3×. Hard: 4 / 4×.</p>
    </div>
    {([['minimumEntry', 'Minimum deposit', minimumEntry], ['maximumEntry', 'Global maximum deposit', maximumEntry]] as const).map(([name, label, value]) =>
      <label className="block text-xs font-semibold text-slate-400" key={name}>{label} (coins)
        <select className={inputClass} name={name} defaultValue={formatCents(value)} required>
          {denominations.map((amount) => <option key={amount} value={formatCents(amount)}>{formatCents(amount)}</option>)}
        </select>
      </label>)}
    <div className="grid grid-cols-2 gap-3">
      {Object.entries(difficultyConfiguration(configuration)).map(([name, rule]) => <div className="contents" key={name}>
        <label className="block text-xs font-semibold text-slate-400">{name[0]}{name.slice(1).toLowerCase()} maximum deposit (coins)
          <select className={inputClass} name={`${name.toLowerCase()}Maximum`} defaultValue={formatCents(String(rule.maximumWagerCents))} required>
            {denominations.filter((amount) => amount <= 2_000).map((amount) => <option key={amount} value={formatCents(amount)}>{formatCents(amount)}</option>)}
          </select>
        </label>
        <label className="block text-xs font-semibold text-slate-400">{name[0]}{name.slice(1).toLowerCase()} win multiplier
          <input className={inputClass} name={`${name.toLowerCase()}Reward`} type="number" min="1" max="100" step="1" defaultValue={rule.rewardMultiplier} required />
        </label>
      </div>)}
    </div>
    <p className="text-xs leading-relaxed text-slate-400">Difficulty deposit caps are enforced by the server. New revisions apply only to new rounds; active rounds retain their original settings.</p>
  </>;
}

function difficultyConfiguration(configuration: Record<string, unknown>) {
  const configured = configuration.difficulties as Record<string, { mines?: number; maximumWagerCents?: number; rewardMultiplier?: number }> | undefined;
  const defaults = { EASY: { mines: 2, maximumWagerCents: 1_000, rewardMultiplier: 2 }, MEDIUM: { mines: 3, maximumWagerCents: 2_000, rewardMultiplier: 3 }, HARD: { mines: 4, maximumWagerCents: 2_000, rewardMultiplier: 4 } };
  return Object.fromEntries(Object.entries(defaults).map(([name, rule]) => [name, {
    ...rule,
    maximumWagerCents: configured?.[name]?.maximumWagerCents ?? rule.maximumWagerCents,
    rewardMultiplier: configured?.[name]?.rewardMultiplier ?? rule.rewardMultiplier
  }])) as typeof defaults;
}

function positiveInteger(value: FormDataEntryValue | null, label: string): number {
  const parsed = typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) throw new Error(`${label} must be a whole number from 1 to 100`);
  return parsed;
}
