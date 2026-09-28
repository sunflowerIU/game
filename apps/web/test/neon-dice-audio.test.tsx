import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

test("Neon Dice has a dedicated procedural music scene and complete effect set", async () => {
  const audio = await readFile(new URL("../lib/adaptive-game-audio.ts", import.meta.url), "utf8");
  assert.match(audio, /GameMusicScene = [^;]*"neon-dice"/u);
  for (const effect of ["dice-roll", "dice-impact", "dice-win", "dice-lose"]) {
    assert.match(audio, new RegExp(`effect === "${effect}"`, "u"));
  }
  assert.match(audio, /playDiceStep\(now, this\.musicStep\)/u);
  assert.match(audio, /private playDiceStep/u);
  assert.match(audio, /private duckMusic/u);
  assert.doesNotMatch(audio, /new Audio\(|\.mp3|\.wav|\.ogg/u);
});

test("player flow synchronizes Dice roll and outcome sounds with authoritative settlement", async () => {
  const player = await readFile(new URL("../components/player-game-app.tsx", import.meta.url), "utf8");
  assert.match(player, /selectedGame\?\.slug === "neon-dice" \? "neon-dice"/u);
  assert.match(player, /playSound\("dice-roll"\)/u);
  assert.match(player, /playSound\("dice-impact"\)/u);
  assert.match(player, /playSound\(result\.win \? "dice-win" : "dice-lose"\)/u);
  assert.match(player, /Promise\.all\(\[sessionRequest, delay\(DICE_ANIMATION_MILLISECONDS\)\]\)/u);
});
