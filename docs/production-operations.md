# Production operations

The initial production topology is Cloudflare → Nginx → Next.js/Fastify → PostgreSQL on one Ubuntu VPS. Only Nginx publishes host ports. The application and database use a private Docker network, and PostgreSQL has no host port mapping.

## VPS baseline

Use Ubuntu LTS with at least 2 vCPU, 4 GB RAM, NVMe storage, and a non-root sudo operator. Before deployment:

1. Install Docker Engine and the Compose plugin from Docker's official repository.
2. Enable automatic Ubuntu security updates and schedule reboots deliberately.
3. Configure SSH keys, disable password/root SSH login, and enable a firewall.
4. Allow SSH from operator addresses. Allow TCP 80/443 only from Cloudflare's published IP networks; deny all other inbound traffic.
5. Do not install PostgreSQL on the host and never publish container port 5432.

Cloudflare must proxy both `PLAYER_HOSTNAME` and `ADMIN_HOSTNAME`, use SSL/TLS **Full (strict)**, enable WebSockets for the player hostname, and use a Cloudflare Origin CA certificate covering both names. Place its certificate and key at:

```text
infrastructure/secrets/cloudflare-origin.pem
infrastructure/secrets/cloudflare-origin-key.pem
```

The included Nginx trusted-proxy list must be compared periodically with Cloudflare's current IPv4/IPv6 lists. Direct-to-origin traffic must remain firewall-blocked.

The administrator hostname is private. Before enabling it in production, create
a Cloudflare Access self-hosted application for `ADMIN_HOSTNAME`, allow only the
operator identities used by the business, require MFA at the identity provider,
and deny all other identities. The application-level administrator login and
permissions remain required behind Access; Access is an additional perimeter,
not a replacement. Never publish the admin origin outside Cloudflare or bypass
Access with a public DNS-only record.

## First deployment

```bash
cp .env.production.example .env.production
chmod 600 .env.production infrastructure/secrets/cloudflare-origin-key.pem
chmod +x infrastructure/scripts/*.sh
./infrastructure/scripts/deploy.sh
```

Generate `POSTGRES_PASSWORD` as at least 32 cryptographically random hexadecimal characters (URL-safe for `DATABASE_URL`) and never place the real value in version control, images, command-line arguments, or chat. The production Compose file:

- builds immutable production images;
- runs Prisma migrations as a one-shot service;
- starts Fastify only after migrations succeed;
- starts Nginx only after player-web, admin-web, and API health checks pass;
- runs application containers read-only and without privilege escalation;
- sets memory/CPU ceilings suitable for the initial VPS;
- rotates container JSON logs.

After each release, check:

```bash
docker compose --env-file .env.production -f compose.production.yaml ps
curl --fail https://PLAYER_HOSTNAME/health/ready
docker compose --env-file .env.production -f compose.production.yaml logs --since=10m migrate server web admin-web nginx
```

Deployments should be made from a reviewed commit or release tag. Take a database backup before any migration. Roll back application images only when the deployed database migration is backward-compatible; otherwise follow a migration-specific recovery plan. Never blindly roll back a financial schema.

## Backups and recovery

Run `backup-postgres.sh` nightly from a systemd timer. It creates a compressed custom-format dump, validates its catalog, writes a SHA-256 checksum, and retains 14 days by default.

```ini
# /etc/systemd/system/game-platform-backup.service
[Service]
Type=oneshot
User=gameops
WorkingDirectory=/opt/game-platform
ExecStart=/opt/game-platform/infrastructure/scripts/backup-postgres.sh
```

```ini
# /etc/systemd/system/game-platform-backup.timer
[Timer]
OnCalendar=*-*-* 02:15:00 UTC
Persistent=true
RandomizedDelaySec=15m
[Install]
WantedBy=timers.target
```

Copy every successful dump and checksum off-server to an encrypted, versioned object store using a separately configured tool such as restic or rclone. Recommended retention is 14 daily, 8 weekly, and 12 monthly copies. Restrict deletion credentials so compromise of the VPS cannot erase all backup generations.

At least monthly, download an off-server copy and perform a real isolated restore test:

