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
  onAction: (action: NeonMinesAction) => Promise<void>;
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
    : state.status === "ABANDONED" ? "Round expired"
      : state.status === "CASHED_OUT" || state.status === "AUTO_CASHED_OUT" ? "Coins secured" : "Choose a tile";

  return <section className={`mines-stage mines-status-${state.status.toLowerCase()}`} aria-label="Neon Mines game board">
    <div className="mines-summary">
      <div><small>CASH OUT</small><strong>{formatCents(state.currentCashOut)}</strong></div>
      <div><small>NEXT SAFE</small><strong>{state.nextSafePayout === null ? "—" : formatCents(state.nextSafePayout)}</strong></div>
      <div><small>SAFE PICKS</small><strong>{state.safeSelections}</strong></div>
      <div><small>{active ? "ROUND TIME" : "RESULT"}</small><strong>{active ? formatTimer(remaining) : statusLabel(state.status)}</strong></div>
    </div>

    <div className="mines-board-wrap">
      <div className="mines-board" role="group" aria-label={`25 tiles with ${state.mineCount} mines`}>
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
    <div className="mines-message" aria-live="polite"><i aria-hidden="true" /> <strong>{pending ? "Checking action…" : needsSync ? "Connection interrupted" : headline}</strong><span>{needsSync ? "Reconnect before your next move" : active ? `${state.mineCount} mines remain hidden` : terminalText(state)}</span></div>

    <div className="mines-controls">
      {needsSync ? <button className="mines-done" disabled={pending} onClick={onReconnect}>{pending ? "RECONNECTING…" : "RECONNECT"}</button> : active ? <button className="mines-cashout" disabled={pending || !state.cashOutAvailable} onClick={() => void onAction({ action: "CASH_OUT" })}>
        <span>{pending ? "PLEASE WAIT" : state.cashOutAvailable ? "CASH OUT" : "PICK A SAFE TILE"}</span>
        <strong>{state.cashOutAvailable ? `${formatCents(state.currentCashOut)} COINS` : `BET ${formatCents(state.entryAmount)}`}</strong>
      </button> : <button className="mines-done" disabled={pending} onClick={onRestart}>{pending ? "STARTING…" : "PLAY AGAIN"}</button>}
    </div>
  </section>;
}

function secondsRemaining(expiresAt: string | null): number | null { return expiresAt === null ? null : Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1_000)); }
function formatTimer(seconds: number | null): string { if (seconds === null) return "—"; return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
function statusLabel(status: NeonMinesPublicState["status"]): string { return status === "MINE_HIT" ? "LOST" : status === "ABANDONED" ? "EXPIRED" : "WON"; }
function terminalText(state: NeonMinesPublicState): string {
  if (state.status === "MINE_HIT") return "The wager was lost";
  if (state.status === "ABANDONED") return "No tile was selected";
  return `${formatCents(state.currentCashOut)} coins returned`;
}
