# Neon Mines persistence and API contract

Sections 3 and 4 define storage, the wire contract, and its transactional backend implementation. These endpoints are now registered in the server source. The game remains disabled until its UI and launch verification are complete.

## Storage

`GameSession` remains the owner of identity, immutable `GameVersion`, wager, lifecycle, and optimistic `stateVersion`. `GameResult` remains the terminal result and reward record.

`GameSessionState` has a one-to-one foreign key to `GameSession` and contains:

- `engineSnapshot`: server-private JSON produced by the engine, including the hidden mine layout.
- `lastSequence`: the last accepted player command, initially zero.
- `lastCommandId` and `lastCommandFingerprint`: the last accepted command identity and a SHA-256 fingerprint of its canonical sequence and payload.
- `expiresAt`: the server-controlled expiry deadline; null for a terminal round.
- Creation/update timestamps.

Each accepted action overwrites this row. There is no separate row for every tile. This still requires a durable write per accepted move; bounded storage does not eliminate write load. PostgreSQL vacuum remains necessary to reclaim old row versions from updates.

The row is retained with its session, including terminal snapshots, to support the latest-command retry and inspection. Deleting the parent session cascades to its private state, so existing authorized player/session cleanup also removes it. Existing active-session cleanup protections remain in force. Never send this row directly to clients or include its contents in application logs.

The migration and seed create Neon Mines version `1.0.0`, revision 1, **disabled**. Re-running the seed does not activate it or reset its current version. Configuration values match the Section 1 math model. Restoring a round must use its original `GameVersion.configuration`, never the currently active configuration.

## HTTP interface

All routes require an authenticated player. Session lookup is scoped to that player; another player's session must not be disclosed. Amounts are integer cents: request wagers are JSON numbers, while response amounts are decimal strings like the existing platform APIs.

| Operation | Route | Request/response contract |
|---|---|---|
| Start | `POST /api/v1/games/:gameId/sessions` | `StartNeonMinesSessionRequest` / `NeonMinesSessionResponse` |
| Select tile or cash out | `POST /api/v1/game-sessions/:sessionId/commands` | `NeonMinesCommandRequest` / `NeonMinesCommandResponse` |
| Resume | `GET /api/v1/game-sessions/active` | `ActiveNeonMinesSessionResponse` when the active game is Mines |
| History | `GET /api/v1/game-sessions` | Existing `GameHistoryResponse` |

Start requires `Idempotency-Key` using the existing 16–80 character API format. The body is `{ "entryAmount": 100, "difficulty": "EASY" }`. The server validates the configured denomination and difficulty wager ceiling before charging. Neon Reels retains its existing start body without a difficulty; the server dispatches by the stored game slug.

A command body is:

```json
{
  "commandId": "2c84e3d5-4ba7-49ec-9c57-70ea25f30131",
  "sequence": 1,
  "payload": { "action": "SELECT_TILE", "tile": 7 }
}
```

Cash-out uses `{ "action": "CASH_OUT" }` as its payload. Tile indices are 0–24. Unknown fields and client-provided rewards/boards are rejected; validators never coerce strings into numbers.

Responses contain `session`, `publicState`, `nextSequence`, `expiresAt`, and `replayed`. Command responses additionally identify `acceptedSequence`. Private snapshots and authoritative results are excluded. The UI derives changes from public state; this contract does not require a WebSocket or an event history.

## Retry and concurrency guarantees

1. Start replay is scoped to player and start key. A changed game, wager, or difficulty using the same key is an idempotency conflict, not a new charge.
2. A new command must have `sequence = lastSequence + 1`. Ownership is checked and requests are serialized with database account-then-wallet row locks before reading session state. This protects all a player's sessions across server instances, not only an in-process queue.
3. Repeating the latest command ID, sequence, and canonical payload returns the latest stored state with `replayed: true`. It does not perform another action or settlement. If an expiry has subsequently completed the round, return that current terminal state.
4. Reusing the latest command ID with different data is an idempotency conflict. Older sequences or skipped sequences are conflicts; the client resumes to obtain current state. Only the latest command fingerprint is stored, so arbitrary historical command replay is not promised.
5. Commit the snapshot, last-command metadata, parent `stateVersion`, and any terminal result/reward atomically. Do not acknowledge a move before commit. A failed transaction must not leave an in-memory engine ahead of durable state.
6. Terminal rounds reject new actions. Expiry cashes out safe progress or abandons an untouched round. The deadline is 15 minutes after start or the last accepted move; a retry or resume does not extend it. Start replay, command, and resume check expiry inline. A non-overlapping server sweep also checks at startup and every 30 seconds, processing up to 50 rounds per sweep. A failed candidate is reported without preventing attempts to settle the rest of its batch. Pending work survives server restarts. Disabled players and games in maintenance still receive any earned expiry payout.

Malformed requests return `400`; missing or unowned sessions return `404`; state, sequence, and idempotency conflicts return `409`; insufficient balance returns `422`; throttling returns `429`. All use the platform's existing `ApiErrorResponse` envelope. A rejected action consumes neither a sequence nor a wallet transaction.

## Verification

Contract tests cover strict shapes, integer units, difficulty names, UUID normalization, and sequence bounds. Migration tests check SQL invariants. `packages/database/test/neon-mines-state.sql` exercises actual PostgreSQL constraints, updates, and cascade behavior against a migrated disposable database; it rolls back its fixture.

Section 4 PostgreSQL tests exercise simultaneous starts and cash-outs, conflicting sequences, ownership, zero-payout losses, forced settlement failure and rollback, configuration-version preservation, concurrent admin credit, and expiry. They require `TEST_DATABASE_URL` to identify a disposable database named `neon_mines_section4_*`. No test migration is applied to the application database.

## Deployment and remaining work

Before running the updated backend, install workspace dependencies, apply the prepared migrations, and regenerate Prisma. Docker development also requires rebuilding the server image for its new workspace dependency; the Mines source mount and both Docker build manifests have been added. Do not enable Neon Mines yet: the player UI is Section 5, followed by admin, fairness/security, and production verification.

The server commits only one entry debit and, when positive, one terminal reward credit. Safe tile selections do not generate wallet ledger entries. Public responses exclude private snapshots. Start/command limits are 120 requests per minute per authenticated account per server process; distributed abuse controls remain part of production hardening. The existing wallet API remains the balance source for the future Mines UI.
