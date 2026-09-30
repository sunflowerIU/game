# Neon Mines — Section 5: player interface

> Updated 2026-09-30: the player interface no longer offers cash-out. It shows
> the full-board reward, settles a win only after every safe tile is selected,
> and warns that leaving after the first selection forfeits the deposit. Leaving
> before selecting a tile refunds the deposit.

The player app now routes Neon Mines rounds to a dedicated 3×3 board. Neon
Reels retains its existing screen. The existing mobile-only policy is unchanged.

## Player flow

1. Select Neon Mines in the enabled-game catalog, choose difficulty and wager.
   Easy/Medium/Hard show 2/3/4 mines and filter wagers by the configured
   limits. The server independently validates every start.
2. The server charges the entry once. The board displays the server-provided
   full-board win amount, including the wager.
3. Select tiles until every safe tile is revealed. Pending actions disable the
   board. Results reveal safe selections and, on loss, mines returned by the server.
4. A completed round keeps the player in Neon Mines, refreshes the wallet, and offers Play Again with the same wager and difficulty. The header back control remains available. Active rounds
   are recovered at login/reload, including when a game has entered maintenance.

Both portrait and landscape layouts are supported. Optional fullscreen does not
force Mines into landscape. The countdown is informational: settlement and the
15-minute inactivity policy remain authoritative on the server. Reaching zero
does not itself send a client settlement request; the next action/resume obtains
the authoritative state, while server expiry runs independently.

## Network and balance behavior

- Synchronous in-flight guards prevent duplicate starts and tile taps.
- An uncertain Mines start retains its idempotency key for the same wager and
  difficulty within the mounted app, and attempts active-session recovery.
- A failed command attempts resume before another move. If recovery also fails,
  a Reconnect button replaces gameplay controls until state can be confirmed.
- Requests used for Mines actions and recovery time out after 15 seconds. Timeout
  does not imply server rollback. Sequence validation remains the final safeguard.
- Existing wallet events and refreshes supply balance updates. The client never
  calculates a reward or optimistically credits winnings.
- Logout/password changes clear locally cached round and start-request state.

## Verification and launch boundary

Component tests cover concealed tiles, premature cash-out, displayed server
payouts, terminal loss, and disabled/reconnection controls. Run `pnpm --filter
@game-platform/web test` after installing workspace dependencies. Setting
`MINES_PREVIEW_DIR` additionally generates a static fixture using the real board
component and application CSS for viewport inspection.

Section 5 checks passed: component tests, changed-file ESLint, TypeScript, and a
production Next.js build. Static browser layout checks covered 390×844, 320×568,
and 844×390 viewports. These are not physical-device or live API end-to-end tests.

Neon Mines remains disabled in seed/migration defaults. This section does not
apply application database migrations, enable the game, or deploy it. Admin
controls, fairness/security review, and live production-readiness checks remain
separate sections. In particular, future configurable difficulty limits must be
exposed to the UI instead of relying on the current launch-limit helpers.
