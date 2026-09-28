import { ADMIN_PERMISSIONS, Argon2idPasswordHasher, normalizeUsername } from "@game-platform/auth";

import { createDatabaseClient } from "../src/client.js";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.length === 0) throw new Error("DATABASE_URL is required for seeding");

const prisma = createDatabaseClient(databaseUrl);

try {
  const permissionRecords = await Promise.all(ADMIN_PERMISSIONS.map((code) => prisma.permission.upsert({
    where: { code },
    update: { description: permissionDescription(code) },
    create: { code, description: permissionDescription(code) }
  })));

  const superAdminRole = await prisma.role.upsert({
    where: { name: "SUPER_ADMIN" },
    update: { description: "Full administrative access" },
    create: { name: "SUPER_ADMIN", description: "Full administrative access" }
  });

  await prisma.rolePermissionGrant.createMany({
    data: permissionRecords.map((permission) => ({
      roleId: superAdminRole.id,
      permissionId: permission.id
    })),
    skipDuplicates: true
  });

  const neonReels = await prisma.game.upsert({
    where: { slug: "neon-reels" },
    update: { name: "Neon Reels", gameType: "SINGLE_PLAYER" },
    create: { slug: "neon-reels", name: "Neon Reels", gameType: "SINGLE_PLAYER", status: "DISABLED" }
  });
  const neonReelsVersion = await prisma.gameVersion.upsert({
    where: { gameId_version_configurationRevision: { gameId: neonReels.id, version: "1.0.0", configurationRevision: 1 } },
    update: {},
    create: {
      gameId: neonReels.id, version: "1.0.0", minimumEntry: 10n, maximumEntry: 5_000n,
      configuration: {
        rows: 3, reels: 5, maxWinMultiplier: 100, wagerDenominationsCents: [10, 50, 100, 500, 1_000, 2_000, 5_000],
        weights: { LEMON: 34, CHERRY: 27, GEM: 19, BELL: 12, STAR: 7, SEVEN: 3, WILD: 3, SCATTER: 4 },
        payouts: {
          LEMON: { 3: 2, 4: 2, 5: 5 }, CHERRY: { 3: 2, 4: 3, 5: 7 }, GEM: { 3: 2, 4: 5, 5: 10 }, BELL: { 3: 3, 4: 8, 5: 15 },
          STAR: { 3: 4, 4: 10, 5: 20 }, SEVEN: { 3: 6, 4: 15, 5: 30 }, WILD: { 3: 8, 4: 20, 5: 50 }
        },
        scatterPayouts: { 3: 2, 4: 5, 5: 12 }
      }
    }
  });
  // Seeding is repeatable and must not roll back a later immutable configuration
  // revision or override an administrator's availability decision.
  if (neonReels.activeVersionId === null) {
    await prisma.game.update({ where: { id: neonReels.id }, data: { activeVersionId: neonReelsVersion.id } });
  }

  const neonMines = await prisma.game.upsert({
    where: { slug: "neon-mines" },
    update: {},
    create: { slug: "neon-mines", name: "Neon Mines", gameType: "SINGLE_PLAYER", status: "DISABLED" }
  });
  const neonMinesVersion = await prisma.gameVersion.upsert({
    where: { gameId_version_configurationRevision: { gameId: neonMines.id, version: "1.0.0", configurationRevision: 1 } },
    update: {},
    create: {
      gameId: neonMines.id, version: "1.0.0", minimumEntry: 10n, maximumEntry: 5_000n,
      configuration: {
        boardTiles: 25, returnBps: 9_600, maximumMultiplierBps: 5_000_000, maximumPayoutCents: 50_000,
        wagerDenominationsCents: [10, 25, 50, 100, 200, 500, 1_000, 2_000, 5_000],
        difficulties: {
          EASY: { mines: 3, maximumWagerCents: 5_000 }, MEDIUM: { mines: 5, maximumWagerCents: 5_000 },
          HARD: { mines: 10, maximumWagerCents: 2_000 }, EXPERT: { mines: 15, maximumWagerCents: 1_000 }
        }
      }
    }
  });
  if (neonMines.activeVersionId === null) {
    await prisma.game.update({ where: { id: neonMines.id }, data: { activeVersionId: neonMinesVersion.id } });
  }

  const neonDice = await prisma.game.upsert({
    where: { slug: "neon-dice" },
    update: { name: "Neon Dice", gameType: "SINGLE_PLAYER" },
    create: { slug: "neon-dice", name: "Neon Dice", gameType: "SINGLE_PLAYER", status: "DISABLED" }
  });
  const neonDiceVersion = await prisma.gameVersion.upsert({
    where: { gameId_version_configurationRevision: { gameId: neonDice.id, version: "1.0.0", configurationRevision: 1 } },
    update: {},
    create: {
      gameId: neonDice.id, version: "1.0.0", minimumEntry: 50n, maximumEntry: 3_000n,
      configuration: {
        returnBps: 9_500,
        multiplierBps: { UNDER_7: 22_800, EXACTLY_7: 57_000, OVER_7: 22_800 },
        wagerDenominationsCents: [50, 100, 200, 500, 1_000, 2_000, 3_000],
        maximumPayoutCents: 20_000
      }
    }
  });
  // Repeatable seeding never enables Dice or replaces a later immutable revision.
  if (neonDice.activeVersionId === null) {
    await prisma.game.update({ where: { id: neonDice.id }, data: { activeVersionId: neonDiceVersion.id } });
  }

  const username = process.env.BOOTSTRAP_ADMIN_USERNAME?.trim();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  if (username !== undefined || password !== undefined) {
    if (username === undefined || password === undefined || username.length < 3 || password.length < 8) {
      throw new Error("BOOTSTRAP_ADMIN_USERNAME and a password of at least 8 characters must be provided together");
    }

    const usernameNormalized = normalizeUsername(username);
    const existingAdmin = await prisma.account.findUnique({ where: { usernameNormalized } });
    if (existingAdmin === null) {
      const passwordHash = await new Argon2idPasswordHasher().hash(password);
      await prisma.account.create({
        data: {
          username,
          usernameNormalized,
          type: "ADMIN",
          credential: { create: { passwordHash } },
          adminProfile: {
            create: {
              roleAssignments: { create: { roleId: superAdminRole.id } }
            }
          }
        }
      });
      process.stdout.write("Bootstrap administrator created.\n");
    } else {
      process.stdout.write("Bootstrap administrator already exists; credentials were not changed.\n");
    }
  } else {
    process.stdout.write("Permissions and roles seeded; bootstrap administrator skipped.\n");
  }
} finally {
  await prisma.$disconnect();
}

function permissionDescription(code: (typeof ADMIN_PERMISSIONS)[number]): string {
  if (code === "PLAYER_DELETE") return "Permanently delete an individual player and all related data";
  if (code === "DATA_RETENTION_MANAGE") return "Preview and execute retention-based data cleanup";
  return code.split("_").map((part) => part.toLowerCase()).join(" ");
}
