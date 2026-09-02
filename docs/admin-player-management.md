# Section 3: administrator player management

## Scope

Administrators with explicit permissions can list and create players, enable or
disable accounts, reset passwords, and view recent administrative actions. The
browser is only an operator interface; Fastify resolves the session and checks
the exact permission for every endpoint.

```text
Admin browser
  -> HttpOnly session cookie
  -> Fastify authenticate + permission guard
  -> PlayerAdminService
  -> PrismaPlayerAdminRepository
  -> one PostgreSQL transaction
       |-- player/credential mutation
       |-- active-session revocation when required
       `-- immutable AdminAuditLog insert
```

## Permissions

| Operation | Permission |
| --- | --- |
| List players | `PLAYER_VIEW` |
| Create player | `PLAYER_CREATE` |
| Enable/disable player | `PLAYER_DISABLE` |
| Reset password | `PLAYER_PASSWORD_RESET` |
| View audit log | `SECURITY_VIEW` |

Permission checks are centralized in the authentication plugin and repeated in
the database-independent service boundary. Controllers do not inspect role
names.

## Audit guarantees

Every completed sensitive mutation records the administrator, action, target,
safe before/after snapshots, reason, IP address, user agent, and timestamp. The
mutation and audit insert share one transaction: neither can commit alone.

Passwords and password hashes are never placed in audit JSON. Password resets
record only the old and new credential version. PostgreSQL foreign keys require
a real admin profile and target account, and an immutable-table trigger rejects
all `UPDATE` and `DELETE` operations on `AdminAuditLog`.

## What could go wrong

- A player or under-privileged admin could call an endpoint directly.
- A player change could commit without its audit record after a crash.
- Disabling an account or resetting a password could leave stolen sessions
  usable on another API instance.
- Duplicate usernames could bypass application checks under concurrency.
- Audit records could expose passwords or be rewritten to hide abuse.
- The UI could falsely display a successful change.

## How this implementation prevents it

- Every route authenticates the opaque session and checks a specific permission
  server-side; the service performs a second authorization check.
- Lifecycle mutations, revocations, and audits are PostgreSQL-transactional.
- Disable and password-reset operations revoke every active database session
  with an explicit reason, effective across future horizontally scaled servers.
- The unique normalized-username index is the final concurrency authority and
  maps conflicts to a stable `409 CONFLICT` response.
- Audit snapshots contain allowlisted non-secret fields only, and the database
  blocks audit updates/deletes.
- The UI reloads authoritative server state after each mutation and treats the
  server response—not local state—as the result.

## Section 4

Section 4 will implement the wallet and append-only ledger: integer coin units,
centralized credit/debit service, PostgreSQL row locking, idempotency keys,
atomic balance checks, admin wallet permissions and audits, concurrency tests,
and wallet history APIs. No game settlement will be added until the wallet
invariants are proven.

