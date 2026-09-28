"use client";

import type { GameCatalogResponse, NeonDicePublicState, NeonDiceSelection } from "@game-platform/contracts";
import { useState } from "react";
import { formatCents } from "../lib/money";

type CatalogGame = GameCatalogResponse["games"][number];

const choices = [
  { value: "UNDER_7", label: "UNDER 7", range: "2—6", probability: "15 / 36", multiplier: "2.28×" },
  { value: "EXACTLY_7", label: "EXACTLY 7", range: "7", probability: "6 / 36", multiplier: "5.70×" },
  { value: "OVER_7", label: "OVER 7", range: "8—12", probability: "15 / 36", multiplier: "2.28×" }
] as const satisfies readonly { value: NeonDiceSelection; label: string; range: string; probability: string; multiplier: string }[];

const pipPositions: Readonly<Record<number, readonly number[]>> = {
  1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9]
};

export function NeonDiceRound({ state, game, rolling, onRoll }: Readonly<{
  state: NeonDicePublicState;
  game: CatalogGame;
  rolling: boolean;
  onRoll: (entryAmount: number, selection: NeonDiceSelection) => Promise<boolean>;
}>) {
  const denominations = wagerOptions(game);
  const initialBet = denominations.includes(Number(state.entryAmount)) ? Number(state.entryAmount) : denominations[0] ?? 50;
  const [bet, setBet] = useState(initialBet);
  const [selection, setSelection] = useState<NeonDiceSelection>(state.selection);
  const betIndex = denominations.indexOf(bet);
  const resultChoice = choices.find((choice) => choice.value === state.selection) ?? choices[0];

  function adjustBet(direction: -1 | 1) {
    const currentIndex = betIndex >= 0 ? betIndex : 0;
    const nextIndex = Math.min(denominations.length - 1, Math.max(0, currentIndex + direction));
    setBet(denominations[nextIndex] ?? bet);
  }

  return <section className={`dice-stage ${rolling ? "dice-is-rolling" : state.win ? "dice-is-win" : "dice-is-loss"}`} aria-label="Neon Dice game">
    <div className="dice-aurora" aria-hidden="true"><i /><i /><i /></div>
    <div className="dice-predictions" role="group" aria-label="Choose a dice total prediction">
      {choices.map((choice) => <button type="button" key={choice.value} aria-pressed={selection === choice.value} className={selection === choice.value ? "selected" : ""} disabled={rolling} onClick={() => setSelection(choice.value)}>
        <span>{choice.range}</span><strong>{choice.label}</strong><small>{choice.probability} · {choice.multiplier}</small>
      </button>)}
    </div>

    <div className="dice-table">
      <div className="dice-table-ring" aria-hidden="true" />
      <div className="dice-pair" aria-label={rolling ? "Dice rolling" : `Dice show ${state.dice[0]} and ${state.dice[1]}`}>
        <DieFace value={state.dice[0]} index={0} rolling={rolling} />
        <DieFace value={state.dice[1]} index={1} rolling={rolling} />
      </div>
      <div className="dice-total" aria-hidden={rolling}><small>TOTAL</small><strong>{rolling ? "?" : state.total}</strong></div>
    </div>

    <div className="dice-result" aria-live="polite" aria-atomic="true">
      <small>{rolling ? "FATE IS IN MOTION" : `YOU PICKED ${resultChoice.label}`}</small>
      <strong>{rolling ? "ROLLING…" : state.win ? `YOU WON ${formatCents(state.reward)} COINS` : `${state.total} — NOT THIS TIME`}</strong>
      <span>{rolling ? "The server is revealing your result" : state.win ? `${formatMultiplier(state.multiplierBps)} payout on a ${formatCents(state.entryAmount)} coin wager` : "Choose your next prediction and roll again"}</span>
    </div>

    <div className="dice-controls">
      <div className="dice-bet-control" aria-label="Choose wager">
        <button type="button" aria-label="Decrease wager" disabled={rolling || betIndex <= 0} onClick={() => adjustBet(-1)}>−</button>
        <div><small>WAGER</small><strong>{formatWager(bet)}</strong><span>COINS</span></div>
        <button type="button" aria-label="Increase wager" disabled={rolling || betIndex === denominations.length - 1} onClick={() => adjustBet(1)}>+</button>
      </div>
      <button type="button" className="dice-roll-button" disabled={rolling} onClick={() => void onRoll(bet, selection)}>
        <span aria-hidden="true">⚄</span><strong>{rolling ? "ROLLING" : "ROLL DICE"}</strong><small>{predictionLabel(selection)} · {formatWager(bet)} COINS</small>
      </button>
    </div>
  </section>;
}

function DieFace({ value, index, rolling }: Readonly<{ value: number; index: number; rolling: boolean }>) {
  const pips = new Set(pipPositions[value] ?? []);
  return <div className={`neon-die neon-die-${index + 1} ${rolling ? "rolling" : ""}`} aria-hidden="true">
    <div className="neon-die-face">{Array.from({ length: 9 }, (_, position) => <i className={pips.has(position + 1) ? "pip visible" : "pip"} key={position} />)}</div>
  </div>;
}

function wagerOptions(game: CatalogGame): readonly number[] {
  const configured = game.configuration.wagerDenominationsCents;
  return Array.isArray(configured) && configured.every((amount) => typeof amount === "number" && Number.isInteger(amount) && amount > 0) ? configured as number[] : [50, 100, 200, 500, 1_000, 2_000, 3_000];
}
function formatMultiplier(multiplierBps: number): string { return `${(multiplierBps / 10_000).toFixed(2)}×`; }
function formatWager(cents: number): string { const formatted = formatCents(cents); return formatted.endsWith(".00") ? formatted.slice(0, -3) : formatted.endsWith("0") ? formatted.slice(0, -1) : formatted; }
function predictionLabel(selection: NeonDiceSelection): string { return choices.find((choice) => choice.value === selection)?.label ?? "UNDER 7"; }
