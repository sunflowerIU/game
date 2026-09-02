"use client";

import type { ActiveGameSessionResponse, GameCatalogResponse, LoginResponse, MeResponse, StartGameSessionResponse, WalletResponse, WalletSummary, WalletUpdateEvent } from "@game-platform/contracts";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ApiClientError, apiRequest, apiUrl } from "../lib/api-client";
import { useGameAudio } from "../lib/game-audio";
import { coinsToCents, formatCents } from "../lib/money";
import { useToast } from "./toast-provider";
import type { NeonReelsCanvasState } from "./neon-reels-canvas";

type View = "boot" | "login" | "lobby" | "play";
type CatalogGame = GameCatalogResponse["games"][number];
type PlayerDialog = "settings" | "password" | "logout" | null;
type SlotState = NeonReelsCanvasState;
const SPIN_ANIMATION_MILLISECONDS = 1_350;
const LazyNeonReelsCanvas = dynamic(() => import("./neon-reels-canvas").then((module) => module.NeonReelsCanvas), { ssr: false, loading: () => <div className="slot-canvas slot-canvas-loading">LOADING REELS…</div> });

export function PlayerGameApp() {
  const { showToast } = useToast();
  const [view, setView] = useState<View>("boot");
  const { muted, play: playSound, toggleMuted } = useGameAudio(view === "lobby" || view === "play");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [balance, setBalance] = useState("0");
  const [games, setGames] = useState<readonly CatalogGame[]>([]);
  const [selectedGame, setSelectedGame] = useState<CatalogGame | null>(null);
  const [active, setActive] = useState<StartGameSessionResponse | null>(null);
  const [dialog, setDialog] = useState<PlayerDialog>(null);
  const [pending, setPending] = useState(false);
  const walletAccountId = useRef<string | null>(null);
  const walletVersion = useRef(-1);

  const applyWallet = useCallback((wallet: WalletSummary) => {
    if (walletAccountId.current !== wallet.accountId) {
      walletAccountId.current = wallet.accountId;
      walletVersion.current = -1;
    }
    if (wallet.version < walletVersion.current) return;
    walletVersion.current = wallet.version;
    setBalance(wallet.balance);
  }, []);

  const refreshBalance = useCallback(async () => {
    const result = await apiRequest<WalletResponse>("/api/v1/wallet");
    applyWallet(result.wallet);
  }, [applyWallet]);

  const loadPlayer = useCallback(async () => {
    const [identity, wallet, catalog, activeSession] = await Promise.all([
      apiRequest<MeResponse>("/api/v1/me"),
      apiRequest<WalletResponse>("/api/v1/wallet"),
      apiRequest<GameCatalogResponse>("/api/v1/games"),
      apiRequest<ActiveGameSessionResponse>("/api/v1/game-sessions/active")
    ]);
    if (identity.type !== "PLAYER") {
      await apiRequest<void>("/api/v1/auth/logout", { method: "POST" });
      throw new ApiClientError("PLAYER_REQUIRED", "Use a player account to enter the arcade.", 403);
    }
    setMe(identity); applyWallet(wallet.wallet); setGames(catalog.games);
    if (activeSession.active !== null) {
      const game = catalog.games.find((candidate) => candidate.id === activeSession.active?.session.gameId) ?? null;
      setSelectedGame(game); setActive(activeSession.active); setView("play");
    } else setView("lobby");
  }, [applyWallet]);

  useEffect(() => {
    if (me === null) return;
    const events = new EventSource(apiUrl("/api/v1/wallet/events"), { withCredentials: true });
    const onWallet = (message: MessageEvent<string>) => {
      try {
        const event = JSON.parse(message.data) as WalletUpdateEvent;
        if (event.type === "wallet.updated" && event.wallet.accountId === me.id) applyWallet(event.wallet);
      } catch {
        // A malformed event is ignored; the focus and interval refreshes recover state.
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshBalance().catch(() => undefined);
    };
    events.addEventListener("wallet", onWallet as EventListener);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    const fallback = window.setInterval(refreshWhenVisible, 30_000);
    return () => {
      events.close();
      events.removeEventListener("wallet", onWallet as EventListener);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.clearInterval(fallback);
    };
  }, [applyWallet, me, refreshBalance]);

  useEffect(() => {
    let mounted = true;
    const startup = window.setTimeout(() => {
      void loadPlayer().catch((caught: unknown) => {
        if (!mounted) return;
        if (!(caught instanceof ApiClientError && caught.status === 401)) showToast(errorText(caught), "error");
        setView("login");
      });
    }, 0);
    return () => { mounted = false; window.clearTimeout(startup); };
  }, [loadPlayer, showToast]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      const result = await apiRequest<LoginResponse>("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ username: form.get("username"), password: form.get("password") }) });
      if (result.account.type !== "PLAYER") {
        await apiRequest<void>("/api/v1/auth/logout", { method: "POST" });
        throw new Error("Administrator accounts must use the private admin app.");
      }
      await loadPlayer();
      playSound("login");
      showToast(`Welcome back, ${result.account.username}.`, "success");
    } catch (caught: unknown) { showToast(errorText(caught), "error"); }
    finally { setPending(false); }
  }

  async function logout() {
    playSound("click");
    setPending(true);
    try { await apiRequest<void>("/api/v1/auth/logout", { method: "POST" }); walletAccountId.current = null; walletVersion.current = -1; setMe(null); setDialog(null); setView("login"); }
    catch (caught: unknown) { showToast(errorText(caught), "error"); }
    finally { setPending(false); }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true);
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const newPassword = String(form.get("newPassword") ?? "");
    const confirmation = String(form.get("confirmation") ?? "");
    if (newPassword !== confirmation) { showToast("New passwords do not match.", "error"); setPending(false); return; }
    try {
      await apiRequest<void>("/api/v1/auth/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
      walletAccountId.current = null; walletVersion.current = -1; setMe(null); setDialog(null); setView("login");
      showToast("Password changed. Sign in again with your new password.", "success");
    } catch (caught: unknown) { showToast(errorText(caught), "error"); }
    finally { setPending(false); }
  }

  async function startRound(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (selectedGame === null) return; setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      playSound(selectedGame.slug === "neon-reels" ? "spin" : "click");
      const session = await apiRequest<StartGameSessionResponse>(`/api/v1/games/${selectedGame.id}/sessions`, { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ entryAmount: coinsToCents(form.get("entryAmount")) }) });
      setActive(session); setView("play");
      if (selectedGame.slug === "neon-reels") {
        await Promise.all([refreshBalance(), delay(SPIN_ANIMATION_MILLISECONDS)]);
        const result = session.publicState as SlotState;
        window.setTimeout(() => playSound(result.outcome === "WIN" ? "win" : "lose"), 1_250);
      }
    } catch (caught: unknown) { showToast(errorText(caught), "error"); }
    finally { setPending(false); }
  }

  async function spinSlot(entryAmount: number): Promise<boolean> {
    if (selectedGame?.slug !== "neon-reels") return false;
    setPending(true);
    const animationWindow = delay(SPIN_ANIMATION_MILLISECONDS);
    try {
      playSound("spin");
      const session = await apiRequest<StartGameSessionResponse>(`/api/v1/games/${selectedGame.id}/sessions`, { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ entryAmount }) });
      setActive(session);
      await Promise.all([refreshBalance(), animationWindow]);
      const result = session.publicState as SlotState;
      window.setTimeout(() => playSound(result.outcome === "WIN" ? "win" : "lose"), 1_250);
      return true;
    } catch (caught: unknown) { await refreshBalance().catch(() => undefined); showToast(errorText(caught), "error"); return false; }
    finally { setPending(false); }
  }

  function leaveRound() {
    if (selectedGame?.slug === "neon-reels") { setActive(null); setSelectedGame(null); }
    setView("lobby");
  }

  async function finishRound() {
    setActive(null);
    try { await loadPlayer(); showToast("Round complete. Wallet updated.", "success"); }
    catch (caught: unknown) { showToast(errorText(caught), "error"); setView("lobby"); }
  }

  return <main className="arcade-stage">
    <section className="arcade-client" aria-label="Game arcade">
      {view !== "play" && <ArcadeBackdrop />}
      <div className="arcade-scanlines" aria-hidden="true" />
      {view === "boot" && <BootScreen />}
      {view === "login" && <LoginScreen pending={pending} onSubmit={login} />}
      {view === "lobby" && me !== null && <>
        <ArcadeTopbar username={me.username} balance={balance} onSettings={() => { playSound("click"); setDialog("settings"); }} />
        <Lobby games={games} onSelect={(game) => { playSound("click"); setSelectedGame(game); }} />
      </>}
      {view === "play" && active !== null && selectedGame !== null && <RoundScreen active={active} game={selectedGame} balance={balance} pending={pending} onSettings={() => { playSound("click"); setDialog("settings"); }} onExit={leaveRound} onSlotSpin={spinSlot} />}
      {selectedGame !== null && active === null && view === "lobby" && <EntryPanel game={selectedGame} pending={pending} onClose={() => setSelectedGame(null)} onSubmit={startRound} />}
      {dialog !== null && <PlayerSettingsDialog dialog={dialog} pending={pending} muted={muted} onToggleMuted={toggleMuted} onClose={() => setDialog(null)} onChangeDialog={setDialog} onChangePassword={changePassword} onLogout={() => void logout()} />}
      <MobileOnlyGate />
    </section>
  </main>;
}

