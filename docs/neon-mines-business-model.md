# Neon Mines mathematics and launch risk model

This document fixes the Section 1 business assumptions before session, wallet, API, or user-interface implementation.

## Launch configuration

| Setting | Value |
|---|---:|
| Board | 25 tiles (5×5) |
| Return to player | 96% |
| Theoretical house edge | 4% of settled wager volume |
| Difficulties | Easy 3, Medium 5, Hard 10, Expert 15 mines |
| Wagers | 0.10, 0.25, 0.50, 1, 2, 5, 10, 20, 50 coins, restricted by difficulty |
| Maximum gross payout | 500 coins |
| Maximum multiplier | 500× |

Difficulty wager ceilings are 50 coins for Easy and Medium, 20 coins for Hard, and 10 coins for Expert. These are risk controls, not player-wallet limits. The 500-coin gross payout cap still forces cash-out before a subsequent safe selection would exceed liability.

## Exact settlement

After `k` safe selections from a board of `N=25` tiles containing `M` mines:

```text
survival probability = C(N-M, k) / C(N, k)
gross payout = floor(wager cents × 0.96 / survival probability)
```

The gross payout includes the wager. A mine returns zero. Settlement uses integer cents and exact integer combinations; displayed decimal multipliers are informational only.

Rounding is always downward. Consequently, actual RTP can be slightly below 96% for small wagers, but never above it. The additional rounding cost is less than one expected cent at any cash-out point.

## Player and owner outcomes at three safe selections

The following examples assume a 5-coin wager and cash-out immediately after the third safe tile.

| Difficulty | Player success | Owner round win | Gross payout | Player net profit |
|---|---:|---:|---:|---:|
| Easy, 3 mines | 66.96% | 33.04% | 7.16 coins | 2.16 coins |
| Medium, 5 mines | 49.57% | 50.43% | 9.68 coins | 4.68 coins |
| Hard, 10 mines | 19.78% | 80.22% | 24.26 coins | 19.26 coins |
| Expert, 15 mines | 5.22% | 94.78% | 92.00 coins | 87.00 coins |

The owner can lose an individual round. The 4% advantage is a long-run expectation across total settled wagers, not a guarantee per player or per day.

## Liability behavior

The engine must never offer a tile whose successful payout would exceed either the 500-coin absolute cap or 500× multiplier cap. Instead, after the preceding safe tile it requires cash-out at the current uncapped 96%-RTP value. It must not allow the extra risk and then silently truncate the reward, because that would create a hidden increase in house edge.

At the proposed 500-coin maximum payout, a conservative operating reserve is at least 50,000 redeemable coins, keeping one maximum result at or below 1% of reserve. Until that reserve exists, production configuration must reduce the absolute payout cap.

## Revenue expectations

| Settled wager volume | Theoretical gross gaming revenue |
|---:|---:|
| 1,000 coins | 40 coins |
| 10,000 coins | 400 coins |
| 100,000 coins | 4,000 coins |

Actual revenue varies because of payout volatility and will also be reduced by bonuses, payment fees, fraud losses, taxes, and operating expenses. Business reporting must compare actual payout divided by wager volume against the versioned theoretical 96% RTP.

## Decisions deferred to later sections

This section does not create mines, sessions, wallet entries, routes, database rows, admin controls, or UI. Secure mine placement and round behavior belong to Section 2. All monetary settlement remains server-authoritative in Section 4.
