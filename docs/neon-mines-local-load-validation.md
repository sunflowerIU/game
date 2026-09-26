# Neon Mines — Section 12: local load validation

## Scope and decision

On 2026-09-05, the local Docker development stack passed a short representative
Neon Mines workload at 10 concurrent players for every difficulty. This is useful
regression and latency evidence, but it is **not a VPS capacity rating or a
production launch approval**. The traffic originated on the same computer as the
application and database, used development builds, and held peak load for only
eight seconds per profile.

The workload followed the player-facing same-origin route at
`http://host.docker.internal:3000`: login, catalog lookup, paid round start, one
tile selection, conditional cash-out, and wallet refresh. Each profile used ten
separately funded disposable players, a 0.10-coin wager, a two-second ramp, an
eight-second hold, a two-second ramp-down, and 0.1 seconds of think time.

## Passing measurements

| Difficulty | Completed iterations | Failed HTTP requests | Start p95 / p99 | Action p95 / p99 |
| --- | ---: | ---: | ---: | ---: |
| Easy | 306 | 0% | 111.04 / 145.47 ms | 102.58 / 160.75 ms |
| Medium | 356 | 0% | 85.52 / 108.92 ms | 77.98 / 96.73 ms |
| Hard | 356 | 0% | 85.18 / 110.96 ms | 80.33 / 100.44 ms |
| Expert | 379 | 0% | 80.13 / 104.13 ms | 80.94 / 101.86 ms |

All checks passed in every profile. The enforced gates were over 99% successful
checks, under 1% failed HTTP requests, game start and action p95 under 500 ms, and
p99 under one second. The four passing profiles completed 1,397 iterations.

## Harness defect found and fixed

The first diagnostic run authenticated once per virtual user but then returned
`401 AUTH_REQUIRED` after the first iteration. k6 resets its per-VU cookie jar at
each iteration by default, while the script retained an in-memory
`authenticated` flag. The profile now sets `noCookiesReset: true`, matching a real
browser session, and exports p99 trend statistics. A static operations test guards
both settings. This behavior is documented in the official
[Grafana k6 options reference](https://grafana.com/docs/k6/latest/using-k6/k6-options/reference/).

## Persistence audit and cleanup

The final audit included all 1,417 rounds created by both the diagnostic and
passing runs. It found:

- zero non-completed sessions or missing results;
- zero participant/owner mismatches;
- exactly one correct entry debit per round;
- no duplicate, missing, or amount-mismatched rewards; and
- zero wallet balances that disagreed with the sum of their ledger entries.

The ten disposable players and their related sessions, results, wallet entries,
login records, and security records were then removed through the application's
audited player-deletion transaction. Neon Mines and the disposable administrator
were returned to `DISABLED`, and the administrator's sessions were removed.

## What remains before a capacity claim

Run the same profile from a separate load generator against a production-like
staging VPS at 10, 25, and 50 concurrent players for materially longer holds.
Record CPU, memory, event-loop delay, PostgreSQL connections/query latency, disk
I/O, container restarts, 5xx responses, and the expiry backlog during each step.
Repeat the settlement audit after every run. The highest step that passes with
safe resource headroom—not this local result—sets the initial operating limit.
