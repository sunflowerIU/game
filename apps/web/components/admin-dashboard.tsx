"use client";

import type { AdminAuditListResponse, AdminAuditSummary, MeResponse, PlayerCleanupCounts, PlayerDeletionPreviewResponse, PlayerDeletionResponse, PlayerListResponse, PlayerRecordCleanupPreviewResponse, PlayerRecordCleanupResponse, PlayerSummary, WalletMutationResponse } from "@game-platform/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ApiClientError, apiRequest } from "../lib/api-client";
import { coinsToCents, formatCents } from "../lib/money";
import { DataCleanupSettings } from "./data-cleanup-settings";
import { PlatformOperations } from "./platform-operations";
import { pageItems, TablePagination } from "./table-pagination";
import { useToast } from "./toast-provider";

type AdminSection = "overview" | "players" | "games" | "sessions" | "security" | "audit" | "settings";
type PlayerModal = "create" | "manage" | "credit" | "debit" | "logs" | "walletLogs" | "accessLogs" | "deletePlayer" | "deleteRecords" | null;
interface PlayerGameLog { id: string; gameSlug: string; gameVersion: string; configurationRevision: number; status: string; entryAmount: string; score: number | null; reward: string | null; startedAt: string | null; completedAt: string | null }
interface PlayerDetailResponse { loginEvents: readonly { outcome: string; ipAddress: string; createdAt: string }[]; ledgerEntries: readonly { id: string; type: string; amount: string; balanceAfter: string; reason: string | null; createdAt: string }[]; gameSessions: readonly PlayerGameLog[] }
const PAGE_SIZE = 8;
const NAVIGATION: readonly { id: AdminSection; label: string; marker: string; description: string }[] = [
  { id: "overview", label: "Overview", marker: "OV", description: "Platform pulse" },
  { id: "players", label: "Players", marker: "PL", description: "Accounts & wallets" },
  { id: "games", label: "Games", marker: "GM", description: "Catalog & settings" },
  { id: "sessions", label: "Game sessions", marker: "SE", description: "Gameplay activity" },
  { id: "security", label: "Security", marker: "SC", description: "Risk monitoring" },
  { id: "audit", label: "Audit logs", marker: "AL", description: "Admin activity" },
  { id: "settings", label: "Settings", marker: "ST", description: "Cleanup & retention" },
];

