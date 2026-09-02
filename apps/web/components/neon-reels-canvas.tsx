"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatCents } from "../lib/money";

export type NeonReelsSymbol = "LEMON" | "CHERRY" | "GEM" | "BELL" | "STAR" | "SEVEN" | "WILD" | "SCATTER";
export interface NeonReelsCanvasState {
  readonly status: "COMPLETED";
  readonly entryAmount: string;
  readonly reels: readonly (readonly NeonReelsSymbol[])[];
  readonly winLines: readonly { readonly payline: number; readonly symbol: Exclude<NeonReelsSymbol, "SCATTER">; readonly count: number; readonly multiplier: number }[];
  readonly scatterCount: number;
  readonly totalMultiplier: number;
  readonly reward: string;
  readonly outcome: "WIN" | "LOSE";
}

const REEL_LANDING_MILLISECONDS = [650, 800, 950, 1_100, 1_250] as const;

export function NeonReelsCanvas({ state, spinning }: Readonly<{ state: NeonReelsCanvasState; spinning: boolean }>) {
  const [displayedReels, setDisplayedReels] = useState<readonly (readonly NeonReelsSymbol[])[]>(randomReels);
  const [revealedState, setRevealedState] = useState<NeonReelsCanvasState | null>(null);
  const cycleTimer = useRef<number | null>(null);
  const landingTimers = useRef<number[]>([]);
  const spinStartedAt = useRef(0);
  const visuallySpinning = useRef(false);
  const scheduledResult = useRef<NeonReelsCanvasState | null>(null);

  const clearTimers = useCallback(() => {
    if (cycleTimer.current !== null) window.clearInterval(cycleTimer.current);
    cycleTimer.current = null;
    landingTimers.current.forEach((timer) => window.clearTimeout(timer));
    landingTimers.current = [];
  }, []);

  const startSpin = useCallback(() => {
    if (visuallySpinning.current) return;
    clearTimers();
    visuallySpinning.current = true;
    scheduledResult.current = null;
    spinStartedAt.current = performance.now();
    setRevealedState(null);
    setDisplayedReels(randomReels());
    cycleTimer.current = window.setInterval(() => setDisplayedReels(randomReels()), 65);
  }, [clearTimers]);

  const settle = useCallback((result: NeonReelsCanvasState) => {
    if (scheduledResult.current === result) return;
    if (!visuallySpinning.current) startSpin();
    scheduledResult.current = result;
    landingTimers.current.forEach((timer) => window.clearTimeout(timer));
    landingTimers.current = [];
    const elapsed = performance.now() - spinStartedAt.current;
    REEL_LANDING_MILLISECONDS.forEach((normalDelay, reel) => {
      const delay = Math.max(reel * 100, normalDelay - elapsed);
      const timer = window.setTimeout(() => {
        setDisplayedReels((current) => current.map((column, index) => index === reel ? result.reels[reel] ?? column : column));
        if (reel === REEL_LANDING_MILLISECONDS.length - 1) {
          if (cycleTimer.current !== null) window.clearInterval(cycleTimer.current);
          cycleTimer.current = null;
          visuallySpinning.current = false;
          setRevealedState(result);
        }
      }, delay);
      landingTimers.current.push(timer);
    });
  }, [startSpin]);

  useEffect(() => {
    startSpin();
    return clearTimers;
  }, [clearTimers, startSpin]);

  useEffect(() => {
    if (spinning) startSpin();
    else settle(state);
  }, [settle, spinning, startSpin, state]);

  useEffect(() => {
    if (visuallySpinning.current) settle(state);
  }, [settle, state]);

  const won = revealedState !== null && BigInt(revealedState.reward) > 0n;
  return <div className={`slot-canvas slot-dom-canvas ${won ? "slot-dom-win" : ""}`} aria-label="Neon Reels spin result">
    <div className="slot-dom-frame">
      <strong className="slot-dom-title">NEON REELS</strong>
      <div className="slot-dom-reels">
        {displayedReels.map((column, reel) => <div className="slot-dom-reel" key={reel}>{column.map((symbol, row) => <span key={row}>{slotGlyph(symbol)}</span>)}</div>)}
      </div>
      {revealedState !== null && revealedState.winLines.length > 0 && <svg className="slot-dom-lines" viewBox="0 0 960 500" preserveAspectRatio="none" aria-hidden="true">
        {revealedState.winLines.map((win) => <polyline key={win.payline} points={paylinePoints(win.payline)} />)}
      </svg>}
      <div className={`slot-dom-result ${won ? "slot-dom-result-win" : ""}`}>{revealedState === null ? "SPINNING…" : won ? `WIN ${formatCents(revealedState.reward)} COINS` : "SPIN AGAIN"}</div>
    </div>
  </div>;
}

const SLOT_SYMBOLS: readonly NeonReelsSymbol[] = ["LEMON", "CHERRY", "GEM", "BELL", "STAR", "SEVEN", "WILD", "SCATTER"];
function randomSlotSymbol(): NeonReelsSymbol { return SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)] ?? "LEMON"; }
function randomReels(): readonly (readonly NeonReelsSymbol[])[] { return Array.from({ length: 5 }, () => Array.from({ length: 3 }, randomSlotSymbol)); }
function slotGlyph(symbol: NeonReelsSymbol): string { return ({ LEMON: "●", CHERRY: "♣", GEM: "◆", BELL: "♛", STAR: "★", SEVEN: "7", WILD: "W", SCATTER: "$" } as const)[symbol]; }
function paylinePoints(payline: number): string {
  const rows = ([[1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2]][payline] ?? [1, 1, 1, 1, 1]);
  return rows.map((row, reel) => `${148 + reel * 166},${151 + row * 105}`).join(" ");
}
