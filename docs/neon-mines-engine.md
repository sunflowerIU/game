# Neon Mines engine and round lifecycle

> Updated 2026-09-30: Neon Mines is completion-only. Progressive and automatic
> cash-out behavior described in older sections below has been replaced by fixed
> 2×/3×/4× rewards after every safe tile is revealed on the 3×3 board. Leaving before the first
> tile refunds the deposit; leaving after a selection forfeits it.

This document fixes the Section 2 in-memory game behavior. Persistence, HTTP APIs, wallet settlement, and the player interface belong to later sections.

## Round lifecycle

Every round starts in `ACTIVE` with a server-generated mine layout. The layout is private until the round reaches a terminal state.

| Trigger | Resulting status | Reward |
|---|---|---:|
| Player selects a safe tile | `ACTIVE` | Not settled |
| Player selects a mine | `MINE_HIT` | 0 |
| Player reveals every safe tile | `WON` | Configured difficulty multiplier × deposit |
| Player/server ends a progressed round | `ABANDONED` | 0 |
| Player/server ends an untouched round | `ABANDONED` | Deposit refunded |

Terminal rounds reject further player input. An abandoned round is distinct from a mine loss so reporting does not falsely claim that the player selected a mine.

## Accepted player actions

- `SELECT_TILE` accepts exactly one integer tile index from 0 through 8.
- A tile cannot be selected twice.
- `LEAVE` refunds an untouched round and forfeits a progressed round.
- Unknown fields, malformed actions, and actions after completion are rejected.

## Information boundaries

The public state contains the selected tiles, payout offers, status, and game configuration. While the round is active, `revealedMines` is always empty and the mine layout is never included in events. A terminal state reveals the completed board.

The authoritative result contains the mine layout and settlement data for trusted server code. It must not be returned directly to a player client.

## Payout behavior

Easy, Medium, and Hard use 2, 3, and 4 mines respectively. Their default full-board rewards remain 2×, 3×, and 4× the deposit. Administrators may change each integer multiplier from 1× through 100×; the server validates and snapshots the configuration revision used by the round. A mine always settles zero.

## Randomness and recovery

Production mine placement uses Node.js cryptographic randomness and an unbiased partial Fisher-Yates shuffle. Randomness is injectable so tests can reproduce exact boards.

`toSnapshot()` captures the private round state for trusted persistence, and `NeonMinesEngine.restore()` reconstructs it. Restore validates game version, mine count and positions, selected tiles, terminal state, reward, and payout-limit consistency. A snapshot is server-private because it contains the mine layout.