function ArcadeBackdrop() {
  return <div className="arcade-canvas arcade-css-backdrop" aria-hidden="true"><i /><i /><i /></div>;
}

function BootScreen() { return <div className="arcade-center"><div className="arcade-loader"><span /><span /><span /></div><p className="arcade-kicker">Connecting to game server</p></div>; }

function LoginScreen({ pending, onSubmit }: Readonly<{ pending: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }>) {
  return <div className="login-screen"><div className="brand-lockup"><div className="brand-orbit"><span>G</span></div><p className="arcade-kicker">Live mobile arcade</p><h1>GAME<span>VERSE</span></h1><p className="brand-tagline">Enter your player ID to start</p></div><form className="game-login-panel" onSubmit={onSubmit}><label><span>Player ID</span><input name="username" autoComplete="username" placeholder="Enter username" minLength={3} required /></label><label><span>Secret code</span><input name="password" type="password" autoComplete="current-password" placeholder="Enter password" minLength={8} required /></label><button disabled={pending}>{pending ? "CONNECTING…" : "ENTER GAME"}</button><p>Account access is issued by your game operator.</p></form><div className="login-status"><i /> SERVER ONLINE <span>v1.0</span></div></div>;
}

function ArcadeTopbar({ username, balance, onSettings }: Readonly<{ username: string; balance: string; onSettings: () => void }>) {
  return <header className="game-topbar"><div className="mini-brand">GV</div><div><small>PLAYER</small><strong>{username}</strong></div><div className="coin-pill" aria-label={`${formatCents(balance)} coins`}><span>●</span>{formatCents(balance)}</div><button className="icon-button" aria-label="Open settings" onClick={onSettings}>⚙</button></header>;
}

