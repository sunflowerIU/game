# Neon Mines — Section 9: local integration

## Result

The pending Neon Mines migration was applied to the local development database
after a validated pre-migration backup. The game remains disabled. This was not a
staging or production deployment.

Backup:

```text
backups/section9-local/pre-mines-section9.dump
SHA-256 6EC6B01BE62329AABB2CD99D776D70CA1FEBC11B6967D840D0AA3B93624BB512
```

The backup and checksum are excluded from Git. They are a local convenience copy,
not an off-machine disaster-recovery backup.

## Issues corrected

- The development server image predated the Mines workspace package. It was
  rebuilt and now starts with the package available.
- The production migration image was missing workspace manifests and its lockfile,
  causing pnpm to reconcile/download dependencies when the container started.
  The image now includes the dependency-stage app/game manifests and lockfile;
  the verified rerun went directly to `prisma migrate deploy`.
- Readiness previously returned 200 for a reachable database with missing Mines
  tables. It now checks required session tables and maps dependency failure to a
  sanitized HTTP 503 response.

## Real local API journey

A disposable administrator and player exercised the actual running API:

1. Admin authenticated and created/funded a player with 100 coins.
2. Admin temporarily activated Neon Mines.
3. Player authenticated and saw Mines in the catalog.
4. Player started a 0.10-coin Easy round, selected one safe tile and cashed out.
5. Session completed as `CASHED_OUT`; wallet returned to 100.00 coins.
6. Ledger contained exactly one game-entry debit and one reward credit.
7. Admin restored Mines to `DISABLED` and deleted the disposable player.

The database correctly refused deletion of the disposable administrator because
its audit records are immutable. The transaction rolled back. The account was
then disabled and its authentication session deleted, so its known test password
cannot authenticate. The immutable audit record and disabled account remain as an
intentional test trace named `section9_admin`.

Windows browser automation could not start because its app-approval prompt timed
out. Therefore this section verifies the real API and previously rendered UI, but
does not claim a live browser, physical-phone or touch end-to-end pass.

## State after testing

- Local schema: all 17 migrations applied.
- API readiness: HTTP 200 after migration.
- Neon Mines: `DISABLED`.
- Disposable player: deleted.
- Disposable administrator: disabled, no active session.
- Production/staging databases: untouched.

The remaining production gates in `neon-mines-production-readiness.md` are still
required before activation.
