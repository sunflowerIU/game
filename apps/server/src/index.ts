import { resolve } from "node:path";
import { config as loadEnvironment } from "dotenv";

import { Argon2idPasswordHasher, AuthService, SessionTokenService } from "@game-platform/auth";
import { PlatformAdminService, PlayerAdminService } from "@game-platform/admin";
import { createDatabaseClient } from "@game-platform/database";
import { WalletService } from "@game-platform/wallet";
import { GameCatalogService, GameRegistry } from "@game-platform/game-core";
import { NeonReelsDefinition, NeonReelsService } from "@game-platform/neon-reels";

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
const serverInstanceId = `game-server:${crypto.randomUUID()}`;
const neonReels = new NeonReelsService(new PrismaNeonReelsRepository(database), serverInstanceId);
const gameSessions = {
  start: neonReels.spin.bind(neonReels),
  history: neonReels.history.bind(neonReels),
  resume: neonReels.resume.bind(neonReels)
};
const app = buildApp(config, {
  admin: new PlayerAdminService(new PrismaPlayerAdminRepository(database), passwordHasher),
  platformAdmin: new PlatformAdminService(new PrismaPlatformAdminRepository(database), (slug, version, configuration) => gameRegistry.require(slug, version).validateConfiguration(configuration)),
  auth,
  wallet: new WalletService(new PrismaWalletRepository(database)),
  gameCatalog: new GameCatalogService(new PrismaGameCatalogRepository(database), gameRegistry),
  gameSessions,
  readinessCheck: async () => { await database.$queryRaw`SELECT 1`; },
  close: async () => database.$disconnect()
});

const closeGracefully = async (signal: NodeJS.Signals): Promise<void> => {
  app.log.info({ signal }, "shutdown requested");
  await app.close();
  process.exitCode = 0;
};

process.once("SIGINT", () => void closeGracefully("SIGINT"));
process.once("SIGTERM", () => void closeGracefully("SIGTERM"));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error: unknown) {
  app.log.fatal({ error }, "server failed to start");
  process.exitCode = 1;
}
