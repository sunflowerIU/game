import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NeonMinesAdminFields, minesConfigurationFromForm } from "../components/neon-mines-admin-fields";

test("Mines admin exposes coin limits, fixed odds and round revision policy", () => {
  const html = renderToStaticMarkup(<NeonMinesAdminFields configuration={{ maximumPayoutCents: 50_000 }} minimumEntry="10" maximumEntry="500" />);
  assert.match(html, /96% theoretical RTP/);
  assert.match(html, /active rounds retain their original settings/);
  assert.match(html, /name="maximumPayout"/);
  assert.match(html, /value="500.00"/);
  assert.doesNotMatch(html, /textarea|unlimited/i);
});

test("Mines admin translates coins to cents without replacing fixed rules", () => {
  const config = { boardTiles: 25, returnBps: 9600, maximumPayoutCents: 50_000 };
  const form = new FormData(); form.set("maximumPayout", "12.34");
  assert.deepEqual(minesConfigurationFromForm(config, form), { ...config, maximumPayoutCents: 1234 });
  assert.equal(config.maximumPayoutCents, 50_000);
  form.set("maximumPayout", "invalid");
  assert.throws(() => minesConfigurationFromForm(config, form));
});
