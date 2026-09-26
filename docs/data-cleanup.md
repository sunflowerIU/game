# Data cleanup operations

Player cleanup is deliberately manual. The platform does not schedule automatic deletion jobs.

## Available operations

- **Disable a player:** blocks future login and revokes current authentication sessions without deleting history.
- **Delete one player:** permanently removes the account, credentials, wallet, sessions, gameplay records, and related logs. A username confirmation is required, and a positive wallet balance requires separate approval.
- **Delete one player's old records:** removes eligible history at or before the chosen cutoff while preserving the account, current balance, active sessions, and newer records.
- **Delete inactive players:** Settings → Cleanup & retention previews and deletes eligible accounts in batches of at most 100. Active game sessions are always protected. Positive balances are protected by default.
- **Clean up old sessions:** removes expired or revoked authentication sessions and completed, abandoned, or failed game sessions at or before the chosen cutoff. Each batch is limited to 1,000 authentication sessions and 1,000 game sessions. Active and created game sessions, accounts, wallets, and ledger entries are preserved.

For a player who has never logged in, inactivity is measured from account creation. Otherwise it is measured from the last successful login.

## Safe operating procedure

1. Take and verify a PostgreSQL backup before a large cleanup.
2. Open the cleanup preview and confirm the cutoff, protected-player counts, balance total, and eligible count.
3. Keep positive-balance deletion disabled unless those balances have been reconciled separately.
4. Start with a small batch. Review the completion summary before continuing.
5. Repeat manually until the preview reports no eligible players.

For general maintenance, start with 30 days for expired authentication sessions and 90 days for terminal game sessions. The current combined control uses one conservative retention period, defaulting to 90 days.

Each destructive request requires `DATA_RETENTION_MANAGE` or `PLAYER_DELETE`, a reason, and an idempotency key. Cleanup batches run atomically under serializable transactions. Serialization conflicts are retried, simultaneous requests with the same key converge on one stored result, and the browser retains its key after an uncertain network failure.

## Audit and recovery

Every completed operation creates a `DataCleanupRun` containing the administrator, action, cutoff, reason, client context, aggregate record counts, deleted balance, and timestamp. This record is intentionally retained after player-linked audit rows are removed.

Deleted player data cannot be reconstructed from `DataCleanupRun`; recovery requires restoring a database backup. Do not delete cleanup-run records as part of routine space reclamation.

## Deployment requirement

Apply database migrations before starting the updated API. Production Compose does this through its `migrate` service. The `20260901000000_data_cleanup_foundation` migration creates the permissions, cleanup-run table, indexes, and narrowly scoped trigger authorization required for immutable ledger, result, and audit deletion. The additive `20260902000000_session_cleanup` migration registers the audited global session-cleanup action, and `20260902010000_session_cleanup_indexes` keeps cutoff previews and batches indexed as the tables grow.
