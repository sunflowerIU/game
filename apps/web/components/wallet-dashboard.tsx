"use client";

import type { MeResponse, WalletHistoryResponse, WalletResponse } from "@game-platform/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ApiClientError, apiRequest } from "../lib/api-client";
import { formatCents } from "../lib/money";
import { useToast } from "./toast-provider";

export function WalletDashboard() {
  const router = useRouter();
  const { showToast } = useToast();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [wallet, setWallet] = useState<WalletResponse["wallet"] | null>(null);
  const [history, setHistory] = useState<WalletHistoryResponse["entries"]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([
      apiRequest<MeResponse>("/api/v1/me"),
      apiRequest<WalletResponse>("/api/v1/wallet"),
      apiRequest<WalletHistoryResponse>("/api/v1/wallet/transactions")
    ]).then(([identity, walletResult, historyResult]) => {
      if (!active) return;
      if (identity.type !== "PLAYER") { void apiRequest<void>("/api/v1/auth/logout", { method: "POST" }); router.replace("/login"); return; }
      setMe(identity); setWallet(walletResult.wallet); setHistory(historyResult.entries); setLoaded(true);
    }).catch((caught: unknown) => {
      if (!active) return;
      if (caught instanceof ApiClientError && caught.status === 401) router.replace("/login");
      else { showToast(caught instanceof ApiClientError ? caught.message : "Unable to load wallet", "error"); setLoaded(true); }
    });
    return () => { active = false; };
  }, [router, showToast]);

  async function logout() { try { await apiRequest<void>("/api/v1/auth/logout", { method: "POST" }); router.replace("/login"); } catch (caught: unknown) { showToast(caught instanceof ApiClientError ? caught.message : "Unable to log out", "error"); } }
  if (!loaded) return <main className="grid min-h-screen place-items-center text-slate-400">Loading wallet…</main>;

  return <main className="min-h-screen px-5 py-8 sm:px-10"><div className="mx-auto max-w-5xl">
    <header className="flex items-center justify-between border-b border-white/10 pb-6"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-lime-300">Player wallet</p><h1 className="mt-2 text-3xl font-black text-white">{me?.username}</h1></div><div className="flex items-center gap-3"><Link className="text-sm font-semibold text-lime-300" href="/games">Games</Link><button className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300 hover:bg-white/5" onClick={() => void logout()}>Log out</button></div></header>
    {wallet !== null && <>
      <section className="mt-8 rounded-3xl border border-lime-300/20 bg-lime-300/[0.06] p-8"><p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Available coins</p><p className="mt-3 font-mono text-5xl font-black text-lime-300">{formatCents(wallet.balance)}</p><p className="mt-4 text-xs text-slate-500">Ledger version {wallet.version}</p></section>
      <section className="mt-8 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]"><div className="border-b border-white/10 px-5 py-4"><h2 className="font-bold text-white">Transaction history</h2></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">Type</th><th className="px-5 py-3">Amount</th><th className="px-5 py-3">Balance</th><th className="px-5 py-3">Time</th></tr></thead><tbody>{history.map((entry) => <tr className="border-t border-white/5" key={entry.id}><td className="px-5 py-4 font-mono text-xs text-slate-300">{entry.type}</td><td className={`px-5 py-4 font-mono ${entry.amount.startsWith("-") ? "text-red-300" : "text-lime-300"}`}>{entry.amount.startsWith("-") ? `-${formatCents(entry.amount.slice(1))}` : `+${formatCents(entry.amount)}`}</td><td className="px-5 py-4 font-mono text-slate-300">{formatCents(entry.balanceAfter)}</td><td className="px-5 py-4 text-slate-500">{new Date(entry.createdAt).toLocaleString()}</td></tr>)}</tbody></table>{history.length === 0 && <p className="px-5 py-8 text-sm text-slate-500">No transactions yet.</p>}</div></section>
    </>}
  </div></main>;
}
