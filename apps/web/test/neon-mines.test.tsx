import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { NeonMinesPublicState } from "@game-platform/contracts";
import { NeonMinesRound } from "../components/neon-mines-round";

const initial: NeonMinesPublicState = { status: "ACTIVE", boardTiles: 25, difficulty: "EASY", mineCount: 3, entryAmount: "100", selectedTiles: [], revealedMines: [], detonatedTile: null, safeSelections: 0, currentCashOut: "0", nextSafePayout: "109", cashOutAvailable: false, nextSelectionAllowed: true };
function render(state = initial, pending = false, needsSync = false) {
  return renderToStaticMarkup(<NeonMinesRound state={state} expiresAt={null} pending={pending} needsSync={needsSync} onReconnect={() => undefined} onAction={async () => undefined} onRestart={() => undefined} />);
}

test("Mines renders 25 accessible concealed tiles and disables premature cash-out", () => {
  const html = render();
  assert.equal((html.match(/aria-label="Select tile /gu) ?? []).length, 25);
  assert.equal((html.match(/disabled=""/gu) ?? []).length, 1);
  assert.match(html, /PICK A SAFE TILE/u);
  assert.doesNotMatch(html, /mine-tile-mine/u);
});

test("Mines displays server payouts, safe tiles, and terminal mine results", () => {
  const safe: NeonMinesPublicState = { ...initial, selectedTiles: [3], safeSelections: 1, currentCashOut: "109", cashOutAvailable: true };
  assert.match(render(safe), /1.09 COINS/u);
  assert.match(render(safe), /Tile 4, safe/u);
  const lost: NeonMinesPublicState = { ...safe, status: "MINE_HIT", selectedTiles: [1, 3], revealedMines: [0, 1, 2], detonatedTile: 1, currentCashOut: "0", nextSafePayout: null, cashOutAvailable: false, nextSelectionAllowed: false };
  const html = render(lost);
  assert.equal((html.match(/disabled=""/gu) ?? []).length, 25);
  assert.match(html, /Tile 2, detonated mine/u);
  assert.match(html, /The wager was lost/u);
  assert.match(html, /Game over/u);
  assert.match(html, /PLAY AGAIN/u);
  assert.doesNotMatch(html, /BACK TO GAMES/u);
  const restarting = render(lost, true);
  assert.match(restarting, /STARTING…/u);
  assert.match(restarting, /class="mines-done" disabled=""/u);
});

test("Mines blocks actions while pending or uncertain and offers reconnection", () => {
  assert.equal((render(initial, true).match(/disabled=""/gu) ?? []).length, 26);
  const html = render(initial, false, true);
  assert.equal((html.match(/disabled=""/gu) ?? []).length, 25);
  assert.match(html, /RECONNECT/u);
  assert.match(html, /Reconnect before your next move/u);
});

test("optional layout fixture uses the actual component and application CSS", async () => {
  const output = process.env.MINES_PREVIEW_DIR;
  if (!output) return;
  await mkdir(output, { recursive: true });
  const css = (await readFile(new URL("../app/globals.css", import.meta.url), "utf8")).replace('@import "tailwindcss";', "");
  const board = render({ ...initial, selectedTiles: [3, 7, 12], safeSelections: 3, currentCashOut: "143", nextSafePayout: "168", cashOutAvailable: true });
  await writeFile(join(output, "mines-preview.html"), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main class="arcade-stage"><section class="arcade-client"><div class="round-screen mines-round-screen"><header><button>‹</button><div><small>NOW PLAYING</small><strong>Neon Mines</strong></div><div class="round-coins">● 99.00</div><span>3 MINES</span><button class="round-fullscreen">⛶</button><button class="round-settings">⚙</button></header>${board}</div></section></main></body></html>`);
});
