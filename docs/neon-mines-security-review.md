# Neon Mines — Section 7: fairness and security review

## Scope and outcome

Reviewed the Mines engine, exact payout arithmetic, request contracts, HTTP routes,
durable repository, wallet transaction boundaries, production wiring, and existing
authentication/rate-limit configuration. This is an internal code review with
regression tests, not independent certification or approval for production.

### Fixed: unreachable restored rounds

Snapshot restoration previously checked reward arithmetic and several state
invariants but did not prove that every safe selection was reachable under the
saved payout/multiplier caps. A corrupted terminal snapshot could contain an
arithmetically correct reward beyond a prior automatic cash-out stop. A mine-hit
snapshot could also represent a move after that stop.

Restoration now checks each prior selection against the liability rules, rejects
active/mine-hit states after automatic completion, and requires automatic rather
than manual completion at the limit. Regression tests cover these cases and verify
that legitimate restored paths still work. This is defense against corrupted
stored state; no player-facing snapshot-write API was found. It is not protection
against a fully privileged database or application-server attacker.

## Fairness findings

- Production constructs the repository without injected test randomness. Mine
  placement uses Node `crypto.randomInt` and a partial Fisher–Yates shuffle, then
  persists the board before returning the start. It does not relocate mines in
  response to player choices. Node documents that `randomInt` avoids modulo bias:
  [official crypto reference](https://nodejs.org/api/crypto.html#cryptorandomintmin-max-callback).
- An exhaustive Easy-mode test enumerates all 13,800 ordered random-index choices.
  Each of the 2,300 possible three-mine boards occurs exactly six times. The same
  shuffle algorithm handles other mine counts; this is not a statistical
  certification of the operating system's entropy source.
- Exact-integer tests cover all launch difficulties, wagers, and cash-out depths.
  Expected gross return at a fixed reachable cash-out depth is at most 96% of
  wager, with downward cent rounding. A 4% theoretical edge is not guaranteed
  profit on any particular round or day. Untouched expired rounds lose the entry.
- Legal play paths, manual cash-out, automatic cash-out, loss and restore tests
  retain the same board and enforce both absolute and multiplier caps.
- Hidden mines stay out of active public state. Completed boards are revealed.
  There is no pre-round commitment plus player-verifiable reveal protocol: do
  not label this implementation “provably fair.” Adding that protocol would be
  a separate design/versioning task.

## Request and money safeguards

Strict request parsing rejects client boards, rewards, extra fields, fractional
tile indices and coercion. Authentication and player ownership are checked before
game commands. Starts and commands are limited to 120 requests/minute per account
per server process. Production cookies are HttpOnly, Secure, host-scoped and
SameSite=Strict; CORS is configured for the web origin. These controls do not
replace a deployment-specific origin/CSRF, proxy, or denial-of-service review.

The repository takes account then wallet row locks and stores state, result and
wallet updates in one transaction. Starts are idempotent. Command IDs and sequences
prevent replayed moves; terminal rewards use a unique settlement key. Existing
rounds retain their original configuration. Expiry uses the same transactional
settlement and can pay earned progress for disabled players.

## Verification performed

- 21 engine/math/configuration/security tests.
- 3 strict request-contract tests.
- 21 application/API tests.
- 10 PostgreSQL integration scenarios (11 test-runner entries including the parent),
  all on an isolated PostgreSQL 18 container and newly migrated disposable database.
  These include simultaneous starts, cash-out retries, ownership, sequence races,
  forced settlement rollback, admin wallet adjustments, configuration preservation,
  and concurrent expiry/cash-out/start replay.
- Server and Mines TypeScript checks and server production bundle.

No application database migration, game activation or deployment was performed.
The PostgreSQL driver emitted a concurrent-query deprecation warning during the
integration suite; tests passed on the installed driver. Trace and resolve the
origin before upgrading to a driver version that removes that behavior.

## Next section: production readiness

Still required: physical-phone/live admin-to-player testing, representative load
and latency tests, distributed abuse controls if running multiple servers, expiry
backlog monitoring, backup/restore verification, least-privilege database access,
operational reserve review, and applicable independent/compliance review before
redeemable-money launch. A privileged operator can access private boards in the
database; backups and database credentials must be treated as sensitive.

Keep Mines disabled until the remaining launch checks are accepted. These results
do not establish a supported concurrent-player count or guarantee absence of bugs.
