# Game platform foundation

The platform separates durable catalog/session facts from game implementations.
PostgreSQL stores games, immutable versions, session lifecycle transitions,
participants, entry amounts, idempotency keys, and an optional server-instance
owner. Neon Reels settles every spin atomically, so it has no client-owned or
in-memory authoritative state.

## Versioned registration

`GameRegistry` resolves an exact `slug@version`. The public lobby includes only
database-active games whose exact implementation is loaded in the process.
This prevents an enabled database row from advertising code the server cannot
execute. Every durable session snapshots both the version row and version
string; a deferred database trigger verifies they agree.

## What could go wrong, and how it is prevented

- A player targets another game: the requested game ID and loaded implementation are checked server-side.
- Requests are replayed: every paid spin requires a player-scoped idempotency key.
- Concurrent spins race: the player wallet row is locked during entry and reward settlement.
- Old sessions change meaning: exact semantic versions are persisted and resolved.
- A server advertises missing code: catalog rows are filtered through the runtime registry.
- Client results are forged: the server creates the reels, payout, session, and ledger records in one transaction.
