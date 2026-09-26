# Neon Mines — Section 8: production-readiness result

## Decision

**Not ready to enable in production yet.** The source, tests and production images
are buildable, but this machine cannot supply evidence for staging load, physical
phones, Cloudflare Access, a real TLS origin, backup restore, monitoring alerts,
or operational reserves. Keep Neon Mines disabled until those checks are completed
and recorded by an operator.

## Completed in this section

- Production Compose renders successfully with the example environment.
- Player, admin, server and migration production images build from the pinned
  lockfile. The Docker context now excludes the local `.pnpm-store`; transfer fell
  from hundreds of MB to about 5.4 MB during the verified rebuild.
- Static production controls still verify private PostgreSQL networking, non-root
  runtime images, migration gating, TLS settings, hidden internal metrics, bounded
  logs, and isolated backup restore commands.
- The paid k6 profile now supports `GAME_SLUG=neon-mines`. With separate funded
  staging accounts, it exercises login, catalog, round start, one selection,
  conditional cash-out and wallet refresh. Start and action thresholds are p95
  below 500 ms and p99 below one second with under 1% failed requests.
- Section 12 ran that profile locally with 10 concurrent disposable players for
  all four difficulties. All four short runs passed with zero failed requests;
  the full persistence audit also passed. These local results do not replace the
  external, monitored staging ramp required for a capacity claim.
- Backend API tests, production-operation tests, TypeScript and the server bundle
  pass. Section 7 already ran transactional settlement races against an isolated
  PostgreSQL 18 database.
- Section 14 repeated the full workspace typecheck, lint, tests and production
  build, then reran every skipped transactional integration suite against a fresh
  isolated PostgreSQL database. The final local release gate passed; remaining
  launch gates are external and are listed in its evidence record.
- Readiness now checks for the required GameSession and GameSessionState schema;
  dependency/schema failure returns HTTP 503 without leaking the internal error.

No public deployment, production database migration, load traffic or game
activation occurred.

## Local development finding

The running development API initially used an old image that did not contain the
Neon Mines workspace package. It was rebuilt and now starts. The existing local
development database has not received the Mines migration, so expiry reports the
missing `GameSessionState` table. The stricter readiness endpoint intentionally
reports this stack as not ready until migrations are applied. The database was not
modified automatically because applying a migration is a deliberate operator step.

Before testing Mines locally, back up any valuable development data, then run the
normal development migration command and rebuild/restart affected containers. The
migration creates the game disabled; enable it from admin only after creating a
test player and confirming its wallet is disposable.

## Remaining launch gates

1. Deploy to a staging host using real HTTPS hostnames and Cloudflare Access on the
   admin hostname. Confirm direct-origin and public admin API access are denied.
2. Run the player and admin journeys on representative iOS Safari and Android
   Chrome devices in portrait and landscape, including refresh, disconnect,
   reconnect, timeout and wallet updates.
3. Install k6 on a separate load generator. Run every Mines difficulty at 10, 25,
   then 50 concurrent funded staging players. Do not claim a capacity number until
   thresholds pass while CPU, memory, event-loop, PostgreSQL and expiry backlog are
   monitored. The local Section 12 measurement is regression evidence only.
4. After each load run, verify one entry debit per round, at most one reward,
   wallet balance continuity, no stuck active sessions and no expiry backlog.
5. Perform and document an off-server backup plus isolated restore; test the
   rollback plan for the exact release migration.
6. Configure alerts for readiness, 5xx, latency, memory/OOM, disk, backup age,
   container restarts, security events and Mines expiry failures.
7. Confirm least-privilege database/cloud credentials, Cloudflare trusted IP lists,
   firewall rules, retention policy, payout reserve, redemption controls and all
   applicable legal/compliance requirements.
8. Obtain independent security/fairness review appropriate to the product. The
   game must not be represented as provably fair under the current design.

Only after all gates pass should an authorized admin activate Neon Mines. Start at
low wager/payout limits, monitor real RTP and settlement errors, and retain an
immediate Maintenance switch. Passing these checks cannot guarantee zero defects
or business profit.
