# Neon Dice local deployment record

Deployment date: 2026-09-28 (Asia/Katmandu)

## Result

Neon Dice `1.0.0`, configuration revision `1`, is active in the local environment. The active wager bounds are 50–3000 minor units (0.50–30.00 coins), with the configured wager set of 0.50, 1, 2, 5, 10, 20, and 30 coins.

## Recovery point

Before applying the migration, the local application database was backed up to:

`D:\Productions\game\backups\local-pre-neon-dice-20260928.dump`

SHA-256: `A42DC2380859A0A7149F317FD0F9EBE0499B8B33ACA742439BCEAEBC8E1DA14C`

The dump was restored into a disposable database and queried successfully before that database was removed.

## Migration and activation

- Applied migration: `20260928000000_neon_dice_foundation`
- Initial catalog state: `DISABLED`
- Activation state: `ACTIVE`
- Activation used the authenticated admin API and created a `GAME_STATUS_CHANGED` audit record.
- Activation reason: `Neon Dice local launch after verified backup, migration, builds, health checks, and settlement tests`

## Verification

- Server, player web, and admin web production images rebuilt successfully.
- Server API suite: 27 passed, 8 database-dependent tests skipped in the non-database invocation, 0 failed.
- The dedicated Dice repository integration test passed earlier against a disposable real PostgreSQL database.
- Player, admin, game-engine, package, migration, and build checks passed in the launch-readiness run.
- Live service checks returned HTTP 200 for the server readiness endpoint, player web, and admin web.
- Final database verification found one applied Dice migration and no remaining `dice_smoke_%` disposable accounts.

## Live API smoke test

An audited disposable player was created, funded with 100.00 coins, used for three 0.50-coin rounds, and deleted through the admin API.

- Active Dice catalog entries: 1
- Selections covered: `UNDER_7`, `EXACTLY_7`, `OVER_7`
- Completed Dice sessions: 3
- Game-entry ledger debits: 3
- Wallet balance reconciled exactly against the ledger
- Player deletion preview succeeded
- Disposable player deletion succeeded

During the first smoke attempt, PowerShell attached form encoding to a bodyless POST. The server correctly treats unsupported request media types as HTTP 415 after the error-mapping regression fix; the browser client sends no content type for a bodyless preview request. Regression coverage was added to prevent this client error from being reported as HTTP 500.

## Player-facing visual QA

The live player experience was exercised in the in-app browser at the normal desktop viewport and at a 390×844 mobile viewport.

- Lobby presentation, Dice start dialog, game stage, dice faces, authoritative result, and responsive controls rendered correctly.
- Prediction switching, wager stepping, two live settlements, wallet refresh, and mute/unmute controls worked.
- The browser console contained no errors or warnings after the completed flow.
- The exact disposable visual-QA player was removed through the audited admin API.

The first visual pass exposed that the public game-catalog response schema serialized each game configuration as an empty object. That forced the UI to show generic fallback wagers, including invalid 0.10- and 50-coin options for Dice. The response schema now explicitly preserves configuration properties, with regression coverage proving that Dice denominations reach the browser. The corrected live dialog exposes only 0.50, 1, 2, 5, 10, 20, and 30 coins.

## Rollback

Follow the rollback procedure in `docs/neon-dice-launch-runbook.md`. Disable the game through the audited admin API before any database restoration. Database restoration is only necessary for a full local rollback and must use the verified backup above.
