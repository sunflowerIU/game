"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiClientError, apiRequest } from "../lib/api-client";
import { coinsToCents, formatCents } from "../lib/money";
import { pageItems, TablePagination } from "./table-pagination";
import { useToast } from "./toast-provider";
import { NeonMinesAdminFields, minesConfigurationFromForm } from "./neon-mines-admin-fields";

interface AdminGame { id: string; slug: string; name: string; status: "ACTIVE" | "DISABLED" | "MAINTENANCE" | "DEPRECATED"; version: string; configurationRevision: number; minimumEntry: string; maximumEntry: string; configuration: Record<string, unknown> }
interface AdminSession { id: string; username: string; gameSlug: string; status: string; entryAmount: string; score: number | null; reward: string | null; configurationRevision: number; startedAt: string | null }
interface SecurityEvent { id: string; type: string; severity: string; username: string | null; gameSessionId: string | null; ipAddress: string; createdAt: string }
type OperationsSection = "overview" | "games" | "sessions" | "security";
const PAGE_SIZE = 8;

export function PlatformOperations({ section }: Readonly<{ section: OperationsSection }>) {
  const { showToast } = useToast();
  const [games, setGames] = useState<readonly AdminGame[]>([]);
  const [sessions, setSessions] = useState<readonly AdminSession[]>([]);
  const [events, setEvents] = useState<readonly SecurityEvent[]>([]);
  const [selected, setSelected] = useState<AdminGame | null>(null);
  const [gamePage, setGamePage] = useState(1);
  const [sessionPage, setSessionPage] = useState(1);
  const [eventPage, setEventPage] = useState(1);
  const [pending, setPending] = useState(false);
  const mutationInFlight = useRef(false);

  async function load() {
    const [gameData, sessionData, eventData] = await Promise.all([
      apiRequest<{ games: AdminGame[] }>("/api/v1/admin/games"),
      apiRequest<{ sessions: AdminSession[] }>("/api/v1/admin/game-sessions"),
      apiRequest<{ events: SecurityEvent[] }>("/api/v1/admin/security-events"),
    ]);
    setGames(gameData.games); setSessions(sessionData.sessions); setEvents(eventData.events);
    setSelected((current) => current === null ? null : gameData.games.find((game) => game.id === current.id) ?? null);
  }

  useEffect(() => {
    let active = true;
    void Promise.all([
      apiRequest<{ games: AdminGame[] }>("/api/v1/admin/games"),
      apiRequest<{ sessions: AdminSession[] }>("/api/v1/admin/game-sessions"),
      apiRequest<{ events: SecurityEvent[] }>("/api/v1/admin/security-events"),
    ]).then(([gameData, sessionData, eventData]) => {
      if (!active) return;
      setGames(gameData.games); setSessions(sessionData.sessions); setEvents(eventData.events);
    }).catch((caught: unknown) => { if (active) showToast(errorText(caught), "error"); });
    return () => { active = false; };
  }, [showToast]);

  async function mutate(operation: () => Promise<void>) {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setPending(true);
    try { await operation(); await load(); } catch (caught: unknown) { showToast(errorText(caught), "error"); } finally { mutationInFlight.current = false; setPending(false); }
  }
  async function status(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (selected === null) return;
    const data = new FormData(event.currentTarget);
    if (selected.slug === "neon-mines" && data.get("status") === "ACTIVE" && selected.status !== "ACTIVE"
      && !window.confirm("Enable Neon Mines for new wagers using the saved configuration? Confirm that launch checks are complete and the payout reserve is ready.")) return;
    await mutate(async () => { await apiRequest(`/api/v1/admin/games/${selected.id}/status`, { method: "POST", body: JSON.stringify({ status: data.get("status"), reason: data.get("reason") }) }); showToast("Game status changed and audited.", "success"); });
  }
  async function configuration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (selected === null) return;
    const data = new FormData(event.currentTarget);
    await mutate(async () => {
      let parsed: Record<string, unknown>;
      if (selected.slug === "neon-mines") parsed = minesConfigurationFromForm(selected.configuration, data);
      else {
        try { parsed = JSON.parse(String(data.get("configuration"))) as Record<string, unknown>; } catch { throw new Error("Configuration must be valid JSON"); }
      }
      await apiRequest(`/api/v1/admin/games/${selected.id}/configuration`, { method: "POST", body: JSON.stringify({ minimumEntry: String(coinsToCents(data.get("minimumEntry"))), maximumEntry: String(coinsToCents(data.get("maximumEntry"))), configuration: parsed, reason: data.get("reason") }) });
      showToast("A new immutable configuration revision was activated.", "success");
    });
  }

  if (section === "overview") return <div className="grid gap-4 sm:grid-cols-3">
    <Metric label="Games online" value={games.filter((game) => game.status === "ACTIVE").length} detail={`${games.length} configured`} />
    <Metric label="Recent sessions" value={sessions.length} detail={`${sessions.filter((session) => session.status === "COMPLETED").length} completed`} />
    <Metric label="Security events" value={events.length} detail={`${events.filter((event) => event.severity === "HIGH" || event.severity === "CRITICAL").length} high priority`} tone="warning" />
  </div>;

  return <div className="space-y-5">
    {section === "games" && <>
      <DataTable title="Game catalog" subtitle="Availability, releases and entry limits" headers={["Game", "Status", "Version", "Entry", ""]} pagination={<TablePagination page={gamePage} pageSize={PAGE_SIZE} totalItems={games.length} onPageChange={setGamePage} />}>
        {pageItems(games, gamePage, PAGE_SIZE).map((game) => <tr className="border-t border-white/[0.06]" key={game.id}><Cell><strong className="text-slate-100">{game.name}</strong><small className="block text-slate-500">{game.slug}</small></Cell><Cell><Badge value={game.status} /></Cell><Cell>{game.version} · r{game.configurationRevision}</Cell><Cell>{formatCents(game.minimumEntry)}–{game.maximumEntry === "0" ? "∞" : formatCents(game.maximumEntry)}</Cell><Cell><button className="font-semibold text-lime-300 hover:text-lime-200" onClick={() => setSelected(game)}>Manage</button></Cell></tr>)}
      </DataTable>
      {selected && <GameEditor key={`${selected.id}:${selected.configurationRevision}:${selected.status}`} game={selected} pending={pending} onClose={() => { if (!pending) setSelected(null); }} onStatus={status} onConfiguration={configuration} />}
    </>}
    {section === "sessions" && <DataTable title="Game sessions" subtitle="Recent gameplay and settlement results" headers={["Player", "Game", "Status", "Entry", "Result", "Started"]} pagination={<TablePagination page={sessionPage} pageSize={PAGE_SIZE} totalItems={sessions.length} onPageChange={setSessionPage} />}>
      {pageItems(sessions, sessionPage, PAGE_SIZE).map((session) => <tr className="border-t border-white/[0.06]" key={session.id}><Cell><strong className="text-slate-100">{session.username}</strong></Cell><Cell>{session.gameSlug} · r{session.configurationRevision}</Cell><Cell><Badge value={session.status} /></Cell><Cell>{formatCents(session.entryAmount)}</Cell><Cell>{session.score === null ? "—" : `${session.score} / ${formatCents(session.reward ?? "0")}`}</Cell><Cell>{session.startedAt ? new Date(session.startedAt).toLocaleString() : "—"}</Cell></tr>)}
    </DataTable>}
    {section === "security" && <DataTable title="Security events" subtitle="Signals requiring operational review" headers={["Severity", "Type", "Player", "Session", "IP", "Time"]} pagination={<TablePagination page={eventPage} pageSize={PAGE_SIZE} totalItems={events.length} onPageChange={setEventPage} />}>
      {pageItems(events, eventPage, PAGE_SIZE).map((event) => <tr className="border-t border-white/[0.06]" key={event.id}><Cell><Badge value={event.severity} /></Cell><Cell><span className="font-mono text-xs text-slate-200">{event.type}</span></Cell><Cell>{event.username ?? "anonymous"}</Cell><Cell>{event.gameSessionId?.slice(0, 8) ?? "—"}</Cell><Cell>{event.ipAddress}</Cell><Cell>{new Date(event.createdAt).toLocaleString()}</Cell></tr>)}
    </DataTable>}
  </div>;
}

