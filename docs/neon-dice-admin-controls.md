# Neon Dice — Section 7: administrator controls

Section 7 replaces raw JSON editing for Neon Dice with guarded operator
controls.

Administrators can:

- enable any non-empty subset of the supported 0.50, 1, 2, 5, 10, 20, and
  30 coin wagers;
- set the maximum gross payout reserve, subject to the 200-coin hard ceiling;
- see the minimum reserve needed for the largest enabled Exactly 7 wager;
- create a new immutable, audited configuration revision; and
- enable, disable, deprecate, or place the game in maintenance after an
  explicit launch confirmation.

The player catalog limits are derived from the first and last enabled wagers.
The server independently rejects unlimited Dice wagers, mismatched catalog
limits, or payout reserves that cannot cover the largest enabled wager.

Version 1 keeps its 95% RTP and 2.28× / 5.70× / 2.28× gross multipliers locked.
They cannot be changed through the operator interface.
