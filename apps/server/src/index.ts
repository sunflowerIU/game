import { resolve } from "node:path";
import { config as loadEnvironment } from "dotenv";

import { Argon2idPasswordHasher, AuthService, SessionTokenService } from "@game-platform/auth";
import { PlatformAdminService, PlayerAdminService } from "@game-platform/admin";
import { createDatabaseClient } from "@game-platform/database";
import { WalletService } from "@game-platform/wallet";
import { GameCatalogService, GameRegistry } from "@game-platform/game-core";
import { NeonReelsDefinition, NeonReelsService } from "@game-platform/neon-reels";
import { NeonMinesDefinition } from "@game-platform/neon-mines";
import { PrismaNeonMinesRepository } from "./adapters/prisma-neon-mines-repository.js";
import { DurableGameSessions } from "./game-session-application.js";

import { PrismaAuthRepository } from "./adapters/prisma-auth-repository.js";
import { PrismaPlayerAdminRepository } from "./adapters/prisma-player-admin-repository.js";
import { PrismaWalletRepository } from "./adapters/prisma-wallet-repository.js";
import { PrismaGameCatalogRepository } from "./adapters/prisma-game-catalog-repository.js";
import { PrismaNeonReelsRepository } from "./adapters/prisma-neon-reels-repository.js";
import { PrismaPlatformAdminRepository } from "./adapters/prisma-platform-admin-repository.js";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

loadEnvironment({ path: resolve(import.meta.dirname, "../../../.env"), quiet: true });

const config = loadConfig();
const database = createDatabaseClient(config.databaseUrl);
const passwordHasher = new Argon2idPasswordHasher();
const dummyPasswordHash = await passwordHasher.hash(crypto.randomUUID());
const auth = new AuthService(
  new PrismaAuthRepository(database),
  passwordHasher,
  new SessionTokenService(),
  { dummyPasswordHash }
);
const gameRegistry = new GameRegistry();
gameRegistry.register(new NeonReelsDefinition());
gameRegistry.register(new NeonMinesDefinition());
const serverInstanceId = `game-server:${crypto.randomUUID()}`;
const neonReels = new NeonReelsService(new PrismaNeonReelsRepository(database), serverInstanceId);
const neonMines = new PrismaNeonMinesRepository(database);
const gameSessions = new DurableGameSessions(database, neonReels, neonMines);
const app = buildApp(config, {
  admin: new PlayerAdminService(new PrismaPlayerAdminRepository(database), passwordHasher),
  platformAdmin: new PlatformAdminService(new PrismaPlatformAdminRepository(database), (slug, version, configuration) => gameRegistry.require(slug, version).validateConfiguration(configuration)),
  auth,
  wallet: new WalletService(new PrismaWalletRepository(database)),
  gameCatalog: new GameCatalogService(new PrismaGameCatalogRepository(database), gameRegistry),
  gameSessions,
  readinessCheck: async () => {
    const [schema] = await database.$queryRaw<{ sessionTable: string | null; stateTable: string | null }[]>`
      SELECT to_regclass('public."GameSession"')::text AS "sessionTable",
             to_regclass('public."GameSessionState"')::text AS "stateTable"`;
    if (schema?.sessionTable === null || schema?.stateTable === null || schema === undefined) throw new Error("Required database migrations are not applied");
  },
  close: async () => { clearInterval(expiryTimer); await expiryRun; await database.$disconnect(); }
});

const closeGracefully = async (signal: NodeJS.Signals): Promise<void> => {
  app.log.info({ signal }, "shutdown requested");
  await app.close();
  process.exitCode = 0;
};

let expiryRun: Promise<unknown> | null = null;
const runExpiry = () => {
  if (expiryRun !== null) return;
  expiryRun = neonMines.expireBatch().catch((error: unknown) => app.log.error({ error }, "Mines expiry sweep failed")).finally(() => { expiryRun = null; });
};
const expiryTimer = setInterval(runExpiry, 30_000);
expiryTimer.unref();
app.addHook("onReady", async () => { runExpiry(); });

process.once("SIGINT", () => void closeGracefully("SIGINT"));
process.once("SIGTERM", () => void closeGracefully("SIGTERM"));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error: unknown) {
  app.log.fatal({ error }, "server failed to start");
  process.exitCode = 1;
}
