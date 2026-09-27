import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { NeonReelsCanvas, type NeonReelsCanvasState } from "../components/neon-reels-canvas";

const result: NeonReelsCanvasState = {
  status: "COMPLETED", entryAmount: "100", outcome: "WIN", reward: "500", totalMultiplier: 5, scatterCount: 0,
  reels: [
    ["LEMON", "CHERRY", "GEM"], ["LEMON", "STAR", "BELL"], ["LEMON", "SEVEN", "WILD"],
    ["CHERRY", "GEM", "STAR"], ["BELL", "SEVEN", "SCATTER"]
  ],
  winLines: [{ payline: 1, symbol: "LEMON", count: 3, multiplier: 5 }]
};

test("Neon Reels renders a fluid five-reel surface without fixed pixel dimensions", () => {
  const html = renderToStaticMarkup(<NeonReelsCanvas state={result} spinning={false} />);
  assert.equal((html.match(/class="slot-dom-reel"/gu) ?? []).length, 5);
  assert.match(html, /aria-label="Neon Reels spin result"/u);
  assert.doesNotMatch(html, /style="[^"]*(?:width|height):[0-9]+px/u);
});

test("player CSS supports phones, short landscape, tablets, desktops, and legacy viewport units", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const player = await readFile(new URL("../components/player-game-app.tsx", import.meta.url), "utf8");
  assert.match(css, /height:\s*100vh;\s*height:\s*100dvh/u);
  assert.match(css, /@media \(min-width: 700px\)/u);
  assert.match(css, /@media \(orientation: portrait\) and \(max-width: 360px\)/u);
  assert.match(css, /@media \(orientation: landscape\) and \(max-height: 560px\) and \(max-width: 650px\)/u);
  assert.match(css, /aspect-ratio:\s*16 \/ 9/u);
  assert.doesNotMatch(css, /mobile-only-device/u);
  assert.doesNotMatch(player, /MobileOnlyGate|mobile-only arcade/u);
});