function Lobby({ games, onSelect }: Readonly<{ games: readonly CatalogGame[]; onSelect: (game: CatalogGame) => void }>) {
  return <div className="game-content"><section className="hero-banner slot-feature"><div><span className="live-chip">NEW</span><p>FEATURED GAME</p><h2>Neon<br /><em>Reels</em></h2><small>Five reels. Five lines. Instant wins.</small></div><div className="hero-slots"><i>7</i><i>★</i><i>◆</i></div></section><div className="section-title"><div><small>PLAY NOW</small><h3>Choose your game</h3></div><span>{games.length} LIVE</span></div>{games.length === 0 ? <div className="empty-game"><strong>More games loading soon</strong><span>Check back with your operator.</span></div> : <div className="game-grid">{games.map((game, index) => <button className={`game-tile game-tile-${index % 3} ${game.slug === "neon-reels" ? "slot-game-tile" : ""}`} key={`${game.id}-${game.version}`} onClick={() => onSelect(game)}><div className="tile-art"><span>{game.slug === "neon-reels" ? "777" : index % 2 === 0 ? "◎" : "◆"}</span><i>PLAY</i></div><strong>{game.name}</strong><small>{formatCents(game.minimumEntry)}–{game.maximumEntry === "0" ? "∞" : formatCents(game.maximumEntry)} coins</small></button>)}</div>}</div>;
}