```bash
sudo -u gameops ./infrastructure/scripts/verify-backup.sh /var/backups/game-platform/postgres-TIMESTAMP.dump
```

The verifier checks the checksum, creates a uniquely named temporary database, restores with `--exit-on-error`, queries the Prisma migration table, and removes only that temporary database. A production restore is an incident operation: stop Nginx/server, preserve the failed database, restore into a new database, verify ledger invariants and migrations, then switch `DATABASE_URL`. Do not use `pg_restore --clean` against the only production copy.

## Observability and alerts

Nginx and Fastify emit structured logs to stdout with request IDs and durations. Docker rotates them. Fastify redacts cookies, authorization headers, passwords, and tokens. `/internal/metrics` exposes Prometheus text for uptime, request/error counts, cumulative latency, and resident memory; Nginx deliberately returns 404 for this route. A future host-local Prometheus agent can scrape it over the private network.

Alert initially on:

- readiness failures for two minutes;
- 5xx rate above 1%;
- p95 HTTP latency above 500 ms;
- disk usage above 75%;
- PostgreSQL backup failure or backup age above 26 hours;
- container restart loops;
- memory pressure or OOM termination;
- HIGH/CRITICAL `SecurityEvent` growth.

Never include session cookies, passwords, database URLs, or full user-submitted payloads in logs or alert notifications.

## Load and capacity checks

Install k6 on a separate machine and run:

```bash
k6 run -e ORIGIN=https://YOUR_DOMAIN infrastructure/load/k6-smoke.js
```

The smoke profile ramps to 50 concurrent clients and checks readiness, WebSocket handshake handling, error rate, and p95 HTTP latency. Run gameplay load tests with dedicated non-production accounts before increasing capacity. Record CPU, memory, event-loop delay, WebSocket latency, PostgreSQL latency, message rate, and errors; do not infer capacity from request counts alone.

Run the paid gameplay profile only against a staging environment or a deliberately funded, disposable load-test player. It creates real game sessions and wallet ledger entries:

```bash
k6 run -e ORIGIN=https://STAGING_DOMAIN -e PLAYER_USERNAME_PREFIX=load-player- -e PLAYER_PASSWORD='LOAD_TEST_PASSWORD' -e CONCURRENT_PLAYERS=25 infrastructure/load/k6-gameplay.js
```

Create and fund one disposable staging account per virtual user (`load-player-1`, `load-player-2`, and so on) so the test measures concurrent customers instead of intentionally contending on one wallet lock. The profile defaults to Neon Reels. For Neon Mines on staging, enable it there only and add `-e GAME_SLUG=neon-mines -e MINES_DIFFICULTY=EASY`. The profile starts a real round, selects one tile, cashes out a safe result, and refreshes the wallet. A mine result is an expected successful settlement. Increase `CONCURRENT_PLAYERS` gradually and require start/action p95 below 500 ms, p99 below 1 second, fewer than 1% failed requests, and no wallet or ledger invariant failures before raising production capacity. Run each Mines difficulty separately and confirm result and ledger uniqueness after every run.

For the complete 10/25/50-player Mines matrix, resource capture, rate-limit-safe
authentication ramp and mandatory settlement audit, follow
[`docs/neon-mines-staging-load-runbook.md`](neon-mines-staging-load-runbook.md).

## What could go wrong, and how it is prevented

- **PostgreSQL becomes internet-accessible:** production Compose only exposes it on the private network and the host firewall denies it.
- **A release starts against an old schema:** the migration gate must complete before Fastify starts.
- **Spoofed forwarding headers bypass rate limits:** only Nginx is exposed, Nginx trusts documented Cloudflare networks, and the firewall blocks direct origin traffic.
- **A compromised container changes application files:** application containers are non-root, read-only, and use `no-new-privileges`.
- **Logs fill the VPS or leak credentials:** bounded rotation and Fastify redaction are configured.
- **A backup is corrupt or exists only on the failed VPS:** dumps are checksummed, copied off-server, retained in generations, and restored monthly.
- **WebSocket sessions duplicate settlement during disconnects or shutdown:** database idempotency and unique settlement constraints remain authoritative; startup recovery abandons/refunds interrupted sessions exactly once.
