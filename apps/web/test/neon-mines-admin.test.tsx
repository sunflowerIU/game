import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NeonMinesAdminFields, minesConfigurationFromForm } from "../components/neon-mines-admin-fields";

test("Mines admin exposes completion rewards and adjustable deposit caps", () => {
  const html = renderToStaticMarkup(<NeonMinesAdminFields configuration={{}} minimumEntry="10" maximumEntry="2000" />);
  assert.match(html, /Completion-only rewards/);
  assert.match(html, /active rounds retain their original settings/);
  assert.match(html, /name="easyMaximum"/);
  assert.match(html, /name="easyReward"/);
  assert.doesNotMatch(html, /expert/i);
  assert.match(html, /Easy: 2 mines \/ 2×/);
  assert.match(html, /value="10.00" selected/);
  assert.doesNotMatch(html, /textarea|unlimited/i);
});

test("Mines admin translates each difficulty cap to cents", () => {
  const config = {};
  const form = new FormData();
  form.set("easyMaximum", "10"); form.set("mediumMaximum", "20"); form.set("hardMaximum", "20");
  form.set("easyReward", "6"); form.set("mediumReward", "3"); form.set("hardReward", "4");
  const result = minesConfigurationFromForm(config, form);
  assert.equal((result.difficulties as Record<string, { maximumWagerCents: number }>).EASY!.maximumWagerCents, 1000);
  assert.equal((result.difficulties as Record<string, { rewardMultiplier: number }>).EASY!.rewardMultiplier, 6);
  form.set("easyMaximum", "invalid");
  assert.throws(() => minesConfigurationFromForm(config, form));
});