function PlayerSettingsDialog({ dialog, pending, muted, onToggleMuted, onClose, onChangeDialog, onChangePassword, onLogout }: Readonly<{ dialog: Exclude<PlayerDialog, null>; pending: boolean; muted: boolean; onToggleMuted: () => void; onClose: () => void; onChangeDialog: (dialog: PlayerDialog) => void; onChangePassword: (event: FormEvent<HTMLFormElement>) => void; onLogout: () => void }>) {
  return <div className="game-modal-backdrop settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}>
    {dialog === "settings" && <section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title"><button className="modal-close" aria-label="Close settings" onClick={onClose}>×</button><p className="arcade-kicker">Player controls</p><h2 id="settings-title">Settings</h2><button className="settings-action" aria-pressed={muted} onClick={onToggleMuted}><span>{muted ? "🔇" : "🔊"}</span><div><strong>Sound</strong><small>{muted ? "Muted — tap to enable" : "Music and effects on"}</small></div><b>{muted ? "OFF" : "ON"}</b></button><button className="settings-action" onClick={() => onChangeDialog("password")}><span>◆</span><div><strong>Change password</strong><small>Update your secret code</small></div><b>›</b></button><button className="settings-action danger" onClick={() => onChangeDialog("logout")}><span>↪</span><div><strong>Log out</strong><small>End this game session</small></div><b>›</b></button></section>}
    {dialog === "password" && <form className="settings-panel password-panel" role="dialog" aria-modal="true" aria-labelledby="password-title" onSubmit={onChangePassword}><button type="button" className="modal-close" aria-label="Close" onClick={onClose}>×</button><button type="button" className="modal-back" onClick={() => onChangeDialog("settings")}>‹ Settings</button><h2 id="password-title">Change password</h2><label><span>Current password</span><input name="currentPassword" type="password" autoComplete="current-password" required /></label><label><span>New password</span><input name="newPassword" type="password" autoComplete="new-password" minLength={8} required /></label><label><span>Confirm new password</span><input name="confirmation" type="password" autoComplete="new-password" minLength={8} required /></label><button className="play-button" disabled={pending}>{pending ? "UPDATING…" : "UPDATE PASSWORD"}</button><small className="password-hint">Use at least 8 characters. You will sign in again after changing it.</small></form>}
    {dialog === "logout" && <section className="settings-panel confirm-panel" role="alertdialog" aria-modal="true" aria-labelledby="logout-title"><div className="confirm-icon">↪</div><h2 id="logout-title">Leave the game?</h2><p>Your current round will still finish on the game server.</p><div className="confirm-actions"><button disabled={pending} onClick={() => onChangeDialog("settings")}>CANCEL</button><button className="confirm-logout" disabled={pending} onClick={onLogout}>{pending ? "LOGGING OUT…" : "LOG OUT"}</button></div></section>}
  </div>;
}

function MobileOnlyGate() { return <div className="mobile-only-device" role="status"><div className="mobile-only-mark">GV</div><strong>Continue on your phone</strong><p>GAMEVERSE is a mobile-only arcade. Open this address on a phone and play in portrait or landscape.</p></div>; }

function EntryPanel({ game, pending, onClose, onSubmit }: Readonly<{ game: CatalogGame; pending: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }>) {
  const slot = game.slug === "neon-reels";
  const minimum = formatCents(game.minimumEntry); const maximum = game.maximumEntry === "0" ? undefined : formatCents(game.maximumEntry);
  const denominations = slot ? wagerOptions(game) : [];
  return <div className="game-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}><form className="entry-panel" onSubmit={onSubmit}><button type="button" className="modal-close" aria-label="Close" onClick={onClose}>×</button><div className={`entry-icon ${slot ? "slot-entry-icon" : ""}`}>{slot ? "777" : "◎"}</div><p className="arcade-kicker">{slot ? "Five-line slot" : "Ready to play?"}</p><h2>{game.name}</h2><small>{slot ? "Choose your wager for the first spin" : "Choose your entry amount"}</small><label><span>COINS</span>{slot ? <select name="entryAmount" defaultValue={formatCents(denominations[0] ?? 10)}>{denominations.map((amount) => <option key={amount} value={formatCents(amount)}>{formatWager(amount)} coin</option>)}</select> : <input name="entryAmount" type="number" min={minimum} max={maximum} defaultValue={minimum} step="0.01" inputMode="decimal" required />}</label><p className="entry-range">{slot ? "Available: 0.1 · 0.5 · 1 · 5 · 10 · 20 · 50" : `Allowed: ${minimum}–${maximum ?? "unlimited"}`}</p><button className="play-button" disabled={pending}>{pending ? "SPINNING…" : slot ? "PLAY & SPIN" : "START ROUND"}</button></form></div>;
}

function RoundScreen({ active, game, balance, pending, onSettings, onExit, onSlotSpin }: Readonly<{ active: StartGameSessionResponse; game: CatalogGame; balance: string; pending: boolean; onSettings: () => void; onExit: () => void; onSlotSpin: (entryAmount: number) => Promise<boolean> }>) {
  return <div className="round-screen slot-round-screen"><header><button onClick={onExit}>‹</button><div><small>NOW PLAYING</small><strong>{game.name}</strong></div><div className="round-coins"><span>●</span>{formatCents(balance)}</div><span>5 LINES</span><FullscreenButton /><button className="round-settings" aria-label="Open settings" onClick={onSettings}>⚙</button></header><NeonReelsRound state={active.publicState as SlotState} game={game} pending={pending} onSpin={onSlotSpin} /></div>;
}

function FullscreenButton() {
  const [available, setAvailable] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const update = () => {
      setAvailable(document.fullscreenEnabled || document.fullscreenElement !== null);
      setActive(document.fullscreenElement !== null);
    };
    update();
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  if (!available) return null;
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement !== null) await document.exitFullscreen();
      else {
        await document.documentElement.requestFullscreen();
        await screen.orientation.lock("landscape").catch(() => undefined);
      }
    } catch {
      // Fullscreen is optional; browsers can deny it without affecting gameplay.
    }
  }

  return <button className="round-fullscreen" aria-label={active ? "Exit fullscreen" : "Enter fullscreen"} aria-pressed={active} onClick={() => void toggleFullscreen()}>{active ? "×" : "⛶"}</button>;
}

