# Neon Dice — Section 3: catalog and database registration

Section 3 registers the `neon-dice@1.0.0` implementation in the server runtime
and adds its durable catalog record and immutable first configuration revision.
It does not implement paid settlement, HTTP request fields, player gameplay,
administrator-specific Dice controls, sound, or launch approval.

## Database state

Migration `20260928000000_neon_dice_foundation` creates Neon Dice as a
single-player game with status `DISABLED`. Its active version pointer identifies
version `1.0.0`, revision 1, so administrators can inspect the intended launch
configuration without making it available in the player catalog.

The stored limits and configuration match the reviewed Section 1 model:

- minimum entry: 50 cents;
- maximum entry: 3,000 cents;
- return: 9,500 basis points;
- multipliers: 22,800 / 57,000 / 22,800 basis points;
- denominations: 50, 100, 200, 500, 1,000, 2,000, and 3,000 cents; and
- maximum gross payout: 20,000 cents.

The migration is additive and conflict-safe. It does not overwrite an existing
game, configuration revision, availability decision, or active version. The
repeatable seed follows the same rule: it can restore a missing base record but
does not enable Dice or roll back later configuration work.

## Runtime and container wiring

The server registry now knows the exact `neon-dice@1.0.0` implementation and can
validate its configuration. The player catalog still returns only database-active
games, so the disabled record is not advertised. Production and development
container dependency manifests include the new workspace package, and the local
development server mounts its source directory.

Keep Neon Dice disabled until later sections add atomic wallet settlement, strict
request contracts, player/admin interfaces, security review, and release gates.
