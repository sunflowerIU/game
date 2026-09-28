import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { GameCatalogResponse, NeonDicePublicState } from "@game-platform/contracts";
import { NeonDiceRound } from "../components/neon-dice-round";

const game: GameCatalogResponse["games"][number] = {
  id: "dice", slug: "neon-dice", name: "Neon Dice", status: "ACTIVE", gameType: "SINGLE_PLAYER", version: "1.0.0",
  minimumEntry: "50", maximumEntry: "3000",
  configuration: { wagerDenominationsCents: [50, 100, 200, 500, 1_000, 2_000, 3_000] }
};
const result: NeonDicePublicState = { status: "COMPLETED", entryAmount: "500", dice: [3, 4], total: 7, selection: "EXACTLY_7", multiplierBps: 57_000, win: true, reward: "2850", outcome: "WIN" };

function render(state = result, rolling = false) {
  return renderToStaticMarkup(<NeonDiceRound state={state} game={game} rolling={rolling} onRoll={async () => true} />);
}

test("Dice renders the three server-supported predictions and authoritative result", () => {
  const html = render();
  assert.match(html, /UNDER 7/u);
  assert.match(html, /EXACTLY 7/u);
  assert.match(html, /OVER 7/u);
  assert.match(html, /Dice show 3 and 4/u);
  assert.match(html, /YOU WON 28\.50 COINS/u);
  assert.match(html, /5\.70× payout/u);
  assert.equal((html.match(/class="pip visible"/gu) ?? []).length, 7);
});

test("Dice rolling state conceals the total and locks every game control", () => {
  const html = render(result, true);
  assert.match(html, /aria-label="Dice rolling"/u);
  assert.match(html, /FATE IS IN MOTION/u);
  assert.match(html, /ROLLING…/u);
  assert.match(html, /dice-is-rolling/u);
  assert.equal((html.match(/disabled=""/gu) ?? []).length, 6);
});

test("Dice loss reports the authoritative total without a false reward", () => {
  const html = render({ ...result, dice: [1, 2], total: 3, selection: "OVER_7", multiplierBps: 22_800, win: false, reward: "0", outcome: "LOSE" });
  assert.match(html, /3 — NOT THIS TIME/u);
  assert.match(html, /YOU PICKED OVER 7/u);
  assert.doesNotMatch(html, /YOU WON/u);
});

test("optional Dice fixture uses the production component and CSS", async () => {
  const output = process.env.DICE_PREVIEW_DIR;
  if (!output) return;
  await mkdir(output, { recursive: true });
  const css = (await readFile(new URL("../app/globals.css", import.meta.url), "utf8")).replace('@import "tailwindcss";', "");
  const board = render();
  await writeFile(join(output, "dice-preview.html"), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main class="arcade-stage"><section class="arcade-client"><div class="round-screen dice-round-screen"><header><button>‹</button><div><small>NOW PLAYING</small><strong>Neon Dice</strong></div><div class="round-coins">● 99.00</div><span>95% RTP</span><button class="round-fullscreen">⛶</button><button class="round-settings">⚙</button></header>${board}</div></section></main></body></html>`);
});
