# Neon Mines — Section 13: monitored staging load runbook

## Purpose

This section converts the local Section 12 check into a repeatable, fail-closed
staging procedure. It does not deploy, enable the game, create players, fund
wallets, or approve capacity automatically.

Use a production-like staging VPS and a separate load-generator machine. Create
and fund at least 50 disposable players named with one common prefix followed by
`1` through `50`. Confirm redemptions are unavailable for those accounts. Take a
database backup, record the current deployment revision, and leave enough wallet
balance for every paid iteration before starting.

## Capture VPS resources

On the staging VPS, from the deployment directory, start this in a separate shell:

```bash
OUTPUT_FILE=/var/tmp/neon-mines-load-metrics.txt \
DURATION_SECONDS=7200 \
INTERVAL_SECONDS=5 \
bash infrastructure/scripts/capture-production-load-metrics.sh
```

The output is created with owner-only permissions. It samples Docker CPU, memory,
network, block I/O and process counts; private application metrics; and PostgreSQL
connections, transactions, cache reads/hits and database size. Choose a duration
that covers the entire suite. Copy the artifact off the VPS with the k6 results,
then remove it according to the retention policy.

## Run the staged workload

On the separate load generator with `curl` and k6 installed:

```bash
export ORIGIN=https://staging-player.example.com
export PLAYER_USERNAME_PREFIX=load-player-
read -rs PLAYER_PASSWORD && export PLAYER_PASSWORD
export ALLOW_PAID_LOAD_TEST=I_UNDERSTAND_THIS_SPENDS_TEST_COINS
export RESULTS_ROOT="$PWD/load-results"
bash infrastructure/load/run-neon-mines-staging.sh
```

Defaults run Easy, Medium, Hard and Expert at 10, 25 and 50 concurrent players,
with a two-minute peak hold. The runner requires HTTPS and a readiness pass before
spending coins. It preserves the public limit of 10 logins per source IP per
minute by allowing seven ramp seconds per player and waiting 60 seconds between
profiles. A failed k6 threshold stops the suite immediately. Passwords are neither
written to the manifest nor echoed by the runner.

For a first rehearsal, override `CONCURRENCY_STEPS="10"` and use a staging-only
origin. `ALLOW_INSECURE_ORIGIN=yes` exists only for an isolated local test and must
not be used for a remote VPS.

## Audit settlement

Use the `suite_started_at` value in the generated `manifest.txt`. From a trusted
host that can reach the staging database, run:

```bash
psql "$DATABASE_URL" \
  -v username_prefix='load-player-' \
  -v since='2026-09-05T00:00:00Z' \
  -f infrastructure/load/neon-mines-settlement-audit.sql
```

The audit fails if it finds no matching rounds, any non-completed round, a missing
or duplicate result, a participant mismatch, an incorrect entry debit, an
incorrect reward, or a wallet that disagrees with its complete ledger. Do not
approve a capacity increase unless both k6 and this audit exit successfully.

## Capacity decision and cleanup

For every concurrency step, review p95/p99 latency, errors, container throttling,
memory headroom, PostgreSQL connection use/cache behavior, database growth and
expiry failures. A passing request rate without safe resource headroom is not a
capacity pass. Repeat longer if the sample is too short to include normal traffic
variation.

After review, disable Neon Mines in staging and delete the disposable players
through the audited administrator deletion action. Confirm zero matching players,
zero active test sessions and no remaining authentication sessions. Retain only
the load summaries, resource evidence, settlement result and cleanup audit needed
by policy—never retain the test password.
