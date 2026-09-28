import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NeonDiceAdminFields, diceConfigurationFromForm } from "../components/neon-dice-admin-fields";

const configuration = {
  returnBps: 9_500,
  multiplierBps: { UNDER_7: 22_800, EXACTLY_7: 57_000, OVER_7: 22_800 },
  wagerDenominationsCents: [50, 100, 200, 500, 1_000, 2_000, 3_000],
  maximumPayoutCents: 20_000
};

test("Dice admin presents safe wager controls and locked verified math", () => {
  const html = renderToStaticMarkup(<NeonDiceAdminFields configuration={configuration} />);
  assert.match(html, /95% theoretical RTP/u);
  assert.match(html, /Odds and multipliers are locked/u);
  assert.equal((html.match(/name="wagerDenomination"/gu) ?? []).length, 7);
  assert.match(html, /name="minimumEntry" value="0\.50"/u);
  assert.match(html, /name="maximumEntry" value="30\.00"/u);
  assert.match(html, /needs at least[^<]*<strong[^>]*>171\.00 coins/u);
  assert.doesNotMatch(html, /textarea/u);
});

test("Dice admin produces an immutable safe configuration without altering fixed odds", () => {
  const form = new FormData();
  form.append("wagerDenomination", "100"); form.append("wagerDenomination", "500"); form.append("wagerDenomination", "1000");
  form.set("maximumPayout", "57");
  assert.deepEqual(diceConfigurationFromForm(configuration, form), { ...configuration, wagerDenominationsCents: [100, 500, 1_000], maximumPayoutCents: 5_700 });
  assert.equal(configuration.returnBps, 9_500);
  assert.deepEqual(configuration.wagerDenominationsCents, [50, 100, 200, 500, 1_000, 2_000, 3_000]);
});

test("Dice admin rejects empty, duplicate, and unsupported wagers", () => {
  for (const wagers of [[], ["100", "100"], ["25"]]) {
    const form = new FormData(); wagers.forEach((amount) => form.append("wagerDenomination", amount)); form.set("maximumPayout", "200");
    assert.throws(() => diceConfigurationFromForm(configuration, form), /supported Dice wager/u);
  }
});
