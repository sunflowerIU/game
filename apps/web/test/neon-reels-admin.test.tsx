import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NeonReelsAdminFields, reelsConfigurationFromForm } from "../components/neon-reels-admin-fields";

const configuration = {
  rows: 3, reels: 5, maxWinMultiplier: 100, wagerDenominationsCents: [10, 50, 100],
  weights: { LEMON: 34, CHERRY: 27, GEM: 19, BELL: 12, STAR: 7, SEVEN: 3, WILD: 3, SCATTER: 4 },
  payouts: {
    LEMON: { 3: 2, 4: 2, 5: 5 }, CHERRY: { 3: 2, 4: 3, 5: 7 }, GEM: { 3: 2, 4: 5, 5: 10 }, BELL: { 3: 3, 4: 8, 5: 15 },
    STAR: { 3: 4, 4: 10, 5: 20 }, SEVEN: { 3: 6, 4: 15, 5: 30 }, WILD: { 3: 8, 4: 20, 5: 50 }
  },
  scatterPayouts: { 3: 2, 4: 5, 5: 12 }
};

test("Reels admin exposes understandable math controls instead of raw JSON", () => {
  const html = renderToStaticMarkup(<NeonReelsAdminFields configuration={configuration} minimumEntry="10" maximumEntry="100" />);
  assert.match(html, /31\.2% hit frequency/);
  assert.match(html, /95\.3% theoretical RTP/);
  assert.match(html, /name="weight\.LEMON"/);
  assert.match(html, /name="payout\.WILD\.5"/);
  assert.doesNotMatch(html, /textarea/i);
  const custom = renderToStaticMarkup(<NeonReelsAdminFields configuration={{ ...configuration, maxWinMultiplier: 99 }} minimumEntry="10" maximumEntry="100" />);
  assert.match(custom, /Custom unverified profile/);
  assert.doesNotMatch(custom, /95\.3% theoretical RTP/);
});

test("Reels admin creates a complete immutable math configuration", () => {
  const form = new FormData();
  for (const [symbol, weight] of Object.entries(configuration.weights)) form.set(`weight.${symbol}`, String(weight));
  for (const [symbol, payouts] of Object.entries(configuration.payouts)) {
    for (const [count, payout] of Object.entries(payouts)) form.set(`payout.${symbol}.${count}`, String(payout));
  }
  for (const [count, payout] of Object.entries(configuration.scatterPayouts)) form.set(`scatter.${count}`, String(payout));
  form.set("maxWinMultiplier", "100");
  assert.deepEqual(reelsConfigurationFromForm(configuration, form), configuration);
  form.set("weight.WILD", "0");
  assert.throws(() => reelsConfigurationFromForm(configuration, form), /weight\.WILD/);
});
