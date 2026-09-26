# Neon Mines — Section 14: final local release gate

## Result

The local release-candidate gate passed on 2026-09-05. Neon Mines is locally
implemented, type-safe, lint-clean, buildable, transactionally tested, browser
verified and load-profiled. It remains disabled and is not yet approved for a
production launch because the remaining gates require external infrastructure,
physical devices or business authorization.

## Verification completed

- `pnpm typecheck` passed across all 11 code projects.
- `pnpm lint` passed across all 11 code projects.
- The complete workspace test command passed with 108 ordinary test reports. Its
  seven database-backed tests were skipped because the live development database
  was intentionally not used as a destructive test target.
- A dedicated PostgreSQL database named
  `neon_mines_section4_release_gate_20260905` was created, received all 17
  migrations, and was seeded with disposable data.
- The database-backed suites were then run sequentially against that database:
  Mines durability/recovery/concurrency reported 11 passing tests and subtests;
  Neon Reels duplicate settlement reported one; wallet locking reported one; and
  player deletion/retention/session cleanup reported four. None were skipped.
- The complete production build passed for shared packages, both games, database
  client generation, the server bundle, player Next.js application, and admin
  Next.js application when run with the production environment used by the
  production image.
- The latest production-operations checks passed separately, including the
  Section 13 staging runner and settlement gate.
- `git diff --check` passed. Line-ending notices from the Windows checkout were
  informational and did not identify whitespace errors.

The first build invocation inherited `NODE_ENV=development` from the running
development container. Next.js warned that this was invalid for a production
build and failed during prerendering. Repeating the build with
`NODE_ENV=production`—the value used by the production deployment—passed both web
applications. No application change was needed for that environment mismatch.

After testing, the exact disposable database was dropped and its absence was
verified. The normal development database was not used for integration-test
mutations.

## Remaining external gates

No additional local coding section can honestly complete these checks:

1. Deploy the release candidate to a production-like staging VPS with real TLS,
   private PostgreSQL networking, Cloudflare Access on administration, trusted
   proxy configuration and direct-origin firewall enforcement.
2. Run the Section 13 matrix from a separate load generator at 10, 25 and 50
   concurrent players for every difficulty while capturing VPS and PostgreSQL
   resources. Pass the settlement SQL audit after the run.
3. Test representative physical iOS Safari and Android Chrome devices in portrait
   and landscape, including browser chrome, reconnect, refresh, timeout and live
   wallet updates.
4. Create an off-server backup, restore it into isolation, and rehearse the exact
   release rollback procedure.
5. Connect and exercise alerts for readiness, 5xx rate, latency, event-loop and
   memory pressure, disk, container restarts, PostgreSQL health, backup age,
   security events and Mines expiry failures.
6. Obtain the required independent security/fairness review and confirm legal,
   redemption, reserve, credential and operating-limit decisions.

Neon Mines must remain disabled until an authorized operator records successful
evidence for all applicable gates. Passing the local gate does not predict a VPS
capacity number, guarantee profitability or eliminate operational risk.
