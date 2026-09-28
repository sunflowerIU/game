# Neon Dice — Section 4: request contract and atomic settlement

Section 4 adds the paid backend path for Neon Dice. It does not enable the game
or add player/admin interfaces, animation, music, or release approval.

## Start contract

Neon Dice uses the existing authenticated endpoint:

```text
POST /api/v1/games/:gameId/sessions
Idempotency-Key: 16–80 allowed characters
```

The exact request body is:

```json
{
  "entryAmount": 500,
  "selection": "EXACTLY_7"
}
```

`entryAmount` is integer cents. `selection` is exactly `UNDER_7`, `EXACTLY_7`,
or `OVER_7`. Missing fields, unknown fields, coercible strings, client dice,
totals, multipliers, win flags, and rewards are rejected. Mines retains its
difficulty contract and Reels retains its wager-only contract.

## Transaction boundary

One PostgreSQL transaction performs the complete roll:

1. Locate and lock the player's wallet row.
2. Re-check the player-scoped start idempotency key under the lock.
3. Reject a reused key when game, wager, or Dice selection differs.
4. Resolve the active exact Dice version and validate its immutable configuration.
5. Reject an unavailable denomination, insufficient balance, or another active
   game session.
6. Generate both dice and recompute all result and reward facts server-side.
7. Create the active session and participant.
8. Debit one `GAME_ENTRY` ledger row.
9. Credit at most one `GAME_REWARD` ledger row for a win.
10. Store the authoritative result and complete the session.

Any failure rolls back the session, result, wallet changes, and ledger rows.
Wallet locking serializes distinct simultaneous starts, so two wagers cannot
spend the same balance. A duplicate request returns the original completed roll
and never generates new dice. The original result remains replayable while the
game is in maintenance or disabled because availability changes must not defeat
network retry safety.

## Stored and public result

The durable result contains both dice, total, selection, applied multiplier,
win flag, and reward. Loading a result recomputes the total, winning condition,
multiplier, and reward from its immutable version configuration. A disagreement
between result details and the `GameResult` score/reward is treated as corrupted
state rather than returned to the player.

The response public state contains the same completed, non-secret outcome with
amounts encoded as decimal strings. `nextSequence` remains 1 for compatibility,
but Dice has no follow-up command or resumable active state.

## Verification

Contract tests reject coercion, unknown selections, mixed Mines/Dice fields, and
client-supplied outcome data. The PostgreSQL integration test uses a freshly
migrated disposable database and verifies duplicate concurrency, one debit and
at most one reward, selection-aware idempotency conflict, maintenance replay,
zero-reward loss settlement, failed-result rollback, and wallet locking when two
distinct wagers compete for one available balance.
