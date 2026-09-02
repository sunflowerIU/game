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