function NeonReelsRound({ state, game, pending, onSpin }: Readonly<{ state: SlotState; game: CatalogGame; pending: boolean; onSpin: (entryAmount: number) => Promise<boolean> }>) {
  const [bet, setBet] = useState(Number(state.entryAmount));
  const [autoRemaining, setAutoRemaining] = useState(0);
  const autoRun = useRef(0);
  const denominations = wagerOptions(game);
  const betIndex = denominations.indexOf(bet);
  useEffect(() => () => { autoRun.current += 1; }, []);

  async function startAuto(count: number) {
    const run = ++autoRun.current; setAutoRemaining(count);
    for (let remaining = count; remaining > 0 && autoRun.current === run; remaining -= 1) {
      setAutoRemaining(remaining);
      const succeeded = await onSpin(bet);
      if (!succeeded || autoRun.current !== run) break;
      if (remaining > 1) await delay(100);
    }
    if (autoRun.current === run) setAutoRemaining(0);
  }
  function stopAuto() { autoRun.current += 1; setAutoRemaining(0); }
  function adjustBet(direction: -1 | 1) {
    const currentIndex = betIndex >= 0 ? betIndex : 0;
    const nextIndex = Math.min(denominations.length - 1, Math.max(0, currentIndex + direction));
    setBet(denominations[nextIndex] ?? bet);
  }

  return <div className="slot-stage"><LazyNeonReelsCanvas state={state} spinning={pending} /><div className="slot-controls"><div className="slot-result"><small>{pending ? "SPINNING" : state.outcome === "WIN" ? `×${state.totalMultiplier} WIN` : "RESULT"}</small><strong className={!pending && state.outcome === "WIN" ? "slot-win" : ""}>{pending ? "GOOD LUCK" : state.outcome === "WIN" ? `+${formatCents(state.reward)}` : "NO WIN"}</strong></div><div className="bet-control" aria-label="Choose wager"><button aria-label="Decrease wager" disabled={pending || autoRemaining > 0 || betIndex <= 0} onClick={() => adjustBet(-1)}>−</button><div><small>BET</small><strong>{formatWager(bet)}</strong></div><button aria-label="Increase wager" disabled={pending || autoRemaining > 0 || betIndex === denominations.length - 1} onClick={() => adjustBet(1)}>+</button></div><div className="auto-control">{autoRemaining > 0 ? <button className="auto-stop" onClick={stopAuto}>STOP<small>{autoRemaining} LEFT</small></button> : <><button disabled={pending} onClick={() => void startAuto(10)}>AUTO 10</button><button disabled={pending} onClick={() => void startAuto(25)}>25</button></>}</div><button className="spin-button" disabled={pending || autoRemaining > 0} onClick={() => void onSpin(bet)}>{pending ? "…" : "SPIN"}<small>{formatWager(bet)} COINS</small></button></div></div>;
}

function wagerOptions(game: CatalogGame): readonly number[] {
  const configured = game.configuration.wagerDenominationsCents;
  return Array.isArray(configured) && configured.every((amount) => typeof amount === "number" && Number.isInteger(amount) && amount > 0) ? configured as number[] : [10, 50, 100, 500, 1_000, 2_000, 5_000];
}
function formatWager(cents: number): string { const formatted = formatCents(cents); return formatted.endsWith(".00") ? formatted.slice(0, -3) : formatted.endsWith("0") ? formatted.slice(0, -1) : formatted; }
function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => window.setTimeout(resolve, milliseconds)); }

function errorText(error: unknown) { return error instanceof ApiClientError || error instanceof Error ? error.message : "The game service could not complete that action."; }
