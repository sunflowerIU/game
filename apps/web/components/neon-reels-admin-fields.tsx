import { formatCents } from "../lib/money";

const symbols = ["LEMON", "CHERRY", "GEM", "BELL", "STAR", "SEVEN", "WILD", "SCATTER"] as const;
const lineSymbols = symbols.filter((symbol) => symbol !== "SCATTER");
const counts = [3, 4, 5] as const;
const inputClass = "mt-1 w-full min-w-16 rounded-lg border border-white/10 bg-slate-900 px-2 py-2 text-sm text-white";
const balancedWeights = { LEMON: 34, CHERRY: 27, GEM: 19, BELL: 12, STAR: 7, SEVEN: 3, WILD: 3, SCATTER: 4 };
const balancedPayouts = {
  LEMON: { 3: 2, 4: 2, 5: 5 }, CHERRY: { 3: 2, 4: 3, 5: 7 }, GEM: { 3: 2, 4: 5, 5: 10 }, BELL: { 3: 3, 4: 8, 5: 15 },
  STAR: { 3: 4, 4: 10, 5: 20 }, SEVEN: { 3: 6, 4: 15, 5: 30 }, WILD: { 3: 8, 4: 20, 5: 50 }
};
const balancedScatters = { 3: 2, 4: 5, 5: 12 };

export function reelsConfigurationFromForm(configuration: Record<string, unknown>, form: FormData): Record<string, unknown> {
  const weights = Object.fromEntries(symbols.map((symbol) => [symbol, formInteger(form, `weight.${symbol}`)]));
  const payouts = Object.fromEntries(lineSymbols.map((symbol) => [symbol, Object.fromEntries(counts.map((count) => [count, formPayout(form, `payout.${symbol}.${count}`)]))]));
  const scatterPayouts = Object.fromEntries(counts.map((count) => [count, formPayout(form, `scatter.${count}`)]));
  return { ...configuration, weights, payouts, scatterPayouts, maxWinMultiplier: formInteger(form, "maxWinMultiplier", 2) };
}

export function NeonReelsAdminFields({ configuration, minimumEntry, maximumEntry }: Readonly<{
  configuration: Record<string, unknown>; minimumEntry: string; maximumEntry: string;
}>) {
  const weights = record(configuration.weights);
  const payouts = record(configuration.payouts);
  const scatters = record(configuration.scatterPayouts);
  const balanced = isBalanced(configuration);
  return <>
    <div className={`rounded-lg border p-3 text-xs leading-relaxed text-slate-300 ${balanced ? "border-fuchsia-300/20 bg-fuchsia-300/5" : "border-amber-300/20 bg-amber-300/5"}`}>
      <strong className={balanced ? "text-fuchsia-200" : "text-amber-200"}>{balanced ? "Balanced medium-volatility profile" : "Custom unverified profile"}</strong>
      <p>{balanced ? "Approximately 31.2% hit frequency · 95.3% theoretical RTP · 4.7% house edge." : "This configuration does not match the verified balanced profile; its hit frequency and RTP are unknown."}</p>
      <p>{balanced ? "All configured wins return at least 2×." : "Run mathematical verification before activating it for production play."} Estimates require re-verification after changing any weight or payout.</p>
    </div>
    <div className="grid grid-cols-2 gap-3">
      <AdminNumber name="minimumEntry" label="Minimum wager (coins)" value={formatCents(minimumEntry)} min="0.01" step="0.01" />
      <AdminNumber name="maximumEntry" label="Maximum wager (coins)" value={formatCents(maximumEntry)} min="0.01" step="0.01" />
    </div>
    <section>
      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Symbol frequency weights</h4>
      <p className="mt-1 text-xs text-slate-500">Higher values make a symbol more common. Relative values matter, not their total.</p>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {symbols.map((symbol) => <AdminNumber key={symbol} name={`weight.${symbol}`} label={symbol} value={integerOrBlank(weights[symbol])} min="1" step="1" />)}
      </div>
    </section>
    <section>
      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Line payout multipliers</h4>
      <div className="mt-2 overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-left text-slate-500"><th className="py-1">Symbol</th>{counts.map((count) => <th className="px-1 py-1" key={count}>{count} match</th>)}</tr></thead><tbody>
        {lineSymbols.map((symbol) => { const symbolPayouts = record(payouts[symbol]); return <tr key={symbol}><th className="pr-2 text-left text-slate-400">{symbol}</th>{counts.map((count) => <td className="px-1" key={count}><input aria-label={`${symbol} ${count} match payout`} className={inputClass} name={`payout.${symbol}.${count}`} type="number" min="0" max="10000" step="1" defaultValue={integerOrBlank(symbolPayouts[String(count)])} required /></td>)}</tr>; })}
      </tbody></table></div>
    </section>
    <section>
      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Scatter and liability</h4>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {counts.map((count) => <AdminNumber key={count} name={`scatter.${count}`} label={`${count} scatters`} value={integerOrBlank(scatters[String(count)])} min="0" step="1" />)}
        <AdminNumber name="maxWinMultiplier" label="Maximum win ×" value={integerOrBlank(configuration.maxWinMultiplier)} min="2" step="1" />
      </div>
    </section>
    <p className="text-xs leading-relaxed text-amber-200/80">A revision applies immediately to new spins and is permanently audited. Verify RTP, hit frequency, volatility, and maximum liability before saving production changes.</p>
  </>;
}

function AdminNumber({ name, label, value, min, step }: Readonly<{ name: string; label: string; value: string | number; min: string; step: string }>) {
  return <label className="block text-xs font-semibold text-slate-400">{label}<input className={inputClass} name={name} type="number" min={min} max="10000" step={step} defaultValue={value} required /></label>;
}

function formInteger(form: FormData, name: string, minimum = 1): number {
  const value = Number(form.get(name));
  if (!Number.isSafeInteger(value) || value < minimum || value > 10_000) throw new Error(`${name} must be an integer from ${minimum} to 10000`);
  return value;
}
function formPayout(form: FormData, name: string): number { const value = formInteger(form, name, 0); if (value === 1) throw new Error(`${name} must be zero or at least 2×`); return value; }
function record(value: unknown): Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function integerOrBlank(value: unknown): number | "" { return typeof value === "number" && Number.isSafeInteger(value) ? value : ""; }
function isBalanced(configuration: Record<string, unknown>): boolean {
  const weights = record(configuration.weights); const payouts = record(configuration.payouts); const scatters = record(configuration.scatterPayouts);
  return configuration.maxWinMultiplier === 100
    && symbols.every((symbol) => weights[symbol] === balancedWeights[symbol])
    && lineSymbols.every((symbol) => { const actual = record(payouts[symbol]); return counts.every((count) => actual[String(count)] === balancedPayouts[symbol][count]); })
    && counts.every((count) => scatters[String(count)] === balancedScatters[count]);
}
