import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("production containers keep internal services private and non-root", async () => {
  const [compose, dockerfile] = await Promise.all([read("compose.production.yaml"), read("Dockerfile")]);
  const postgresBlock = compose.slice(compose.indexOf("  postgres:"), compose.indexOf("\nvolumes:"));
  assert.doesNotMatch(postgresBlock, /\n    ports:/u);
  assert.match(compose, /migrate:\s*[\s\S]*condition: service_completed_successfully/u);
  const migrateStage = dockerfile.slice(dockerfile.indexOf("FROM base AS migrate"), dockerfile.indexOf("FROM node:24-alpine AS web"));
  assert.match(migrateStage, /COPY --from=dependencies \/workspace\/apps \.\/apps/u);
  assert.match(migrateStage, /COPY --from=dependencies \/workspace\/games \.\/games/u);
  assert.match(migrateStage, /\/workspace\/pnpm-lock\.yaml/u);
  assert.match(dockerfile, /FROM node:24-alpine AS server[\s\S]*USER node/u);
  assert.match(dockerfile, /FROM node:24-alpine AS web[\s\S]*USER node/u);
});

test("edge configuration supports WSS and hides operational metrics", async () => {
  const nginx = await read("infrastructure/nginx/nginx.conf");
  assert.match(nginx, /location = \/api\/v1\/game-socket[\s\S]*proxy_set_header Upgrade/u);
  assert.match(nginx, /location = \/internal\/metrics \{ return 404; \}/u);
  assert.match(nginx, /ssl_protocols TLSv1\.2 TLSv1\.3/u);
  assert.match(nginx, /real_ip_header CF-Connecting-IP/u);
});

test("backup tooling validates dumps, checksums them, and performs isolated restore tests", async () => {
  const [backup, verify] = await Promise.all([read("infrastructure/scripts/backup-postgres.sh"), read("infrastructure/scripts/verify-backup.sh")]);
  assert.match(backup, /pg_dump/u);
  assert.match(backup, /pg_restore --list/u);
  assert.match(backup, /sha256sum/u);
  assert.match(verify, /restore_check_/u);
  assert.match(verify, /pg_restore --exit-on-error/u);
  assert.match(verify, /dropdb --if-exists/u);
});

test("paid load profile covers authoritative Neon Mines start, selection and leave settlement", async () => {
  const load = await read("infrastructure/load/k6-gameplay.js");
  assert.match(load, /GAME_SLUG.*neon-reels/u);
  assert.match(load, /gameSlug === "neon-mines"/u);
  assert.match(load, /SELECT_TILE/u);
  assert.match(load, /LEAVE/u);
  assert.match(load, /PLAYER_USERNAME_PREFIX/u);
  assert.match(load, /noCookiesReset:\s*true/u);
  assert.match(load, /summaryTrendStats:[\s\S]*p\(99\)/u);
  assert.match(load, /http_req_duration\{name:game-action\}/u);
});

test("staging Mines load tooling preserves security limits and fails closed", async () => {
  const [runner, audit, metrics] = await Promise.all([
    read("infrastructure/load/run-neon-mines-staging.sh"),
    read("infrastructure/load/neon-mines-settlement-audit.sql"),
    read("infrastructure/scripts/capture-production-load-metrics.sh")
  ]);
  assert.match(runner, /ALLOW_PAID_LOAD_TEST=I_UNDERSTAND_THIS_SPENDS_TEST_COINS/u);
  assert.match(runner, /players \* 7/u);
  assert.match(runner, /LOGIN_COOLDOWN_SECONDS:-60/u);
  assert.match(runner, /summary-export/u);
  assert.match(runner, /Load gate failed[\s\S]*exit/u);
  assert.match(audit, /non_completed = 0/u);
  assert.match(audit, /bad_wallet_balances = 0/u);
  assert.match(audit, /SETTLEMENT AUDIT FAILED[\s\S]*SELECT 1 \/ CASE/u);
  assert.match(metrics, /docker stats --no-stream/u);
  assert.match(metrics, /internal\/metrics/u);
  assert.match(metrics, /pg_stat_database/u);
});

test("readiness checks the Mines persistence schema instead of database connectivity only", async () => {
  const server = await read("apps/server/src/index.ts");
  assert.match(server, /to_regclass\('public\."GameSessionState"'\)/u);
  assert.match(server, /Required database migrations are not applied/u);
});

test("repeatable seeding cannot roll Neon Reels back to its legacy wager revision", async () => {
  const seed = await read("packages/database/prisma/seed.ts");
  const reelsBlock = seed.slice(seed.indexOf("const neonReels ="), seed.indexOf("const neonMines ="));
  assert.match(reelsBlock, /if \(neonReels\.activeVersionId === null\)/u);
  assert.doesNotMatch(reelsBlock, /data:\s*\{[^}]*status:\s*"ACTIVE"/u);
});
