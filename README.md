# Game Platform

Production-oriented foundation for a server-authoritative web game platform.
The repository currently contains the platform foundation, secure identity,
administrator player lifecycle, transactional wallet/ledger, and versioned
game-platform foundation, and the server-authoritative Neon Reels slot game.
Administrator platform operations cover game controls, inspections, and security monitoring.

## Prerequisites

- Node.js 24+
- pnpm 11+
- Docker with Docker Compose (optional)

## Run locally

```bash
cp .env.example .env
pnpm install
docker compose up -d postgres
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open the full-screen mobile game client at `http://localhost:3000` and the private administrator
website at `http://127.0.0.1:3001`. Using separate local hostnames keeps their
authentication cookies isolated. Both use same-origin API proxying; port 4000
is a loopback-only developer endpoint and is not a player-facing website.

## Run with Docker Compose

```bash
docker compose up --build
```

The development stack exposes the player website on port `3000`, the private
administrator website on port `3001`, and the API only on the loopback address
at port `4000`. PostgreSQL is also loopback-only. Production exposes only Nginx.

To create the first administrator, set both `BOOTSTRAP_ADMIN_USERNAME` and
`BOOTSTRAP_ADMIN_PASSWORD` in `.env`, then run `pnpm db:seed`. Seeding is
idempotent and never changes the password of an existing administrator.

## Verify

```bash
pnpm check
```

Architecture decisions and boundaries are documented in
[`docs/architecture.md`](docs/architecture.md).
Authentication design is documented in
[`docs/authentication.md`](docs/authentication.md).
Administrator player-management and audit guarantees are documented in
[`docs/admin-player-management.md`](docs/admin-player-management.md).
Wallet invariants and concurrency behavior are documented in
[`docs/wallet-ledger.md`](docs/wallet-ledger.md).
Game versioning and the authoritative protocol boundary are documented in
[`docs/game-platform-foundation.md`](docs/game-platform-foundation.md).
Neon Reels rules, payouts, and atomic spin settlement are documented in
[`docs/neon-reels.md`](docs/neon-reels.md).
Administrator game controls and inspection guarantees are documented in
[`docs/admin-operations.md`](docs/admin-operations.md).
Manual player deletion, retention cleanup, safeguards, and recovery guidance are documented in
[`docs/data-cleanup.md`](docs/data-cleanup.md).
Production deployment, backup, monitoring, and recovery procedures are in
[`docs/production-operations.md`](docs/production-operations.md).

The browser routes are:

- `http://localhost:3000` for the lightweight animated player login, lobby, wallet, and gameplay
- `http://127.0.0.1:3001` for private administrator sign-in
- `http://127.0.0.1:3001/dashboard` for authorized platform administration

Wallet API routes are:

- `GET /api/v1/wallet`
- `GET /api/v1/wallet/transactions`
- `POST /api/v1/admin/players/:playerId/wallet/credit`
- `POST /api/v1/admin/players/:playerId/wallet/debit`

Administrator wallet writes require an `Idempotency-Key` header.
Admin wallet values are entered and displayed as coins (`1 coin = $1.00`). The
database and APIs use integer cents internally: crediting `10` coins stores
`1000`, and a `0.1`-coin wager deducts `10`, leaving `9.90` coins after a loss.

The game foundation exposes:

- `POST /api/v1/games/:gameId/sessions` with an `Idempotency-Key` header
- `GET /api/v1/game-sessions`
- `GET /api/v1/game-sessions/active`
- The player experience is a single full-screen application; legacy `/login`, `/games`, `/wallet`, and game-detail URLs redirect to its root.

Platform administration adds:

- `GET /api/v1/admin/games`
- `POST /api/v1/admin/games/:gameId/status`
- `POST /api/v1/admin/games/:gameId/configuration`
- `GET /api/v1/admin/game-sessions`
- `GET /api/v1/admin/security-events`
- `GET /api/v1/admin/players/:playerId/details`

## Production deployment

Copy `.env.production.example` to `.env.production`, install a Cloudflare Origin CA certificate under `infrastructure/secrets`, and follow the production operations runbook. The production stack is intentionally separate from the development `compose.yaml`:

```bash
./infrastructure/scripts/deploy.sh
```
