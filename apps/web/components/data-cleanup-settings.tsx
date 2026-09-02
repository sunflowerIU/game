"use client";

import type { InactivePlayerCleanupPreviewResponse, InactivePlayerCleanupResponse } from "@game-platform/contracts";
import { useRef, useState, type FormEvent } from "react";
import { ApiClientError, apiRequest } from "../lib/api-client";
import { formatCents } from "../lib/money";
import { useToast } from "./toast-provider";

interface DataCleanupSettingsProps {
  readonly canManageRetention: boolean;
  readonly onPlayersDeleted: () => Promise<void>;
}

interface DeleteAttempt {
  readonly idempotencyKey: string;
  readonly payload: {
    readonly inactivityDays: number;
    readonly includePositiveBalances: boolean;
    readonly batchSize: number;
    readonly reason: FormDataEntryValue | null;
  };
}

export function DataCleanupSettings({ canManageRetention, onPlayersDeleted }: DataCleanupSettingsProps) {
  const { showToast } = useToast();
  const [inactivityDays, setInactivityDays] = useState(30);
  const [includePositiveBalances, setIncludePositiveBalances] = useState(false);
  const [batchSize, setBatchSize] = useState(25);
  const [preview, setPreview] = useState<InactivePlayerCleanupPreviewResponse | null>(null);
  const [lastResult, setLastResult] = useState<InactivePlayerCleanupResponse | null>(null);
  const [pending, setPending] = useState(false);
  const deleteAttempt = useRef<DeleteAttempt | null>(null);

  function invalidatePreview() {
    setPreview(null);
    setLastResult(null);
    deleteAttempt.current = null;
  }

  async function requestPreview(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setPending(true);
    try {
      const result = await apiRequest<InactivePlayerCleanupPreviewResponse>("/api/v1/admin/players/inactive-deletion-preview", {
        method: "POST",
        body: JSON.stringify({ inactivityDays, includePositiveBalances })
      });
      setPreview(result);
      return result;
    } catch (caught: unknown) {
      showToast(errorMessage(caught), "error");
      return null;
    } finally {
      setPending(false);
    }
  }

  async function deleteBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview === null || preview.deletablePlayers === 0) return;
    const data = new FormData(event.currentTarget);
    const attempt = deleteAttempt.current ?? {
      idempotencyKey: crypto.randomUUID(),
      payload: {
        inactivityDays: preview.inactivityDays,
        includePositiveBalances: preview.includePositiveBalances,
        batchSize,
        reason: data.get("reason")
      }
    };
    deleteAttempt.current = attempt;
    setPending(true);
    try {
      const result = await apiRequest<InactivePlayerCleanupResponse>("/api/v1/admin/players/delete-inactive", {
        method: "POST",
        headers: { "idempotency-key": attempt.idempotencyKey },
        body: JSON.stringify(attempt.payload)
      });
      deleteAttempt.current = null;
      setLastResult(result);
      showToast(`${result.deletedPlayers.toLocaleString()} inactive player${result.deletedPlayers === 1 ? "" : "s"} and related data deleted.`, "success");
      const [dashboardRefresh, previewRefresh] = await Promise.allSettled([
        onPlayersDeleted(),
        apiRequest<InactivePlayerCleanupPreviewResponse>("/api/v1/admin/players/inactive-deletion-preview", {
          method: "POST",
          body: JSON.stringify({ inactivityDays: preview.inactivityDays, includePositiveBalances: preview.includePositiveBalances })
        })
      ]);
      if (previewRefresh.status === "fulfilled") setPreview(previewRefresh.value); else setPreview(null);
      if (dashboardRefresh.status === "rejected" || previewRefresh.status === "rejected") showToast("Deletion succeeded, but some dashboard totals could not be refreshed. Preview again before another batch.", "error");
    } catch (caught: unknown) {
      if (caught instanceof ApiClientError && caught.status >= 400 && caught.status < 500) deleteAttempt.current = null;
      showToast(errorMessage(caught), "error");
    } finally {
      setPending(false);
    }
  }

  if (!canManageRetention) {
    return <section className="rounded-2xl border border-white/10 bg-[#10151d] p-6"><h2 className="text-xl font-bold text-white">Data cleanup</h2><p className="mt-2 text-sm text-slate-500">Your administrator role does not include data-retention management.</p></section>;
  }

  return <div className="space-y-5">
    <div><h2 className="text-xl font-bold text-white">Data cleanup</h2><p className="mt-1 text-sm text-slate-500">Manually remove inactive player accounts in controlled batches. Per-player history cleanup remains available from Players → Manage.</p></div>

    <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#10151d]">
      <header className="border-b border-white/10 px-5 py-4"><h3 className="font-bold text-white">Delete inactive players</h3><p className="mt-1 text-xs text-slate-500">The account, wallet, sessions, gameplay history, and related logs are permanently removed.</p></header>
      <div className="p-5">
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <SafetyNote title="Active sessions protected">Players in active or created game sessions are always skipped.</SafetyNote>
          <SafetyNote title="Balances protected">Positive wallet balances are skipped unless you explicitly include them.</SafetyNote>
          <SafetyNote title="Never logged in">Account creation time is used when a player has never logged in.</SafetyNote>
        </div>

        <form className="grid items-end gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" onSubmit={(event) => void requestPreview(event)}>
          <NumberField label="Inactive for at least" suffix="days" value={inactivityDays} min={1} max={3650} onChange={(value) => { setInactivityDays(value); invalidatePreview(); }} />
          <label className="flex min-h-11 items-center gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-slate-300"><input className="size-4 accent-red-400" type="checkbox" checked={includePositiveBalances} onChange={(event) => { setIncludePositiveBalances(event.target.checked); invalidatePreview(); }} /><span>Include players with positive balances</span></label>
          <button className="rounded-lg bg-lime-300 px-5 py-3 text-sm font-bold text-slate-950 transition hover:bg-lime-200 disabled:opacity-50" disabled={pending}>{pending ? "Checking…" : "Preview deletion"}</button>
        </form>

        {preview && <div className="mt-6 space-y-5 border-t border-white/10 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-400">Accounts inactive on or before <strong className="text-slate-200">{new Date(preview.cutoffAt).toLocaleString()}</strong></p><span className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-slate-400">Preview only</span></div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <CleanupMetric label="Inactive accounts" value={preview.inactivePlayers.toLocaleString()} />
            <CleanupMetric label="Protected by active session" value={preview.activeSessionPlayers.toLocaleString()} />
            <CleanupMetric label="With positive balance" value={preview.positiveBalancePlayers.toLocaleString()} detail={`${formatCents(preview.positiveBalanceTotal)} coins total`} />
            <CleanupMetric label="Eligible to delete" value={preview.deletablePlayers.toLocaleString()} danger={preview.deletablePlayers > 0} />
          </div>

          {lastResult && <div className="rounded-xl border border-lime-300/20 bg-lime-300/5 p-4 text-sm text-slate-300"><strong className="text-lime-300">Last batch completed:</strong> {lastResult.deletedPlayers.toLocaleString()} players, {cleanupTotal(lastResult.deletedRecords).toLocaleString()} related records, and {formatCents(lastResult.deletedBalance)} coins removed. {lastResult.remainingPlayers.toLocaleString()} eligible players remained when the batch completed.</div>}

          {preview.deletablePlayers === 0 ? <p className="rounded-xl border border-white/10 p-4 text-center text-sm text-slate-500">No players currently match this deletion policy.</p> : <form className="space-y-4 rounded-xl border border-red-300/20 bg-red-300/5 p-4" onSubmit={deleteBatch}>
            <div><strong className="text-sm text-red-300">Permanent deletion</strong><p className="mt-1 text-xs text-red-100/70">This deletes up to the selected batch size. Preview again whenever you change the inactivity or balance policy.</p></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField label="Maximum players this batch" value={batchSize} min={1} max={100} onChange={setBatchSize} />
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">Cleanup reason<input className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-sm normal-case text-white outline-none focus:border-red-300/50" name="reason" minLength={3} defaultValue={`Delete players inactive for ${preview.inactivityDays} days`} required /></label>
            </div>
            <label className="flex items-start gap-3 text-sm text-red-100"><input className="mt-0.5 size-4 accent-red-400" type="checkbox" required /><span>I understand this permanently deletes eligible player accounts and all related data{preview.includePositiveBalances ? ", including positive wallet balances" : ""}.</span></label>
            <button className="w-full rounded-lg bg-red-400 px-4 py-3 text-sm font-bold text-white transition hover:bg-red-300 disabled:opacity-50" disabled={pending}>{pending ? "Deleting batch…" : `Delete up to ${Math.min(batchSize, preview.deletablePlayers).toLocaleString()} players`}</button>
          </form>}
        </div>}
      </div>
    </section>
  </div>;
}

