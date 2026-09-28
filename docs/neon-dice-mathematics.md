# Neon Dice 1.0.0 — Section 1: rules, mathematics, and liability

## Section outcome

Neon Dice is an original, single-player game inspired by the familiar two-dice
Under/Exactly Seven/Over format. This document freezes the version 1 rules and
financial limits before engine, persistence, API, player-interface, audio, or
administrator work begins.

Section 1 does not register, migrate, expose, or enable a game.

## Round rules

1. Before a roll, the player chooses one of `UNDER_7`, `EXACTLY_7`, or
   `OVER_7` and one configured wager denomination.
2. The server independently generates two fair six-sided dice. Each ordered
   pair from `(1, 1)` through `(6, 6)` is one of 36 equally likely outcomes.
3. `UNDER_7` wins on totals 2 through 6, `EXACTLY_7` wins on total 7, and
   `OVER_7` wins on totals 8 through 12. Boundaries are therefore unambiguous:
   a total of 7 loses for both Under and Over.
4. A win returns the configured gross reward, including the original wager. A
   loss returns zero. There are no ties, partial returns, cash-out decisions, or
   follow-up commands.
5. One roll is one independently recorded, immediately completed game session.

The client will eventually submit only the wager and selection. Dice, total,
multiplier, win state, and reward are authoritative server results.

## Exact outcome distribution

| Total | Ordered outcomes | Probability |
| ---: | ---: | ---: |
| 2 | 1 | 1/36 |
| 3 | 2 | 2/36 |
| 4 | 3 | 3/36 |
| 5 | 4 | 4/36 |
| 6 | 5 | 5/36 |
| 7 | 6 | 6/36 |
| 8 | 5 | 5/36 |
| 9 | 4 | 4/36 |
| 10 | 3 | 3/36 |
| 11 | 2 | 2/36 |
| 12 | 1 | 1/36 |

This produces the three launch markets:

| Selection | Winning outcomes | Win probability | Gross multiplier | Theoretical RTP |
| --- | ---: | ---: | ---: | ---: |
| Under 7 | 15/36 | 41.666666…% | 2.28x | 95% |
| Exactly 7 | 6/36 | 16.666666…% | 5.70x | 95% |
| Over 7 | 15/36 | 41.666666…% | 2.28x | 95% |

For a target return of 95%, the exact gross multiplier is:

```text
multiplier = target return / win probability
```

Consequently, Under and Over use `0.95 / (15 / 36) = 2.28`, while Exactly
Seven uses `0.95 / (6 / 36) = 5.70`. Expected gross return is 95% of wager and
the theoretical house edge is 5%. These are long-run expectations, not a profit
guarantee for any player or operator over a finite number of rounds.

## Integer settlement

All monetary values remain integer cents. Multipliers use integer basis points:

| Selection | Multiplier basis points |
| --- | ---: |
| Under 7 | 22,800 |
| Exactly 7 | 57,000 |
| Over 7 | 22,800 |

The gross reward formula is:

```text
grossRewardCents = wagerCents * multiplierBps / 10,000
```

Version 1 accepts only denominations for which this division is exact for every
selection. This prevents a small wager from receiving a materially different RTP
because of cent rounding.

A 0.10-coin wager is intentionally excluded: an Under/Over win would calculate
to 22.8 cents. A 0.25-coin wager is also excluded: an Exactly Seven win would
calculate to 142.5 cents. Rounding either reward would change the advertised RTP.
The launch minimum is therefore 0.50 coins rather than presenting unequal odds
under the same game rules.

## Wagers and configurable limits

The launch denomination set is:

```text
0.50, 1, 2, 5, 10, 20, and 30 coins
```

Internally this is `[50, 100, 200, 500, 1000, 2000, 3000]` cents.

Version 1 has a hard wager ceiling of 30 coins (`3,000` cents). Administrator
settings may choose a strictly ascending, duplicate-free subset of supported
denominations and may lower the active minimum or maximum range. Settings cannot
create a wager above the hard ceiling or an amount that causes fractional-cent
settlement. Raising the ceiling requires a reviewed game-version/code change.

The durable game version will contain, at minimum:

- `returnBps: 9500`
- `multiplierBps` for all three selections
- `wagerDenominationsCents`
- `maximumPayoutCents`

The game record's `minimumEntry` and `maximumEntry` must both name enabled
denominations. At least one denomination must remain enabled. Historical rounds
retain their immutable configuration revision.

The return and multipliers are fixed for version 1. Administrator wager settings
are customizable, but casual RTP or multiplier editing is deliberately excluded.
A future paytable change requires a separately reviewed game version.

## Liability model

The highest multiplier is 5.70x on Exactly Seven. At the hard 30-coin wager
ceiling, the maximum possible gross reward is:

```text
30 coins * 5.70 = 171 coins
```

Version 1 uses a 200-coin (`20,000` cents) gross payout cap. The cap is a
configuration invariant and not a post-roll clipping mechanism: every offered
wager must be fully payable at its advertised multiplier. If
`maximum wager * 5.70` exceeds the configured payout cap, the configuration is
invalid and cannot be activated. A winning reward must never be silently reduced.

The launch exposure per accepted round is therefore bounded as follows:

| Selection | Maximum wager | Maximum gross reward | Maximum net player profit |
| --- | ---: | ---: | ---: |
| Under 7 | 30.00 | 68.40 | 38.40 |
| Exactly 7 | 30.00 | 171.00 | 141.00 |
| Over 7 | 30.00 | 68.40 | 38.40 |

Operational reserve planning must use the 171-coin maximum gross reward per
simultaneously accepted round and a workload-specific concurrency assumption;
the theoretical house edge is not a substitute for sufficient settlement funds.

## Configuration invariants for later sections

Engine and administrator validation must reject configurations when any of these
conditions is false:

1. Return basis points equal 9,500.
2. Multipliers equal 22,800/57,000/22,800 basis points for
   Under/Exactly Seven/Over.
3. Denominations are unique, strictly ascending positive integer cents.
4. Every denomination settles every possible winning selection to a whole cent.
5. Every denomination is at most 3,000 cents.
6. The stored minimum and maximum entries are enabled denominations.
7. The maximum payout is positive, no greater than 20,000 cents for version 1,
   and large enough to pay the highest enabled wager at 5.70x.
8. Unknown configuration fields or selection names are rejected.

These validation rules are intentionally stricter than the database's generic
game-version fields.

## Fairness and product claims

The later engine must use the server's cryptographic random source and generate
both dice independently without modulo bias. Animation may add anticipation but
must always land on the stored server result. The game must not be marketed as
“provably fair” unless a separate player-verifiable commitment and reveal design
is implemented and reviewed.

The name, visual identity, music, sound effects, source, and interface will be
original. Inspiration from the general game format does not authorize copying
another operator's branding, assets, or presentation.

## Section 1 acceptance criteria

- All 36 ordered dice outcomes are accounted for exactly once.
- Under and Over each contain 15 outcomes; Exactly Seven contains 6.
- Each selection has exactly 95% theoretical RTP at the configured multipliers.
- Every launch denomination produces a whole-cent reward for every selection.
- No accepted wager exceeds 30 coins.
- The largest possible gross reward is 171 coins and fits below the 200-coin cap.
- Later configuration validation will enforce all documented cross-field limits.
