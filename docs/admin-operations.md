# Administrator platform operations

Section 7 extends the administration workspace beyond account lifecycle management. Authorized administrators can change game availability, create configuration revisions, inspect game sessions and results, review security events, and inspect a player's recent login, ledger, and gameplay activity.

## Authorization and auditing

- `GAME_VIEW` protects game and session inspection.
- `GAME_MANAGE` protects status and configuration changes.
- `SECURITY_VIEW` protects security events and the immutable administrator audit stream.
- `PLAYER_VIEW` protects aggregated player details.

Every game write requires a human reason and stores before/after snapshots, administrator identity, source IP, user agent, timestamp, and a typed `GAME` target. The database check constraint guarantees that an audit row targets exactly one account or one game. Audit rows remain protected by the existing update/delete rejection trigger.

## Immutable configuration revisions

A configuration edit never updates an existing `GameVersion`. It creates the next `configurationRevision` for the same executable version and atomically switches the game's active-version pointer. Existing sessions retain their exact `gameVersionId`, so historical results always refer to the rules that produced them. Concurrent revision attempts collide on the unique `(gameId, version, configurationRevision)` key and are surfaced as a reload-and-retry conflict.

Configurations are validated by the registered server-side game definition before persistence. Entry ranges are non-negative integer strings; `maximumEntry = 0` means unlimited, otherwise it must be at least the minimum.

## What could go wrong, and how it is prevented

- **An admin silently rewrites old rules:** configurations are append-only revisions.
- **An audit record ambiguously targets an account and a game:** a database check enforces exactly one typed target.
- **A browser submits impossible game settings:** the backend's game definition validates all settings.
- **A game is activated without runnable settings:** activation requires an active configuration.
- **Two admins edit the same revision:** the unique revision key detects the race; the transaction is rolled back.
- **Sensitive operational data leaks to players:** each route has a specific authorization hook and the service repeats the permission check.
