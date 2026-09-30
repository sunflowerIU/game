"use client";

import type { NeonMinesAction, NeonMinesPublicState } from "@game-platform/contracts";
import { useEffect, useState } from "react";
import { formatCents } from "../lib/money";

export function NeonMinesRound({ state, expiresAt, pending, needsSync, onReconnect, onAction, onRestart }: Readonly<{
  state: NeonMinesPublicState;
  expiresAt: string | null;
  pending: boolean;
  needsSync: boolean;
  onReconnect: () => void;
  onAction: (action: NeonMinesAction) => Promise<unknown>;
  onRestart: () => void;
}>) {
  const active = state.status === "ACTIVE";
  const [remaining, setRemaining] = useState(() => secondsRemaining(expiresAt));
  useEffect(() => {
    const update = () => setRemaining(secondsRemaining(expiresAt));
    update();
    if (!active || expiresAt === null) return;
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [active, expiresAt]);

  const selected = new Set(state.selectedTiles);
  const mines = new Set(state.revealedMines);
  const headline = state.status === "MINE_HIT" ? "Game over"
    : state.status === "ABANDONED" ? "Round ended"
      : state.status === "WON" ? "Board cleared!" : "Choose a tile";

  return <section className={`mines-stage mines-status-${state.status.toLowerCase()}`} aria-label="Neon Mines game board">
    <div className="mines-summary">
      <div><small>DEPOSIT</small><strong>{formatCents(state.entryAmount)}</strong></div>
      <div><small>WIN REWARD</small><strong>{state.rewardMultiplier}×</strong></div>
      <div><small>SAFE PICKS</small><strong>{state.safeSelections}</strong></div>
      <div><small>{active ? "ROUND TIME" : "RESULT"}</small><strong>{active ? formatTimer(remaining) : statusLabel(state.status)}</strong></div>
    </div>

    <div className="mines-board-wrap">
      <div className="mines-board" role="group" aria-label={`${state.boardTiles} tiles with ${state.mineCount} mines`}>
        {Array.from({ length: state.boardTiles }, (_, tile) => {
          const mine = mines.has(tile); const chosen = selected.has(tile); const detonated = state.detonatedTile === tile;
          const className = detonated ? "mine-tile mine-tile-hit" : mine ? "mine-tile mine-tile-mine" : chosen ? "mine-tile mine-tile-safe" : "mine-tile";
          const label = detonated ? `Tile ${tile + 1}, detonated mine` : mine ? `Tile ${tile + 1}, mine` : chosen ? `Tile ${tile + 1}, safe` : `Select tile ${tile + 1}`;
          return <button className={className} key={tile} aria-label={label} disabled={!active || pending || needsSync || chosen || !state.nextSelectionAllowed} onClick={() => void onAction({ action: "SELECT_TILE", tile })}>
            <span aria-hidden="true">{mine ? "✹" : chosen ? "◆" : "?"}</span>
          </button>;
        })}
      </div>
    </div>
    <div className="mines-message" aria-live="polite"><i aria-hidden="true" /> <strong>{pending ? "Checking action…" : needsSync ? "Connection interrupted" : headline}</strong><span>{needsSync ? "Reconnect before your next move" : active ? `Clear all ${state.boardTiles - state.mineCount} safe tiles to win ${formatCents(state.nextSafePayout ?? "0")}` : terminalText(state)}</span></div>

    <div className="mines-controls">
      {needsSync ? <button className="mines-done" disabled={pending} onClick={onReconnect}>{pending ? "RECONNECTING…" : "RECONNECT"}</button> : active ? <button className="mines-cashout" disabled>
        <span>COMPLETE THE BOARD TO WIN</span>
        <strong>{state.rewardMultiplier}× = {formatCents(state.nextSafePayout ?? "0")} COINS</strong>
      </button> : <button className="mines-done" disabled={pending} onClick={onRestart}>{pending ? "STARTING…" : "PLAY AGAIN"}</button>}
    </div>
  </section>;
}

function secondsRemaining(expiresAt: string | null): number | null { return expiresAt === null ? null : Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1_000)); }
function formatTimer(seconds: number | null): string { if (seconds === null) return "—"; return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
function statusLabel(status: NeonMinesPublicState["status"]): string { return status === "MINE_HIT" ? "LOST" : status === "ABANDONED" ? "EXPIRED" : "WON"; }
function terminalText(state: NeonMinesPublicState): string {
  if (state.status === "MINE_HIT") return "The wager was lost";
  if (state.status === "ABANDONED") return BigInt(state.currentCashOut) > 0n ? "Deposit refunded because no tile was selected" : "Round left after a tile was selected; deposit forfeited";
  return `${formatCents(state.currentCashOut)} coins awarded`;
}
