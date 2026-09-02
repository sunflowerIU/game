# Wallet and ledger

The operator and player always work in coins: `1 coin = $1.00`. Admin credit
and debit forms therefore accept coin values such as `10`, `10.50`, or `0.10`.

Internally, PostgreSQL stores the smallest supported unit (one cent) as a
`BIGINT`, and the server uses JavaScript `bigint`. Thus `10.00` coins is stored
as `1000` cents, while a `0.1`-coin spin debits `10` cents and leaves `9.90`
coins. HTTP responses expose integer-cent strings; clients format them as coins
with two decimal places. This avoids floating-point rounding during settlement.

## Write invariant

Every balance mutation runs in one database transaction:

1. Locate the player's wallet and acquire a PostgreSQL `FOR UPDATE` row lock.
2. Re-check the wallet-scoped idempotency key after the lock is held.
3. Reject a reused key whose operation fingerprint differs.
4. Compute and reject a negative resulting balance.
5. Update the wallet balance and monotonic version.
6. Append a ledger entry and administrator audit record in the same transaction.

Ledger rows are immutable. Database checks enforce a nonzero signed amount,
nonnegative before/after balances, and `balanceAfter = balanceBefore + amount`.
The unique `(walletId, idempotencyKey)` index is the final duplicate-write
barrier.

## Authorization

Players may read only the wallet resolved from their authenticated account.
Administrator deposits and debits require separate `WALLET_CREDIT` and
`WALLET_DEBIT` permissions. Every operation requires a 3–500 character reason
and creates an append-only administrator audit record.

## What could go wrong, and how it is prevented

- Two debits race: the row lock serializes them; the second sees the committed balance.
- A client retries after a timeout: the same key and fingerprint returns the original entry.
- A key is accidentally reused: a different fingerprint returns a conflict.
- A debit overdrafts: both service logic and database balance checks reject it.
- Ledger history is edited: the database rejects `UPDATE` and `DELETE`.
- JavaScript rounds large balances: wire contracts use decimal strings.

Run the PostgreSQL concurrency test against a migrated disposable database:

```powershell
$env:TEST_DATABASE_URL = "postgresql://..."
pnpm --filter @game-platform/server test
```
