# Neon Dice — Section 8: launch and recovery runbook

Neon Dice is implemented and launch-ready, but its catalog record intentionally
remains `DISABLED`. Enabling it is a separate operator decision after the
deployment checks below.

## Verified launch baseline

- Version: `1.0.0`, configuration revision 1 or a later audited revision.
- RTP: 95% for Under 7, Exactly 7, and Over 7.
- Gross multipliers: 2.28×, 5.70×, and 2.28×.
- Supported wagers: a non-empty subset of 0.50, 1, 2, 5, 10, 20, and 30 coins.
- Maximum configured wager: 30 coins.
- Hard maximum gross payout: 200 coins.
- Required reserve at the 30-coin maximum: at least 171 coins per winning roll.
- Every roll settles atomically and reaches a terminal session state.

## Deployment gate

1. Take and verify a database backup using the existing backup/restore tooling.
2. Deploy the server, player web app, and administrator web app from the same
   release so the API contract and interfaces stay aligned.
3. Run `pnpm db:deploy` with the production `DATABASE_URL`. Do not use a
   development migration command in production.
4. Confirm the `20260928000000_neon_dice_foundation` migration is successful.
5. Confirm Neon Dice is still `DISABLED` and version `1.0.0` has an active
   configuration pointer.
6. In Game controls, review enabled wagers and ensure the payout reserve covers
   the largest Exactly 7 win. Saving creates a new immutable revision.
7. Confirm available wallet liquidity and operational approval for the chosen
   maximum liability.
8. Change the game to `ACTIVE` through the administrator interface and record a
   specific audit reason.

## Post-enable smoke test

Use a designated test player with a known balance.

1. Confirm Neon Dice appears once in the player lobby with the expected minimum
   and maximum wagers.
2. Roll each market once at the minimum wager and confirm exactly one debit per
   roll.
3. Retry one completed request with the same idempotency key and confirm it
   returns the original result without a second debit or reward.
4. Roll the largest enabled wager and confirm the UI, session history, wallet,
   and ledger agree on entry and reward amounts.
5. Confirm every Dice session is `COMPLETED`; this game must never leave a
   `CREATED` or `ACTIVE` session behind.
6. Confirm mute persistence, mobile portrait, and short-landscape controls on a
   real browser.

## Monitoring

During the initial launch window, watch:

- non-2xx responses for the Dice start endpoint;
- `IDEMPOTENCY_CONFLICT`, `INVALID_ENTRY`, insufficient-balance, and settlement
  conflict errors;
- Dice sessions that are not terminal;
- duplicate ledger idempotency failures;
- game-entry and game-reward ledger totals; and
- payout frequency over a meaningful sample. Short runs can differ sharply
  from the theoretical 95% RTP and must not be treated as proof of a defect.

## Safe shutdown and recovery

1. Set Neon Dice to `MAINTENANCE` to stop new rolls during investigation, or
   `DISABLED` for a longer shutdown. Completed-request replays remain safe.
2. Do not delete sessions, ledger entries, results, or configuration revisions.
3. Reconcile each affected session against its entry and reward ledger records.
4. If settings caused the issue, create a new audited revision using a known
   safe wager subset and sufficient payout reserve; never edit an old revision.
5. Run the smoke test again before returning the game to `ACTIVE`.

## Section 8 verification evidence

The launch-readiness run used a fresh disposable PostgreSQL database, applied
all 20 migrations, and passed the real Neon Dice transaction integration test.
It produced three completed Dice sessions, zero active Dice sessions, and then
the disposable database was removed. The application database and live game
status were not changed.
