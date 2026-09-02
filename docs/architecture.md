# Section 1 architecture

## MVP deployment shape

```text
Browser
  |
  v
Cloudflare -> Nginx
                 |-- / and static assets -> Next.js
                 `-- /api/*              -> Fastify
                                                |
                                                `-- PostgreSQL (Section 2+)
```

The Fastify process will own both REST and WebSocket entry points. Game engines
will run behind application services in that process for the MVP. This avoids a
premature service split while preserving a boundary that can later be moved to
dedicated game-server processes.

## Repository boundaries

```text
apps/
  web/          Player-only Next.js UI and browser-side presentation
  admin-web/    Private administrator Next.js UI
  server/       Fastify HTTP application and future WebSocket host
packages/
  auth/         Database-independent authentication and permission policy
  contracts/    Transport-safe, dependency-light public contracts
  database/     Prisma 7 client, schema, migrations, and PostgreSQL adapter
docs/           Architecture and operational decisions
infrastructure/ Later production Nginx and deployment assets
```

Shared packages exist only where they carry implemented behavior. Database
models are never exposed to the browser; public API contracts remain separate.

## Responsibilities

| Component | Owns | Must not own |
| --- | --- | --- |
| Player Next.js | player sign-in, wallet, lobby, lightweight reel animation, same-origin API consumption | administration, authoritative score, RNG, settlement, balance |
| Admin Next.js | private administrator sign-in and operational controls | player gameplay, authoritative state, direct database access |
| Fastify transport | authentication hooks, input validation, authorization, REST/WebSocket routing, error mapping | game-specific rules in controllers |
| Application services | use-case orchestration and transaction boundaries | presentation |
| Game registry | immutable game definitions by `slug@version`, availability, engine lookup | wallet writes |
| Game engine | authoritative session state, validated inputs, result and settlement proposal | direct ledger persistence |
| Wallet service | the only balance mutation path, ledger creation, locking and idempotency | game simulation |
| PostgreSQL | durable identity, wallet, ledger, session/result and audit records | per-frame active state |

The registry, engines, wallet, and database adapters are planned boundaries;
they are deliberately not implemented in Section 1.

## Request and game data flow

### Current foundation check

```text
Player browser -> player domain -> Nginx/Next same-origin gateway -> Fastify
Admin browser -> private admin domain -> Nginx/Next same-origin gateway -> Fastify admin routes
```

Both frontends use same-origin API paths. In development, each Next.js service
proxies those paths to the loopback-only API port. In production, Nginx routes
them to Fastify over the private Docker network, blocks administrator APIs on
the player hostname, and exposes only authentication and administrator APIs on
the private administrator hostname. CORS permits both configured frontend
origins; authentication and authorization remain the security controls.

### Future game start

```text
Browser intention
  -> Fastify validates envelope, identity, authorization and idempotency key
  -> application service opens one PostgreSQL transaction
  -> wallet locks/checks/debits and appends ledger entry
  -> versioned game definition creates authoritative state
  -> durable GameSession start is recorded
  -> safe public state is returned
```

### Future game input

```text
Browser GAME_INPUT
  -> typed/versioned WebSocket envelope validation
  -> ownership, sequence, timing and rate validation
  -> in-memory authoritative engine state transition
  -> public event/delta returned to browser
```

Inputs are intentions only. Client state is never used to determine a hit,
score, payout, randomness, or balance.

### Future settlement

```text
Authoritative engine result
  -> settlement service verifies session state once
  -> one PostgreSQL transaction records result + wallet ledger mutation
  -> unique settlement idempotency key prevents duplicate reward
```

## How games plug in

Each game module will export a versioned definition registered at startup. The
core will depend on a small interface shaped around lifecycle operations, not a
specific game's state:

```ts
interface GameDefinition<State, Input, PublicState, Result> {
  readonly identity: { slug: string; version: string };
  create(context: CreateGameContext): State;
  handleInput(state: State, input: SequencedInput<Input>, now: Instant): Transition<State>;
  toPublicState(state: State): PublicState;
  finish(state: State, reason: CompletionReason): Result;
  proposeSettlement(result: Result): SettlementProposal;
}
```

The eventual interface separates deterministic engine transitions from I/O.
The platform, rather than the game, persists sessions and applies settlement.
Historical sessions retain the exact game slug/version and their stored result;
new code never reinterprets old payouts.

## Multiplayer and horizontal scaling

The lifecycle is designed around a participant collection even though the first
engine has one participant. A future `GameRoom` can therefore contain multiple
player memberships without changing auth, wallet, protocol versioning, audits,
or the registry.

For the MVP, active state may live in one process. Durable sessions will include
an optional server-owner identifier and lease metadata when multi-instance
ownership becomes necessary. A `SessionDirectory` interface can begin with an
in-memory adapter and later gain a Redis adapter for ownership, presence,
matchmaking, room discovery, and pub/sub. Game rules will not import Redis.

Globally consistent facts—wallet mutations, settlement uniqueness, account
state, and durable results—always remain PostgreSQL-transactional. Redis will
never be the source of truth for money.

## Security posture of this section

What could go wrong: an unrestricted cross-origin caller could probe the API;
malformed configuration could accidentally expose it; health responses could
leak internals; or later code could start trusting shared browser types.

How the foundation prevents it: runtime configuration is validated at startup,
CORS has an explicit origin, Fastify response schemas constrain health output,
logs redact common credential fields, and public contracts contain transport
types only. CORS and TypeScript are explicitly treated as ergonomics—not trust
boundaries. Every security-sensitive route added later still requires runtime
validation, authentication, authorization, ownership checks, and server-side
business rules.

## Section 2 (implemented)

PostgreSQL and Prisma 7 infrastructure now provide constrained player/admin
identity, Argon2id credentials, revocable opaque sessions, roles/permissions,
login auditing, and horizontally consistent authentication. See
`docs/authentication.md` for the security analysis and Section 3 boundary.