function NumberField({ label, suffix, value, min, max, onChange }: Readonly<{ label: string; suffix?: string; value: number; min: number; max: number; onChange: (value: number) => void }>) {
  return <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">{label}<span className="relative mt-2 block"><input className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 pr-14 text-sm text-white outline-none focus:border-lime-300/50" type="number" min={min} max={max} step="1" value={value} onChange={(event) => onChange(Number(event.target.value))} required />{suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-normal normal-case text-slate-500">{suffix}</span>}</span></label>;
}

function SafetyNote({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
  return <div className="rounded-xl border border-white/10 bg-black/15 p-3"><strong className="block text-xs text-slate-200">{title}</strong><span className="mt-1 block text-xs leading-5 text-slate-500">{children}</span></div>;
}

function CleanupMetric({ label, value, detail, danger = false }: Readonly<{ label: string; value: string; detail?: string; danger?: boolean }>) {
  return <div className="rounded-xl border border-white/10 bg-black/15 p-4"><span className="block text-xs text-slate-500">{label}</span><strong className={`mt-2 block font-mono text-2xl ${danger ? "text-red-300" : "text-white"}`}>{value}</strong>{detail && <span className="mt-1 block text-xs text-slate-500">{detail}</span>}</div>;
}

function cleanupTotal(counts: InactivePlayerCleanupResponse["deletedRecords"]): number {
  return counts.authSessions + counts.loginEvents + counts.securityEvents + counts.ownedGameSessions + counts.gameParticipations + counts.gameResults + counts.ledgerEntries + counts.adminAuditLogs;
}

function errorMessage(error: unknown): string {
  return error instanceof ApiClientError || error instanceof Error ? error.message : "The cleanup operation could not be completed";
}
