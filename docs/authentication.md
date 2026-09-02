# Section 2: identity and authentication

## Boundaries

```text
Fastify routes
  -> AuthService (database-independent policy)
      -> PasswordHasher (Argon2id)
      -> SessionTokenService (CSPRNG + SHA-256 digest)
      -> AuthRepository
          -> PrismaAuthRepository
              -> PostgreSQL
```

`packages/auth` owns authentication policy and crypto abstractions. It never
imports Fastify or Prisma. `packages/database` owns the Prisma 7 generated
client and PostgreSQL adapter. `apps/server` owns HTTP cookies, request schemas,
error mapping, and the Prisma repository adapter.

## Identity model

`Account` is private infrastructure shared by player and administrator
principals. A deferred PostgreSQL constraint trigger requires every account to
have one credential and exactly one profile matching `Account.type`.

```text
Account
  |-- Credential
  |-- PlayerProfile OR AdminProfile
  |-- AuthSession[]
  `-- LoginEvent[]

AdminProfile -> Role[] -> Permission[]
```

This shares safe credential/session mechanics without treating a player as an
administrator with a different UI. Role assignments reference
`AdminProfile`, so normal database relations cannot grant a role directly to a
player profile.

## Login flow

1. Fastify validates a bounded username/password payload and applies a local
   per-IP login rate limit.
2. `AuthService` checks recent failed username/IP attempts stored in PostgreSQL.
3. The password is verified with Argon2id. Unknown users verify against a dummy
   hash to reduce timing-based account enumeration.
4. Disabled users and bad credentials receive the same public error.
5. A cryptographically random 256-bit session token is generated.
6. PostgreSQL atomically stores only its SHA-256 digest, the successful
   `LoginEvent`, and the player's `lastLoginAt` timestamp.
7. The plaintext token is returned only as an HttpOnly, SameSite=Strict cookie;
   production uses the Secure `__Host-` cookie prefix.

Player sessions expire after eight hours. Admin sessions expire after two
hours. Sessions are database-backed and revocable, so disabling an account or
resetting a password can invalidate existing sessions across every future API
instance. MFA enrollment fields are present for a later stronger-admin-control
section, but MFA is not falsely claimed or enforced yet.

Explicit player logout atomically revokes the session and creates a `LOGOUT`
event using the logout request's IP address and user agent. These authentication
events are shown only in that player's access logs; they are intentionally not
copied into the global administrator audit log. `PlayerProfile.lastLoginAt` is
indexed so a future retention job can efficiently identify inactive players.

## Authorization

The authentication hook resolves the current principal and its permissions in
one centralized location. Permission codes are defined in `packages/auth`.
Admin routes use centralized permission guards rather than checking role names
in controllers.

## What could go wrong

- Plaintext or fast-hashed passwords could be recovered after a database leak.
- A stolen session database could become an immediate account takeover.
- Duplicate or partial writes could create a session without login history.
- Disabled users, expired sessions, forged cookies, and cross-origin requests
  could retain access.
- Username-specific errors or fast unknown-user checks could enumerate users.
- Repeated Argon2 work could exhaust a small VPS.
- A player could accidentally receive admin authorization through weak data
  relationships.

## How this implementation prevents it

- Passwords use salted Argon2id with 19 MiB, two iterations, and one lane.
- Only SHA-256 session-token digests are persisted; tokens have 256 bits of
  CSPRNG entropy and strict format validation.
- Session creation and successful login history share one database transaction.
- Every authenticated request checks account status, expiry, and revocation in
  PostgreSQL, which remains valid after horizontal scaling.
- Login responses are generic, unknown users perform dummy hash verification,
  and both Fastify and durable failure-history throttles are applied.
- Password inputs are length-bounded before Argon2 processing.
- Foreign keys, unique indexes, check constraints, and deferred identity-shape
  triggers enforce critical invariants below application code.
- Cookies are HttpOnly and SameSite=Strict; production cookies are Secure and
  host-only. CORS is still treated as defense in depth, not authorization.
- The workspace pins Prisma's transitive `deepmerge-ts` dependency to patched
  version 8.0.0 because Prisma 7.9.1 otherwise resolves a version affected by
  CVE-2026-40345; Prisma generation and all builds are verified with the pin.

## Deliberately deferred

- MFA challenge and recovery codes
- Wallet and ledger tables
- CSRF tokens for future sensitive same-origin mutations
- Redis-backed cross-instance edge rate limiting

## Section 3 (implemented)

Administrator-controlled player lifecycle operations, forced session
revocation, immutable audit records, and the minimal admin UI are implemented.
See `docs/admin-player-management.md` for the transaction and security model.