export function AdminDashboard() {
  const router = useRouter();
  const { showToast } = useToast();
  const [section, setSection] = useState<AdminSection>("overview");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [players, setPlayers] = useState<readonly PlayerSummary[]>([]);
  const [auditLogs, setAuditLogs] = useState<readonly AdminAuditSummary[]>([]);
  const [playerPage, setPlayerPage] = useState(1);
  const [auditPage, setAuditPage] = useState(1);
  const [selected, setSelected] = useState<PlayerSummary | null>(null);
  const [playerModal, setPlayerModal] = useState<PlayerModal>(null);
  const [detail, setDetail] = useState<PlayerDetailResponse | null>(null);
  const [deletionPreview, setDeletionPreview] = useState<PlayerDeletionPreviewResponse | null>(null);
  const [recordCleanupPreview, setRecordCleanupPreview] = useState<PlayerRecordCleanupPreviewResponse | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pending, setPending] = useState(false);

  async function load() {
    try {
      const identity = await apiRequest<MeResponse>("/api/v1/me");
      if (identity.type !== "ADMIN") { router.replace("/"); return; }
      setMe(identity);
      const [result, audit] = await Promise.all([apiRequest<PlayerListResponse>("/api/v1/admin/players"), apiRequest<AdminAuditListResponse>("/api/v1/admin/audit-logs")]);
      setPlayers(result.players); setAuditLogs(audit.auditLogs);
    } catch (caught: unknown) {
      if (caught instanceof ApiClientError && caught.status === 401) router.replace("/"); else { showToast(errorMessage(caught), "error"); setLoadFailed(true); }
    }
  }

  useEffect(() => {
    let active = true;
    void apiRequest<MeResponse>("/api/v1/me").then(async (identity) => {
      if (!active) return;
      if (identity.type !== "ADMIN") { router.replace("/"); return; }
      setMe(identity);
      const [result, audit] = await Promise.all([apiRequest<PlayerListResponse>("/api/v1/admin/players"), apiRequest<AdminAuditListResponse>("/api/v1/admin/audit-logs")]);
      if (active) { setPlayers(result.players); setAuditLogs(audit.auditLogs); }
    }).catch((caught: unknown) => {
      if (!active) return;
      if (caught instanceof ApiClientError && caught.status === 401) router.replace("/"); else { showToast(errorMessage(caught), "error"); setLoadFailed(true); }
    });
    return () => { active = false; };
  }, [router, showToast]);

  useEffect(() => {
    if (selected === null || !["manage", "logs", "walletLogs", "accessLogs"].includes(playerModal ?? "")) return;
    void apiRequest<PlayerDetailResponse>(`/api/v1/admin/players/${selected.id}/details`).then(setDetail).catch((caught: unknown) => showToast(errorMessage(caught), "error"));
  }, [playerModal, selected, showToast]);

  async function createPlayer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const succeeded = await mutate(async () => { await apiRequest<PlayerSummary>("/api/v1/admin/players", { method: "POST", body: JSON.stringify({ username: data.get("username"), password: data.get("password"), reason: data.get("reason") }) }); form.reset(); showToast("Player created and audited.", "success"); });
    if (succeeded) setPlayerModal(null);
  }
  async function changeStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (selected === null) return; const data = new FormData(event.currentTarget);
    const succeeded = await mutate(async () => { await apiRequest<PlayerSummary>(`/api/v1/admin/players/${selected.id}/status`, { method: "POST", body: JSON.stringify({ enabled: selected.status === "DISABLED", reason: data.get("reason") }) }); showToast(`Player ${selected.status === "ACTIVE" ? "disabled" : "enabled"}.`, "success"); });
    if (succeeded) setPlayerModal(null);
  }
  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (selected === null) return; const form = event.currentTarget; const data = new FormData(form);
    const succeeded = await mutate(async () => { await apiRequest<void>(`/api/v1/admin/players/${selected.id}/password`, { method: "POST", body: JSON.stringify({ password: data.get("password"), reason: data.get("reason") }) }); form.reset(); showToast("Password reset; active sessions revoked.", "success"); });
    if (succeeded) setPlayerModal(null);
  }
  async function adjustWallet(event: FormEvent<HTMLFormElement>, operation: "credit" | "debit") {
    event.preventDefault(); if (selected === null) return; const form = event.currentTarget; const data = new FormData(form);
    const succeeded = await mutate(async () => { await apiRequest<WalletMutationResponse>(`/api/v1/admin/players/${selected.id}/wallet/${operation}`, { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ amount: coinsToCents(data.get("amount")), reason: data.get("reason") }) }); form.reset(); showToast(`Wallet ${operation === "credit" ? "credited" : "debited"} and audited.`, "success"); });
    if (succeeded) setPlayerModal(null);
  }
  async function deletePlayer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (selected === null) return; const data = new FormData(event.currentTarget);
    const succeeded = await mutate(async () => {
      const result = await apiRequest<PlayerDeletionResponse>(`/api/v1/admin/players/${selected.id}/delete`, {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ confirmationUsername: data.get("confirmationUsername"), allowPositiveBalance: data.get("allowPositiveBalance") === "on", reason: data.get("reason") })
      });
      showToast(`${result.username} and ${cleanupTotal(result.counts).toLocaleString()} related records were deleted.`, "success");
    });
    if (succeeded) { setPlayerModal(null); setSelected(null); setDeletionPreview(null); }
  }
  async function previewPlayerRecords(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (selected === null) return; const data = new FormData(event.currentTarget);
    setPending(true);
    try {
      const preview = await apiRequest<PlayerRecordCleanupPreviewResponse>(`/api/v1/admin/players/${selected.id}/records/deletion-preview`, { method: "POST", body: JSON.stringify({ retentionDays: Number(data.get("retentionDays")) }) });
      setRecordCleanupPreview(preview);
    } catch (caught: unknown) { showToast(errorMessage(caught), "error"); } finally { setPending(false); }
  }
  async function deletePlayerRecords(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (selected === null || recordCleanupPreview === null) return; const data = new FormData(event.currentTarget);
    const succeeded = await mutate(async () => {
      const result = await apiRequest<PlayerRecordCleanupResponse>(`/api/v1/admin/players/${selected.id}/records/delete`, {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ retentionDays: recordCleanupPreview.retentionDays, reason: data.get("reason") })
      });
      showToast(`${cleanupTotal(result.counts).toLocaleString()} old records deleted; player and wallet retained.`, "success");
    });
    if (succeeded) { setPlayerModal(null); setSelected(null); setRecordCleanupPreview(null); }
  }
  function openPlayerModal(modal: Exclude<PlayerModal, null>, player?: PlayerSummary) {
    setDetail(null); setDeletionPreview(null); setRecordCleanupPreview(null); setSelected(player ?? null); setPlayerModal(modal);
    if (modal === "deletePlayer" && player !== undefined) {
      setPending(true);
      void apiRequest<PlayerDeletionPreviewResponse>(`/api/v1/admin/players/${player.id}/deletion-preview`, { method: "POST" })
        .then(setDeletionPreview)
        .catch((caught: unknown) => showToast(errorMessage(caught), "error"))
        .finally(() => setPending(false));
    }
  }
  async function mutate(operation: () => Promise<void>) { setPending(true); try { await operation(); await load(); return true; } catch (caught: unknown) { showToast(errorMessage(caught), "error"); return false; } finally { setPending(false); } }
  async function logout() { try { await apiRequest<void>("/api/v1/auth/logout", { method: "POST" }); router.replace("/"); } catch (caught: unknown) { showToast(errorMessage(caught), "error"); } }

  if (me === null && !loadFailed) return <main className="grid min-h-screen place-items-center bg-[#080b10] text-slate-400">Loading administrator workspace…</main>;
  const currentLabel = NAVIGATION.find((item) => item.id === section)?.label ?? "Overview";

  return <main className="min-h-screen bg-[#080b10] text-slate-200">
    <div className="mx-auto flex min-h-screen max-w-[1680px]">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-white/[0.07] bg-[#0b0f15] p-4 lg:flex">
        <div className="flex items-center gap-3 px-2 py-4"><div className="grid size-10 place-items-center rounded-xl bg-lime-300 font-black text-slate-950">GP</div><div><p className="font-black tracking-tight text-white">GameOps</p><p className="text-xs text-slate-500">Control center</p></div></div>
        <nav className="mt-6 space-y-1" aria-label="Admin features">{NAVIGATION.map((item) => <NavButton key={item.id} item={item} active={section === item.id} onClick={() => setSection(item.id)} />)}</nav>
        <div className="mt-auto rounded-xl border border-white/[0.07] bg-white/[0.025] p-3"><p className="truncate text-sm font-semibold text-white">{me?.username}</p><p className="mt-1 text-xs text-slate-500">Administrator</p><button className="mt-3 w-full rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/5" onClick={() => void logout()}>Log out</button></div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-[#080b10]/90 px-4 py-4 backdrop-blur sm:px-6 xl:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-lime-300">Administration</p><h1 className="mt-1 text-2xl font-black text-white">{currentLabel}</h1></div><div className="flex items-center gap-3 lg:hidden"><span className="hidden text-sm text-slate-400 sm:block">{me?.username}</span><button className="rounded-lg border border-white/10 px-3 py-2 text-xs" onClick={() => void logout()}>Log out</button></div></div>
          <div className="mt-4 overflow-x-auto lg:hidden"><nav className="flex min-w-max gap-2 pb-1" aria-label="Admin features">{NAVIGATION.map((item) => <button key={item.id} className={`rounded-lg px-3 py-2 text-xs font-semibold ${section === item.id ? "bg-lime-300 text-slate-950" : "border border-white/10 text-slate-400"}`} onClick={() => setSection(item.id)}>{item.label}</button>)}</nav></div>
        </header>

        <div className="p-4 sm:p-6 xl:p-8">
          {section === "overview" && <Overview players={players} auditLogs={auditLogs} />}
          {section === "players" && <PlayersView players={players} page={playerPage} onPageChange={setPlayerPage} selected={selected} modal={playerModal} detail={detail} deletionPreview={deletionPreview} recordCleanupPreview={recordCleanupPreview} canDeletePlayer={me?.permissions.includes("PLAYER_DELETE") ?? false} canManageRetention={me?.permissions.includes("DATA_RETENTION_MANAGE") ?? false} pending={pending} onOpen={openPlayerModal} onClose={() => { if (!pending) setPlayerModal(null); }} onCreate={createPlayer} onStatus={changeStatus} onPassword={resetPassword} onWallet={adjustWallet} onDeletePlayer={deletePlayer} onPreviewRecords={previewPlayerRecords} onDeleteRecords={deletePlayerRecords} />}
          {(section === "games" || section === "sessions" || section === "security") && <PlatformOperations section={section} />}
          {section === "audit" && <AuditView logs={auditLogs} page={auditPage} onPageChange={setAuditPage} />}
          {section === "settings" && <DataCleanupSettings canManageRetention={me?.permissions.includes("DATA_RETENTION_MANAGE") ?? false} onPlayersDeleted={load} />}
        </div>
      </div>
    </div>
  </main>;
}

function Overview({ players, auditLogs }: Readonly<{ players: readonly PlayerSummary[]; auditLogs: readonly AdminAuditSummary[] }>) {
  const totalBalance = players.reduce((sum, player) => sum + BigInt(player.balance), 0n);
  return <div className="space-y-5"><div><h2 className="text-xl font-bold text-white">Platform at a glance</h2><p className="mt-1 text-sm text-slate-500">Live operational totals from the current admin dataset.</p></div><div className="grid gap-4 sm:grid-cols-3"><Metric label="Player accounts" value={players.length.toLocaleString()} detail={`${players.filter((player) => player.status === "ACTIVE").length} active`} /><Metric label="Wallet balance" value={formatCents(totalBalance)} detail="Coins across players" /><Metric label="Admin actions" value={auditLogs.length.toLocaleString()} detail="Recent audit records" /></div><PlatformOperations section="overview" /></div>;
}

interface PlayersViewProps {
  players: readonly PlayerSummary[];
  page: number;
  onPageChange: (page: number) => void;
  selected: PlayerSummary | null;
  modal: PlayerModal;
  detail: PlayerDetailResponse | null;
  deletionPreview: PlayerDeletionPreviewResponse | null;
  recordCleanupPreview: PlayerRecordCleanupPreviewResponse | null;
  canDeletePlayer: boolean;
  canManageRetention: boolean;
  pending: boolean;
  onOpen: (modal: Exclude<PlayerModal, null>, player?: PlayerSummary) => void;
  onClose: () => void;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onStatus: (event: FormEvent<HTMLFormElement>) => void;
  onPassword: (event: FormEvent<HTMLFormElement>) => void;
  onWallet: (event: FormEvent<HTMLFormElement>, operation: "credit" | "debit") => void;
  onDeletePlayer: (event: FormEvent<HTMLFormElement>) => void;
  onPreviewRecords: (event: FormEvent<HTMLFormElement>) => void;
  onDeleteRecords: (event: FormEvent<HTMLFormElement>) => void;
}

function PlayersView(props: Readonly<PlayersViewProps>) {
  const [logPage, setLogPage] = useState(1);
  const [accessLogPage, setAccessLogPage] = useState(1);
  const [walletLogPage, setWalletLogPage] = useState(1);
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredPlayers = normalizedSearch.length === 0 ? props.players : props.players.filter((player) => player.username.toLocaleLowerCase().includes(normalizedSearch));
  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-xl font-bold text-white">Player accounts</h2><p className="mt-1 text-sm text-slate-500">Create accounts and manage access or wallet funds.</p></div><div className="flex w-full flex-wrap gap-3 sm:w-auto"><label className="relative min-w-0 flex-1 sm:w-72 sm:flex-none"><span className="sr-only">Search players by username</span><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-slate-500">S</span><input className="w-full rounded-lg border border-white/10 bg-[#10151d] py-2.5 pl-9 pr-9 text-sm text-white outline-none placeholder:text-slate-600 focus:border-lime-300/50" type="search" value={search} placeholder="Search username…" onChange={(event) => { setSearch(event.target.value); props.onPageChange(1); }} />{search.length > 0 && <button aria-label="Clear player search" className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-slate-500 hover:bg-white/5 hover:text-white" type="button" onClick={() => { setSearch(""); props.onPageChange(1); }}>×</button>}</label><button className="rounded-lg bg-lime-300 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-lime-200" onClick={() => props.onOpen("create")}>Create player</button></div></div>
    <DataTable title="All players" subtitle={normalizedSearch.length > 0 ? `${filteredPlayers.length} matching player${filteredPlayers.length === 1 ? "" : "s"}` : "Identity, account state and wallet balance"} headers={["Username", "Status", "Balance", "Last login", "Created", "Actions"]} pagination={<TablePagination page={props.page} pageSize={PAGE_SIZE} totalItems={filteredPlayers.length} onPageChange={props.onPageChange} />}>
      {pageItems(filteredPlayers, props.page, PAGE_SIZE).map((player) => <tr className="border-t border-white/[0.06]" key={player.id}><Cell><strong className="text-slate-100">{player.username}</strong></Cell><Cell><Status status={player.status} /></Cell><Cell><span className="font-mono text-lime-300">{formatCents(player.balance)}</span></Cell><Cell>{player.lastLoginAt === null ? <span className="text-slate-600">Never</span> : new Date(player.lastLoginAt).toLocaleString()}</Cell><Cell>{new Date(player.createdAt).toLocaleDateString()}</Cell><Cell><div className="flex flex-wrap gap-2"><ActionButton onClick={() => props.onOpen("manage", player)}>Manage</ActionButton><ActionButton onClick={() => { setAccessLogPage(1); props.onOpen("accessLogs", player); }}>Access logs</ActionButton><ActionButton onClick={() => { setLogPage(1); props.onOpen("logs", player); }}>Game logs</ActionButton><ActionButton onClick={() => { setWalletLogPage(1); props.onOpen("walletLogs", player); }}>Wallet logs</ActionButton><ActionButton onClick={() => props.onOpen("credit", player)} tone="positive">Credit</ActionButton><ActionButton onClick={() => props.onOpen("debit", player)} tone="danger">Debit</ActionButton></div></Cell></tr>)}
      {filteredPlayers.length === 0 && <tr className="border-t border-white/[0.06]"><td className="px-5 py-14 text-center text-sm text-slate-500" colSpan={6}>No players match “{search.trim()}”.</td></tr>}
    </DataTable>

    {props.modal === "create" && <Modal title="Create player" subtitle="Add a new player account" onClose={props.onClose} pending={props.pending}><form className="space-y-4" onSubmit={props.onCreate}><Input name="username" label="Username" /><Input name="password" label="Initial password" type="password" minLength={8} /><Input name="reason" label="Audit reason" defaultValue="Player account created by administrator" /><Submit pending={props.pending}>Create player</Submit></form></Modal>}
    {props.modal === "manage" && props.selected && <Modal title={`Manage ${props.selected.username}`} subtitle="Account access and credentials" onClose={props.onClose} pending={props.pending}><div className="rounded-xl border border-white/10 bg-black/15 p-3"><div className="flex items-center justify-between"><Status status={props.selected.status} /><span className="font-mono text-sm text-lime-300">{formatCents(props.selected.balance)} coins</span></div>{props.detail && <p className="mt-3 text-xs text-slate-500">{props.detail.loginEvents.length} logins · {props.detail.ledgerEntries.length} ledger entries · {props.detail.gameSessions.length} sessions</p>}</div><form className="mt-5 space-y-4" onSubmit={props.onStatus}><Input name="reason" label={`${props.selected.status === "ACTIVE" ? "Disable" : "Enable"} reason`} defaultValue={`Player account ${props.selected.status === "ACTIVE" ? "disabled" : "enabled"} by administrator`} /><Submit pending={props.pending}>{props.selected.status === "ACTIVE" ? "Disable player" : "Enable player"}</Submit></form><div className="my-5 border-t border-white/10" /><form className="space-y-4" onSubmit={props.onPassword}><Input name="password" label="New password" type="password" minLength={8} /><Input name="reason" label="Reset reason" defaultValue="Password reset by administrator" /><Submit pending={props.pending}>Reset password</Submit></form>{(props.canDeletePlayer || props.canManageRetention) && <div className="mt-6 border-t border-red-300/15 pt-5"><h3 className="text-sm font-bold text-red-300">Data cleanup</h3><p className="mt-1 text-xs text-slate-500">Preview every affected record before making an irreversible change.</p><div className="mt-3 flex flex-wrap gap-2">{props.canManageRetention && <ActionButton tone="danger" onClick={() => props.onOpen("deleteRecords", props.selected ?? undefined)}>Delete old records</ActionButton>}{props.canDeletePlayer && <ActionButton tone="danger" onClick={() => props.onOpen("deletePlayer", props.selected ?? undefined)}>Delete player permanently</ActionButton>}</div></div>}</Modal>}
    {props.modal === "credit" && props.selected && <WalletModal operation="credit" player={props.selected} pending={props.pending} onClose={props.onClose} onSubmit={props.onWallet} />}
    {props.modal === "debit" && props.selected && <WalletModal operation="debit" player={props.selected} pending={props.pending} onClose={props.onClose} onSubmit={props.onWallet} />}
    {props.modal === "accessLogs" && props.selected && <AccessLogsModal player={props.selected} detail={props.detail} page={accessLogPage} onPageChange={setAccessLogPage} pending={props.pending} onClose={props.onClose} />}
    {props.modal === "logs" && props.selected && <Modal title={`${props.selected.username} game logs`} subtitle="Recent sessions, stakes and outcomes" onClose={props.onClose} pending={props.pending} wide>{props.detail === null ? <div className="grid min-h-48 place-items-center text-sm text-slate-500">Loading game logs…</div> : props.detail.gameSessions.length === 0 ? <div className="grid min-h-48 place-items-center rounded-xl border border-dashed border-white/10 text-sm text-slate-500">No game sessions recorded for this player.</div> : <div className="overflow-hidden rounded-xl border border-white/10"><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-black/15 text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-3">Game</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Entry</th><th className="px-4 py-3">Result</th><th className="px-4 py-3">Started</th><th className="px-4 py-3">Completed</th></tr></thead><tbody>{pageItems(props.detail.gameSessions, logPage, PAGE_SIZE).map((log) => <tr className="border-t border-white/[0.06]" key={log.id}><td className="px-4 py-3"><strong className="text-slate-100">{log.gameSlug}</strong><small className="block text-slate-500">v{log.gameVersion} · r{log.configurationRevision}</small></td><td className="px-4 py-3"><GameLogStatus status={log.status} /></td><td className="px-4 py-3 font-mono text-slate-300">{formatCents(log.entryAmount)}</td><td className="px-4 py-3 text-slate-400">{log.score === null ? "—" : `${log.score} score · ${formatCents(log.reward ?? "0")} reward`}</td><td className="px-4 py-3 text-slate-500">{log.startedAt ? new Date(log.startedAt).toLocaleString() : "—"}</td><td className="px-4 py-3 text-slate-500">{log.completedAt ? new Date(log.completedAt).toLocaleString() : "—"}</td></tr>)}</tbody></table></div><TablePagination page={logPage} pageSize={PAGE_SIZE} totalItems={props.detail.gameSessions.length} onPageChange={setLogPage} /></div>}</Modal>}
    {props.modal === "walletLogs" && props.selected && <WalletLogsModal player={props.selected} detail={props.detail} page={walletLogPage} onPageChange={setWalletLogPage} pending={props.pending} onClose={props.onClose} />}
    {props.modal === "deletePlayer" && props.selected && <DeletePlayerModal player={props.selected} preview={props.deletionPreview} pending={props.pending} onClose={props.onClose} onSubmit={props.onDeletePlayer} />}
    {props.modal === "deleteRecords" && props.selected && <DeleteRecordsModal player={props.selected} preview={props.recordCleanupPreview} pending={props.pending} onClose={props.onClose} onPreview={props.onPreviewRecords} onDelete={props.onDeleteRecords} />}
  </div>;
}

function AccessLogsModal({ player, detail, page, onPageChange, pending, onClose }: Readonly<{ player: PlayerSummary; detail: PlayerDetailResponse | null; page: number; onPageChange: (page: number) => void; pending: boolean; onClose: () => void }>) {
  return <Modal title={`${player.username} access logs`} subtitle={`Login and logout activity · Last login ${player.lastLoginAt === null ? "never" : new Date(player.lastLoginAt).toLocaleString()}`} onClose={onClose} pending={pending} wide>{detail === null ? <div className="grid min-h-48 place-items-center text-sm text-slate-500">Loading access logs…</div> : detail.loginEvents.length === 0 ? <div className="grid min-h-48 place-items-center rounded-xl border border-dashed border-white/10 text-sm text-slate-500">No login or logout activity recorded for this player.</div> : <div className="overflow-hidden rounded-xl border border-white/10"><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-black/15 text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-3">Activity</th><th className="px-4 py-3">IP address</th><th className="px-4 py-3">Time</th></tr></thead><tbody>{pageItems(detail.loginEvents, page, PAGE_SIZE).map((entry, index) => { const logout = entry.outcome === "LOGOUT"; return <tr className="border-t border-white/[0.06]" key={`${entry.createdAt}-${entry.outcome}-${index}`}><td className="px-4 py-3"><span className={`rounded-full border px-2 py-1 text-[11px] font-bold ${logout ? "border-amber-300/20 bg-amber-300/10 text-amber-300" : entry.outcome === "SUCCESS" ? "border-lime-300/20 bg-lime-300/10 text-lime-300" : "border-red-300/20 bg-red-300/10 text-red-300"}`}>{logout ? "LOGOUT" : entry.outcome === "SUCCESS" ? "LOGIN" : entry.outcome.replaceAll("_", " ")}</span></td><td className="px-4 py-3 font-mono text-slate-300">{entry.ipAddress}</td><td className="px-4 py-3 text-slate-500">{new Date(entry.createdAt).toLocaleString()}</td></tr>; })}</tbody></table></div><TablePagination page={page} pageSize={PAGE_SIZE} totalItems={detail.loginEvents.length} onPageChange={onPageChange} /></div>}</Modal>;
}

function DeletePlayerModal({ player, preview, pending, onClose, onSubmit }: Readonly<{ player: PlayerSummary; preview: PlayerDeletionPreviewResponse | null; pending: boolean; onClose: () => void; onSubmit: PlayersViewProps["onDeletePlayer"] }>) {
  return <Modal title={`Delete ${player.username}`} subtitle="Permanently remove this player and every related record" onClose={onClose} pending={pending}>
    {preview === null ? <div className="grid min-h-40 place-items-center text-sm text-slate-500">Calculating deletion impact…</div> : <div className="space-y-5">
      <div className="rounded-xl border border-red-300/20 bg-red-300/5 p-4 text-sm text-red-100"><strong className="block text-red-300">This cannot be undone.</strong><span className="mt-1 block">The account, wallet, balance, sessions, game history, and logs will be removed.</span></div>
      {preview.activeGameSessions > 0 && <p className="rounded-lg border border-amber-300/20 bg-amber-300/5 p-3 text-xs text-amber-200">{preview.activeGameSessions} active game session{preview.activeGameSessions === 1 ? "" : "s"} will be terminated.</p>}
      <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/15 p-3"><span className="text-xs text-slate-500">Wallet balance to delete</span><strong className="font-mono text-red-300">{formatCents(preview.balance)} coins</strong></div>
      <CleanupCounts counts={preview.counts} />
      <form className="space-y-4" onSubmit={onSubmit}>
        <Input name="confirmationUsername" label={`Type ${preview.username} to confirm`} />
        {BigInt(preview.balance) > 0n && <label className="flex items-start gap-3 rounded-lg border border-red-300/20 bg-red-300/5 p-3 text-sm text-red-100"><input className="mt-0.5 size-4 accent-red-400" name="allowPositiveBalance" type="checkbox" required /><span>I understand that {formatCents(preview.balance)} coins will be permanently removed.</span></label>}
        <Input name="reason" label="Deletion reason" defaultValue="Player and related data permanently deleted by administrator" />
        <Submit pending={pending} tone="danger">Delete player and all data</Submit>
      </form>
    </div>}
  </Modal>;
}

function DeleteRecordsModal({ player, preview, pending, onClose, onPreview, onDelete }: Readonly<{ player: PlayerSummary; preview: PlayerRecordCleanupPreviewResponse | null; pending: boolean; onClose: () => void; onPreview: PlayersViewProps["onPreviewRecords"]; onDelete: PlayersViewProps["onDeleteRecords"] }>) {
  const total = preview === null ? 0 : cleanupTotal(preview.counts);
  return <Modal title={`Clean up ${player.username}`} subtitle="Delete historical records while retaining the player and wallet" onClose={onClose} pending={pending}>
    <div className="rounded-xl border border-lime-300/15 bg-lime-300/5 p-4 text-sm text-slate-300"><strong className="text-lime-300">Preserved:</strong> account, login access, current wallet balance, active sessions, and newer records.</div>
    <form className="mt-5 space-y-4" onSubmit={onPreview}>
      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">Delete records older than days<input className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-lime-300/50" name="retentionDays" type="number" min="1" max="3650" step="1" defaultValue={preview?.retentionDays ?? 30} required /></label>
      <Submit pending={pending}>Preview records</Submit>
    </form>
    {preview && <div className="mt-5 space-y-4 border-t border-white/10 pt-5">
      <p className="text-xs text-slate-400">Cutoff: <strong className="text-slate-200">{new Date(preview.cutoffAt).toLocaleString()}</strong>. Records at or before this time are included.</p>
      <CleanupCounts counts={preview.counts} />
      {total === 0 ? <p className="rounded-lg border border-white/10 p-3 text-center text-sm text-slate-500">No eligible records were found.</p> : <form className="space-y-4" onSubmit={onDelete}><Input name="reason" label="Cleanup reason" defaultValue={`Delete player records older than ${preview.retentionDays} days`} /><Submit pending={pending} tone="danger">Delete {total.toLocaleString()} old records</Submit></form>}
    </div>}
  </Modal>;
}

function CleanupCounts({ counts }: Readonly<{ counts: PlayerCleanupCounts }>) {
  const rows: readonly [string, number][] = [["Auth sessions", counts.authSessions], ["Login events", counts.loginEvents], ["Security events", counts.securityEvents], ["Game sessions", counts.ownedGameSessions], ["Participations", counts.gameParticipations], ["Game results", counts.gameResults], ["Wallet ledger", counts.ledgerEntries], ["Admin audit", counts.adminAuditLogs]];
  return <div className="grid grid-cols-2 gap-2">{rows.map(([label, value]) => <div className="rounded-lg border border-white/10 bg-black/15 px-3 py-2" key={label}><span className="block text-[11px] text-slate-500">{label}</span><strong className="font-mono text-sm text-slate-200">{value.toLocaleString()}</strong></div>)}</div>;
}

function WalletModal({ operation, player, pending, onClose, onSubmit }: Readonly<{ operation: "credit" | "debit"; player: PlayerSummary; pending: boolean; onClose: () => void; onSubmit: PlayersViewProps["onWallet"] }>) { const isCredit = operation === "credit"; return <Modal title={`${isCredit ? "Credit" : "Debit"} wallet`} subtitle={`${player.username} · Current balance ${formatCents(player.balance)}`} onClose={onClose} pending={pending}><div className={`mb-5 rounded-xl border p-4 text-sm ${isCredit ? "border-lime-300/20 bg-lime-300/5 text-lime-100" : "border-red-300/20 bg-red-300/5 text-red-100"}`}>{isCredit ? "Coins will be added to this player's wallet." : "Coins will be removed from this player's wallet."}</div><form className="space-y-4" onSubmit={(event) => onSubmit(event, operation)}><CoinInput /><Input name="reason" label={`${isCredit ? "Credit" : "Debit"} reason`} defaultValue={`Wallet ${isCredit ? "credited" : "debited"} by administrator`} /><Submit pending={pending}>{isCredit ? "Credit wallet" : "Debit wallet"}</Submit></form></Modal>; }

function WalletLogsModal({ player, detail, page, onPageChange, pending, onClose }: Readonly<{ player: PlayerSummary; detail: PlayerDetailResponse | null; page: number; onPageChange: (page: number) => void; pending: boolean; onClose: () => void }>) {
  const adjustments = detail?.ledgerEntries.filter((entry) => entry.type === "ADMIN_DEPOSIT" || entry.type === "ADMIN_DEBIT") ?? [];
  return <Modal title={`${player.username} wallet logs`} subtitle={`Credit and debit history · Current balance ${formatCents(player.balance)}`} onClose={onClose} pending={pending} wide>{detail === null ? <div className="grid min-h-48 place-items-center text-sm text-slate-500">Loading wallet logs…</div> : adjustments.length === 0 ? <div className="grid min-h-48 place-items-center rounded-xl border border-dashed border-white/10 text-sm text-slate-500">No administrator credits or debits recorded for this player.</div> : <div className="overflow-hidden rounded-xl border border-white/10"><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-black/15 text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-3">Operation</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Balance after</th><th className="px-4 py-3">Reason</th><th className="px-4 py-3">Time</th></tr></thead><tbody>{pageItems(adjustments, page, PAGE_SIZE).map((entry) => { const credit = entry.type === "ADMIN_DEPOSIT"; return <tr className="border-t border-white/[0.06]" key={entry.id}><td className="px-4 py-3"><span className={`rounded-full border px-2 py-1 text-[11px] font-bold ${credit ? "border-lime-300/20 bg-lime-300/10 text-lime-300" : "border-red-300/20 bg-red-300/10 text-red-300"}`}>{credit ? "CREDIT" : "DEBIT"}</span></td><td className={`px-4 py-3 font-mono font-bold ${credit ? "text-lime-300" : "text-red-300"}`}>{credit ? "+" : "−"}{formatCents(entry.amount.replace("-", ""))}</td><td className="px-4 py-3 font-mono text-slate-300">{formatCents(entry.balanceAfter)}</td><td className="max-w-xs px-4 py-3 text-slate-400">{entry.reason ?? "—"}</td><td className="px-4 py-3 text-slate-500">{new Date(entry.createdAt).toLocaleString()}</td></tr>; })}</tbody></table></div><TablePagination page={page} pageSize={PAGE_SIZE} totalItems={adjustments.length} onPageChange={onPageChange} /></div>}</Modal>;
}

function AuditView({ logs, page, onPageChange }: Readonly<{ logs: readonly AdminAuditSummary[]; page: number; onPageChange: (page: number) => void }>) { return <DataTable title="Administrative audit log" subtitle="Traceable changes made by platform operators" headers={["Action", "Target", "Amount", "Administrator", "Reason", "Time"]} pagination={<TablePagination page={page} pageSize={PAGE_SIZE} totalItems={logs.length} onPageChange={onPageChange} />}>{pageItems(logs, page, PAGE_SIZE).map((record) => <tr className="border-t border-white/[0.06]" key={record.id}><Cell><span className="font-mono text-xs text-lime-300">{record.action}</span></Cell><Cell><strong className="text-slate-200">{record.targetLabel}</strong><small className="block text-slate-500">{record.targetType}</small></Cell><Cell>{record.amount === null ? "—" : <span className={`font-mono font-bold ${record.action === "WALLET_DEBITED" ? "text-red-300" : "text-lime-300"}`}>{record.action === "WALLET_DEBITED" ? "−" : "+"}{formatCents(record.amount)}</span>}</Cell><Cell>{record.adminUsername}</Cell><Cell><span className="block max-w-xs">{record.reason}</span></Cell><Cell>{new Date(record.createdAt).toLocaleString()}</Cell></tr>)}</DataTable>; }

function NavButton({ item, active, onClick }: Readonly<{ item: (typeof NAVIGATION)[number]; active: boolean; onClick: () => void }>) { return <button className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${active ? "bg-lime-300 text-slate-950" : "text-slate-400 hover:bg-white/[0.04] hover:text-white"}`} onClick={onClick}><span className={`grid size-8 place-items-center rounded-lg text-[10px] font-black ${active ? "bg-slate-950/10" : "bg-white/[0.05]"}`}>{item.marker}</span><span><span className="block text-sm font-bold">{item.label}</span><span className={`block text-[11px] ${active ? "text-slate-800" : "text-slate-600"}`}>{item.description}</span></span></button>; }
function Modal({ title, subtitle, pending, onClose, children, wide = false }: Readonly<{ title: string; subtitle: string; pending: boolean; onClose: () => void; children: React.ReactNode; wide?: boolean }>) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) { if (event.key === "Escape" && !pending) onClose(); }
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKeyDown); };
  }, [onClose, pending]);
  return <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}><section className={`my-auto w-full rounded-2xl border border-white/10 bg-[#111720] shadow-2xl shadow-black/50 ${wide ? "max-w-5xl" : "max-w-md"}`} role="dialog" aria-modal="true" aria-labelledby="player-modal-title"><header className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4"><div><h2 className="text-lg font-bold text-white" id="player-modal-title">{title}</h2><p className="mt-1 text-xs text-slate-500">{subtitle}</p></div><button aria-label="Close modal" className="grid size-8 place-items-center rounded-lg border border-white/10 text-lg text-slate-400 transition hover:bg-white/5 hover:text-white disabled:opacity-40" disabled={pending} onClick={onClose}>×</button></header><div className="p-5">{children}</div></section></div>;
}
function ActionButton({ children, onClick, tone = "default" }: Readonly<{ children: React.ReactNode; onClick: () => void; tone?: "default" | "positive" | "danger" }>) { const styles = tone === "positive" ? "border-lime-300/20 text-lime-300 hover:bg-lime-300/10" : tone === "danger" ? "border-red-300/20 text-red-300 hover:bg-red-300/10" : "border-white/10 text-slate-300 hover:bg-white/5"; return <button className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${styles}`} type="button" onClick={onClick}>{children}</button>; }
function Metric({ label, value, detail }: Readonly<{ label: string; value: string; detail: string }>) { return <div className="rounded-2xl border border-white/10 bg-[#10151d] p-5"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p><p className="mt-3 text-3xl font-black text-white">{value}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div>; }
function DataTable({ title, subtitle, headers, children, pagination }: Readonly<{ title: string; subtitle: string; headers: readonly string[]; children: React.ReactNode; pagination: React.ReactNode }>) { return <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#10151d]"><div className="border-b border-white/10 px-5 py-4"><h2 className="font-bold text-white">{title}</h2><p className="mt-1 text-xs text-slate-500">{subtitle}</p></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-black/10 text-xs uppercase tracking-wider text-slate-500"><tr>{headers.map((header, index) => <th className="px-5 py-3" key={`${header}-${index}`}>{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div>{pagination}</section>; }
function Cell({ children }: Readonly<{ children: React.ReactNode }>) { return <td className="px-5 py-4 text-slate-400">{children}</td>; }
function Input({ label, name, type = "text", minLength = 3, defaultValue }: Readonly<{ label: string; name: string; type?: string; minLength?: number; defaultValue?: string }>) { return <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">{label}<input className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-lime-300/50" minLength={minLength} name={name} type={type} defaultValue={defaultValue} required /></label>; }
function CoinInput() { return <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">Coins<input className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-lime-300/50" name="amount" type="number" min="0.01" max="10000000" step="0.01" inputMode="decimal" required /></label>; }
function Submit({ children, pending, tone = "default" }: Readonly<{ children: React.ReactNode; pending: boolean; tone?: "default" | "danger" }>) { return <button className={`w-full rounded-lg px-3 py-2.5 text-sm font-bold transition disabled:opacity-50 ${tone === "danger" ? "bg-red-400 text-white hover:bg-red-300" : "bg-lime-300 text-slate-950 hover:bg-lime-200"}`} disabled={pending}>{pending ? "Working…" : children}</button>; }
function Status({ status }: Readonly<{ status: PlayerSummary["status"] }>) { return <span className={`rounded-full border px-2 py-1 text-xs font-bold ${status === "ACTIVE" ? "border-lime-300/20 bg-lime-300/10 text-lime-300" : "border-red-400/20 bg-red-400/10 text-red-300"}`}>{status}</span>; }
function GameLogStatus({ status }: Readonly<{ status: string }>) { const completed = status === "COMPLETED"; const failed = status === "FAILED" || status === "CANCELLED"; return <span className={`rounded-full border px-2 py-1 text-[11px] font-bold ${completed ? "border-lime-300/20 bg-lime-300/10 text-lime-300" : failed ? "border-red-300/20 bg-red-300/10 text-red-300" : "border-amber-300/20 bg-amber-300/10 text-amber-300"}`}>{status}</span>; }
function errorMessage(error: unknown) { return error instanceof ApiClientError || error instanceof Error ? error.message : "The operation could not be completed"; }
function cleanupTotal(counts: PlayerCleanupCounts): number { return counts.authSessions + counts.loginEvents + counts.securityEvents + counts.ownedGameSessions + counts.gameParticipations + counts.gameResults + counts.ledgerEntries + counts.adminAuditLogs; }
