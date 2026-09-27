# Neon Mines — Section 10: browser and mobile viewport verification

## Result

The running local applications were exercised in Microsoft Edge against the
real local API and migrated PostgreSQL database. Neon Mines remains disabled
after the verification. No staging or production service was changed.

## Player verification

A disposable player was funded with 100.00 coins and an Easy 0.10-coin round
was started through the API. Edge then authenticated through the actual player
login and resumed that server-owned round.

Verified in a responsive touch viewport:

- portrait at 400 x 703 CSS pixels;
- landscape at 703 x 400 CSS pixels;
- all 25 tiles rendered in both orientations;
- the 3-mine Easy state and 0 safe picks were correct;
- the wallet displayed 99.90 coins after the 0.10 entry debit;
- the status, cash-out, next-safe, safe-pick, timer, navigation, fullscreen,
  settings, and action controls remained visible;
- landscape used the compact two-column board layout without clipping.

The existing desktop-only guard was also verified: a fine-pointer desktop
viewport displays the instruction to continue on a phone instead of exposing
the game controls.

## Administrator verification

An isolated InPrivate window authenticated to the real local admin console.
The game catalog showed Neon Mines as active during the temporary test window.
Its management panel rendered the expected fixed-rule summary and controls:

- 25 tiles, 96% theoretical RTP, and 4% theoretical house edge;
- 500x multiplier ceiling;
- Easy 3/5.00, Medium 5/5.00, Hard 10/2.00, and Expert 15/1.00 limits;
- 0.10 minimum wager, 50.00 maximum wager, and 500.00 gross payout cap.

No configuration was changed through the browser.

## Cleanup and final state

After the visual checks, the active test round was completed through the API,
Neon Mines was restored to `DISABLED`, and the disposable `section10_player`
account was permanently deleted with 14 related records. The reused
`section9_admin` test account was returned to `DISABLED` and all of its local
authentication sessions were revoked.

Final local state:

- Neon Mines: `DISABLED`;
- `section10_player`: deleted;
- `section9_admin`: disabled, no active authentication sessions;
- production/staging: untouched.

## Remaining device gate

This verifies real browser rendering and device emulation, but it is not a
physical iOS/Android result. Before production activation, repeat the journey
on at least one real iPhone/Safari and one Android/Chrome device over HTTPS to
validate safe-area insets, browser-toolbar behavior, touch targeting, audio,
fullscreen availability, and network transitions.
