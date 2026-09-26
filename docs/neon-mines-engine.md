# Neon Mines engine and round lifecycle

This document fixes the Section 2 in-memory game behavior. Persistence, HTTP APIs, wallet settlement, and the player interface belong to later sections.

## Round lifecycle

Every round starts in `ACTIVE` with a server-generated mine layout. The layout is private until the round reaches a terminal state.

| Trigger | Resulting status | Reward |
|---|---|---:|
| Player selects a safe tile | `ACTIVE` | Not settled |
| Player cashes out after at least one safe tile | `CASHED_OUT` | Current exact payout |
| Player selects a mine | `MINE_HIT` | 0 |
| Next safe selection would breach a payout limit | `AUTO_CASHED_OUT` | Current exact payout |
| Server completes a progressed round | `AUTO_CASHED_OUT` | Current exact payout |
| Server completes an untouched round | `ABANDONED` | 0 |

Terminal rounds reject further player input. An abandoned round is distinct from a mine loss so reporting does not falsely claim that the player selected a mine.

## Accepted player actions

- `SELECT_TILE` accepts exactly one integer tile index from 0 through 24.
- A tile cannot be selected twice.
- `CASH_OUT` is available only after at least one safe selection.
- Unknown fields, malformed actions, and actions after completion are rejected.

## Information boundaries

The public state contains the selected tiles, payout offers, status, and game configuration. While the round is active, `revealedMines` is always empty and the mine layout is never included in events. A terminal state reveals the completed board.

The authoritative result contains the mine layout and settlement data for trusted server code. It must not be returned directly to a player client.

## Payout and liability behavior

The engine calls the Section 1 exact-integer payout functions. A safe selection updates the available cash-out. If another successful selection would exceed the configured 500-coin or 500x ceiling, the engine automatically cashes out at the current fair value before accepting that extra risk. A mine always changes the displayed and settled cash-out to zero, including when safe tiles were selected earlier.

## Randomness and recovery

Production mine placement uses Node.js cryptographic randomness and an unbiased partial Fisher-Yates shuffle. Randomness is injectable so tests can reproduce exact boards.

`toSnapshot()` captures the private round state for trusted persistence, and `NeonMinesEngine.restore()` reconstructs it. Restore validates game version, mine count and positions, selected tiles, terminal state, reward, and payout-limit consistency. A snapshot is server-private because it contains the mine layout.
