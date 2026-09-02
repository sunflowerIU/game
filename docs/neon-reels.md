# Neon Reels 1.0.0

Neon Reels is an original five-reel, three-row mobile slot with five fixed paylines. It is inspired by the general arcade-slot genre but does not copy another operator's branding, assets, source code, or private payout configuration.

## Rules

- Every press of **Spin** is one independently recorded game session.
- The fixed wager menu is `0.1`, `0.5`, `1`, `5`, `10`, `20`, and `50` coins.
- `1 coin = $1.00`; for example, a `0.1` wager debits `$0.10` from the wallet.
- Symbols are selected exclusively by the server using Node's cryptographic random source.
- Five paylines are evaluated from the leftmost reel: middle, top, bottom, V, and inverted V.
- Three or more consecutive matching symbols win. `WILD` substitutes for normal line symbols. `SCATTER` pays for three or more symbols anywhere.
- The default aggregate win is capped at 100× the wager.
- Payout weights, symbol multipliers, allowed wager denominations, wager limits, and the cap are stored in the immutable game configuration revision and can be changed through the private admin application.

## Financial transaction

The server locks the player's wallet row and performs the session creation, wager debit, secure outcome generation, result record, optional reward credit, and completion inside one PostgreSQL transaction. A unique player idempotency key makes network retries return the original spin instead of charging twice.

## What could go wrong

- **A client invents winning reels or a reward:** the API accepts only a wager; reels and rewards are generated and calculated on the server.
- **A request is repeated:** the unique session-start key returns the existing completed spin.
- **Two tabs spin against the same balance:** the wallet row lock serializes both transactions, preventing an overdraft.
- **The process stops during a spin:** PostgreSQL rolls back the complete transaction; there is no partially debited spin.
- **An administrator enters unsafe payout settings:** the registered game definition validates every immutable configuration revision before activation.
- **Animation randomness is mistaken for result randomness:** client-side random symbols are visual anticipation only; the animation always lands on the authoritative result returned by the server.
