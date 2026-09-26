# Neon Mines — Section 6: admin controls

Open the private admin app, choose Games, then Manage Neon Mines. The game must
already exist in the database; this section does not apply migrations or enable it.

## Configuration form

Mines has a dedicated form instead of editable configuration JSON. Set minimum
and maximum wagers from the supported coin denominations, and the maximum gross
payout in coins. The form converts coin amounts to integer cents for the API.

The 25-tile board, 96% RTP, difficulty mine counts and wager ceilings, denomination
list, and 500× multiplier ceiling stay fixed. The backend rejects changes to these
rules, unknown configuration fields, and payout caps outside 0.25–500 coins.

Additional administrative validation requires:

- Both entry limits are supported denominations; zero/unlimited is prohibited.
- Minimum does not exceed maximum.
- Every difficulty retains at least one eligible wager.
- The payout cap covers the first safe selection of every offered wager.

For example, allowing the full launch range needs at least a 6-coin payout cap
(the first Medium safe selection at a 5-coin wager). Restricting all wagers to
0.10 coins permits the minimum 0.25-coin cap. Later selections still use the
engine's existing liability stop/automatic cash-out rules.

Saving creates an audited immutable configuration revision through the existing
admin service. It does not enable the game or change settings of active rounds.
The form reloads saved values after success. A synchronous guard prevents rapid
duplicate submissions within the current page; it is not cross-client request
idempotency.

## Availability and sessions

The existing Active, Disabled, Maintenance and Deprecated controls remain in use.
Enabling Mines checks the saved configuration and entry limits and asks the admin
to confirm launch checks and reserves. This confirmation is not a technical
certification that the game is ready for production.

Disabled/maintenance modes stop new starts. Existing Mines rounds can resume and
settle under Section 4 behavior, including the server expiry sweep. Status changes
and revisions require GAME_MANAGE and an audit reason; viewing requires GAME_VIEW.
The existing sessions view displays game slug, configuration revision, wager,
score/reward and settlement status. No private mine layout is added to admin APIs.

## Verification and remaining work

Tests cover permission denial, invalid ranges, unavailable difficulties, exact
first-payout cap boundaries, reduced-risk settings, activation validation, fixed
rule enforcement, and form rendering/coin conversion. TypeScript, changed-file
lint and the private admin production build are checked as part of this section.

No application database rows, migrations, status settings, or live wagers are
changed during these checks. Physical-device/live admin-to-player checks and the
fairness/security and production-readiness review remain for later sections.
