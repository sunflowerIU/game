import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "./config.js";

const base = { DATABASE_URL: "postgresql://game:secret@postgres/game", SERVER_HOST: "0.0.0.0", SERVER_PORT: "4000" };

test("production configuration requires HTTPS and trusted reverse-proxy addresses", () => {
  assert.throws(() => loadConfig({ ...base, NODE_ENV: "production", WEB_ORIGIN: "http://games.example.com", TRUST_PROXY: "false" }), /WEB_ORIGIN|TRUST_PROXY/u);
  const config = loadConfig({ ...base, NODE_ENV: "production", WEB_ORIGIN: "https://games.example.com", ADMIN_ORIGIN: "https://admin.example.com", TRUST_PROXY: "true" });
  assert.equal(config.trustProxy, true);
});
