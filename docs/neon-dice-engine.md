# Neon Dice — Section 2: engine and configuration

Section 2 implements the isolated `@game-platform/neon-dice` package. It does
not add a database game, migration, HTTP route, wallet settlement, player UI,
administrator UI, music, or production registration.

The package contains:

- strict version 1 configuration parsing;
- fixed 95% RTP multipliers;
- configurable safe subsets of the supported 0.50–30 coin wagers;
- a hard 30-coin wager ceiling and 200-coin configuration cap;
- two independent cryptographic six-sided draws in production;
- deterministic injected randomness for testing;
- authoritative win and integer-cent reward calculation;
- strict stored-result parsing that recomputes and verifies financial facts;
- public-state and durable-result serialization; and
- a `neon-dice@1.0.0` game definition ready for later server registration.

The generic game definition intentionally cannot start a round because the
current game-core creation context does not contain the player's Dice selection.
The later atomic settlement service must receive the selection in the paid start
request and call the resolver inside the wallet transaction.

Tests exhaust all 36 ordered dice outcomes, prove the 15/6/15 split and exact
95% RTP, check every launch wager for whole-cent settlement, enforce liability
caps, exercise win/loss boundaries, reject malformed configurations and random
values, detect tampered stored results, and verify idempotent engine completion.