function GameEditor({ game, pending, onClose, onStatus, onConfiguration }: Readonly<{ game: AdminGame; pending: boolean; onClose: () => void; onStatus: (event: FormEvent<HTMLFormElement>) => void; onConfiguration: (event: FormEvent<HTMLFormElement>) => void }>) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) { if (event.key === "Escape" && !pending) onClose(); }
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKeyDown); };
  }, [onClose, pending]);

  return <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}><section className="my-auto w-full max-w-3xl rounded-2xl border border-white/10 bg-[#111720] shadow-2xl shadow-black/50" role="dialog" aria-modal="true" aria-labelledby="game-modal-title"><header className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-lime-300">Game controls</p><h2 className="mt-1 text-xl font-bold text-white" id="game-modal-title">Manage {game.name}</h2><p className="mt-1 text-xs text-slate-500">{game.slug} · {game.version} · revision {game.configurationRevision}</p></div><button aria-label="Close modal" className="grid size-8 place-items-center rounded-lg border border-white/10 text-lg text-slate-400 transition hover:bg-white/5 hover:text-white disabled:opacity-40" disabled={pending} onClick={onClose}>×</button></header><div className="grid gap-6 p-5 md:grid-cols-2"><section><h3 className="font-bold text-white">Availability</h3><p className="mt-1 text-xs text-slate-500">Control whether players can launch this game.</p><form className="mt-5 space-y-4" onSubmit={onStatus}><Select name="status" value={game.status} /><Field name="reason" label="Status reason" value="Game status updated by administrator" /><Submit pending={pending}>Change status</Submit></form></section><section className="border-t border-white/10 pt-6 md:border-l md:border-t-0 md:pl-6 md:pt-0"><h3 className="font-bold text-white">Configuration</h3><p className="mt-1 text-xs text-slate-500">Create a new immutable settings revision.</p><form className="mt-5 space-y-4" onSubmit={onConfiguration}>{game.slug === "neon-mines" ? <NeonMinesAdminFields configuration={game.configuration} minimumEntry={game.minimumEntry} maximumEntry={game.maximumEntry} /> : <><Field name="minimumEntry" label="Minimum entry (coins)" value={formatCents(game.minimumEntry)} /><Field name="maximumEntry" label="Maximum entry (0 = unlimited)" value={formatCents(game.maximumEntry)} /><label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">Configuration JSON<textarea className="mt-2 h-36 w-full rounded-lg border border-white/10 bg-black/20 p-3 font-mono text-xs text-white outline-none focus:border-lime-300/50" name="configuration" defaultValue={JSON.stringify(game.configuration, null, 2)} required /></label></>}<Field name="reason" label="Configuration reason" value="Game configuration updated by administrator" /><Submit pending={pending}>Create revision</Submit></form></section></div></section></div>;
}
function Metric({ label, value, detail, tone = "default" }: Readonly<{ label: string; value: number; detail: string; tone?: "default" | "warning" }>) { return <div className="rounded-2xl border border-white/10 bg-[#10151d] p-5"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p><p className={`mt-3 text-3xl font-black ${tone === "warning" ? "text-amber-300" : "text-white"}`}>{value}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div>; }
function DataTable({ title, subtitle, headers, children, pagination }: Readonly<{ title: string; subtitle: string; headers: readonly string[]; children: React.ReactNode; pagination: React.ReactNode }>) { return <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#10151d]"><div className="border-b border-white/10 px-5 py-4"><h2 className="font-bold text-white">{title}</h2><p className="mt-1 text-xs text-slate-500">{subtitle}</p></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-black/10 text-xs uppercase tracking-wider text-slate-500"><tr>{headers.map((header, index) => <th className="px-5 py-3" key={`${header}-${index}`}>{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div>{pagination}</section>; }
function Cell({ children }: Readonly<{ children: React.ReactNode }>) { return <td className="px-5 py-4 text-slate-400">{children}</td>; }
function Badge({ value }: Readonly<{ value: string }>) { const good = value === "ACTIVE" || value === "COMPLETED" || value === "LOW"; const bad = value === "DISABLED" || value === "FAILED" || value === "HIGH" || value === "CRITICAL"; return <span className={`rounded-full border px-2 py-1 text-[11px] font-bold ${good ? "border-lime-300/20 bg-lime-300/10 text-lime-300" : bad ? "border-red-300/20 bg-red-300/10 text-red-300" : "border-amber-300/20 bg-amber-300/10 text-amber-300"}`}>{value}</span>; }
function Field({ name, label, value }: Readonly<{ name: string; label: string; value?: string }>) { return <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">{label}<input className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-lime-300/50" name={name} defaultValue={value} minLength={name === "reason" ? 3 : undefined} required /></label>; }
function Select({ name, value }: Readonly<{ name: string; value: string }>) { return <select className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2.5 text-sm text-white" name={name} defaultValue={value}>{["ACTIVE", "DISABLED", "MAINTENANCE", "DEPRECATED"].map((status) => <option key={status}>{status}</option>)}</select>; }
function Submit({ pending, children }: Readonly<{ pending: boolean; children: React.ReactNode }>) { return <button className="w-full rounded-lg bg-lime-300 px-3 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-lime-200 disabled:opacity-50" disabled={pending}>{pending ? "Working…" : children}</button>; }
function errorText(error: unknown) { return error instanceof ApiClientError || error instanceof Error ? error.message : "The operation could not be completed"; }
