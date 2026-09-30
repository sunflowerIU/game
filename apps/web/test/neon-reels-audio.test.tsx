import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("Neon Reels result sound plays when its animation window completes", async () => {
  const player = await readFile(new URL("../components/player-game-app.tsx", import.meta.url), "utf8");
  const resultSound = /playSound\(result\.outcome === "WIN" \? "reel-win" : "reel-lose"\)/gu;

  assert.equal([...player.matchAll(resultSound)].length, 2);
  assert.doesNotMatch(player, /setTimeout\([^\n]*"reel-win"/u);
  assert.match(player, /await delay\(SPIN_ANIMATION_MILLISECONDS\);\s*const result[\s\S]*?playSound\(result\.outcome/u);
  assert.match(player, /await Promise\.all\(\[refreshBalance\(\), animationWindow\]\);\s*const result[\s\S]*?playSound\(result\.outcome/u);
});

test("Neon Dice keeps its dedicated round branch", async () => {
  const player = await readFile(new URL("../components/player-game-app.tsx", import.meta.url), "utf8");

  assert.match(player, /dice \? <NeonDiceRound/u);
  assert.match(player, /game\.slug === "neon-dice" && isDiceState/u);
});
