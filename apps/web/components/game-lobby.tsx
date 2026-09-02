"use client";

import type { GameCatalogResponse, MeResponse, WalletResponse } from "@game-platform/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiClientError, apiRequest } from "../lib/api-client";
import { formatCents } from "../lib/money";
import { useToast } from "./toast-provider";

export function GameLobby() {
  const router = useRouter();
  const { showToast } = useToast();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [balance, setBalance] = useState<string>("—");
  const [games, setGames] = useState<GameCatalogResponse["games"]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([apiRequest<MeResponse>("/api/v1/me"), apiRequest<WalletResponse>("/api/v1/wallet"), apiRequest<GameCatalogResponse>("/api/v1/games")])
      .then(([identity, wallet, catalog]) => {
        if (!active) return;
        if (identity.type !== "PLAYER") { void apiRequest<void>("/api/v1/auth/logout", { method: "POST" }); router.replace("/login"); return; }
        setMe(identity); setBalance(wallet.wallet.balance); setGames(catalog.games); setLoaded(true);
      }).catch((caught: unknown) => {
        if (!active) return;
        if (caught instanceof ApiClientError && caught.status === 401) router.replace("/login");
        else { showToast(caught instanceof ApiClientError ? caught.message : "Unable to load games", "error"); setLoaded(true); }
      });
    return () => { active = false; };
  }, [router, showToast]);

  async function logout() { try { await apiRequest<void>("/api/v1/auth/logout", { method: "POST" }); router.replace("/login"); } catch (caught: unknown) { showToast(caught instanceof ApiClientError ? caught.message : "Unable to log out", "error"); } }
  if (!loaded) return <main className="grid min-h-screen place-items-center text-slate-400">Loading game registry…</main>;

  return <main className="min-h-screen px-5 py-8 sm:px-10"><div className="mx-auto max-w-6xl">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-6"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-lime-300">Game lobby</p><h1 className="mt-2 text-3xl font-black text-white">Welcome, {me?.username}</h1></div><div className="flex items-center gap-4"><Link className="rounded-xl border border-lime-300/20 bg-lime-300/[0.06] px-4 py-2 font-mono text-sm text-lime-300" href="/wallet">{balance === "—" ? balance : formatCents(balance)} coins</Link><button className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300 hover:bg-white/5" onClick={() => void logout()}>Log out</button></div></header>
    <section className="py-12"><div><p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Available now</p><h2 className="mt-2 text-4xl font-black text-white">Choose a game</h2></div>
      {games.length === 0 ? <div className="mt-10 rounded-3xl border border-dashed border-white/15 p-12 text-center"><p className="text-lg font-bold text-slate-300">No active game versions yet.</p></div> : <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">{games.map((game) => <article className="rounded-3xl border border-white/10 bg-white/[0.035] p-6" key={`${game.slug}@${game.version}`}><p className="font-mono text-xs text-lime-300">{game.slug}@{game.version}</p><h3 className="mt-4 text-2xl font-black text-white">{game.name}</h3><p className="mt-3 text-sm text-slate-400">Entry range: {formatCents(game.minimumEntry)}–{game.maximumEntry === "0" ? "∞" : formatCents(game.maximumEntry)} coins</p><p className="mt-6 text-xs font-bold uppercase tracking-wider text-slate-500">{game.gameType.replace("_", " ")}</p><Link className="mt-6 block rounded-xl bg-lime-300 px-4 py-3 text-center text-sm font-black text-slate-950" href={`/games/${game.id}`}>Play</Link></article>)}</div>}
    </section>
  </div></main>;
}
