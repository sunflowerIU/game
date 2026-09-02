import cors from "@fastify/cors";
import { AuthError } from "@game-platform/auth";
import { PlatformAdminError, PlayerAdminError } from "@game-platform/admin";
import { GameCatalogError } from "@game-platform/game-core";
import { WalletError } from "@game-platform/wallet";
import { PLATFORM_API_VERSION, type PlatformStatusResponse } from "@game-platform/contracts";
import Fastify, { type FastifyInstance } from "fastify";

import type { ServerConfig } from "./config.js";
import { registerAuthRoutes, type AuthApplication } from "./auth-routes.js";
import { registerAdminRoutes, type AdminApplication } from "./admin-routes.js";
import { AppError } from "./errors.js";
import { registerWalletRoutes, type WalletApplication } from "./wallet-routes.js";
import { registerGameRoutes, type GameCatalogApplication } from "./game-routes.js";
import { registerGameSessionRoutes, type GameSessionApplication } from "./game-session-routes.js";
import { NeonReelsError } from "@game-platform/neon-reels";
import { registerPlatformAdminRoutes, type PlatformAdminService } from "./platform-admin-routes.js";
import { registerObservability } from "./observability.js";
import { WalletEventBroker } from "./wallet-events.js";

export interface AppDependencies {
  readonly admin: AdminApplication;
  readonly platformAdmin: PlatformAdminService;
  readonly auth: AuthApplication;
  readonly wallet: WalletApplication;
  readonly gameCatalog: GameCatalogApplication;
  readonly gameSessions: GameSessionApplication;
  readonly walletEvents?: WalletEventBroker;
  readonly close?: () => Promise<void>;
  readonly readinessCheck: () => Promise<void>;
}

const healthResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "service", "timestamp"],
  properties: {
    status: { type: "string", const: "ok" },
    service: { type: "string", const: "server" },
    timestamp: { type: "string", format: "date-time" }
  }
} as const;

const platformStatusResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "service", "apiVersion", "serverTime"],
  properties: {
    status: { type: "string", const: "ok" },
    service: { type: "string", const: "game-platform-api" },
    apiVersion: { type: "string", const: PLATFORM_API_VERSION },
    serverTime: { type: "string", format: "date-time" }
  }
} as const;

export function buildApp(config: ServerConfig, dependencies: AppDependencies): FastifyInstance {
  const walletEvents = dependencies.walletEvents ?? new WalletEventBroker();
  const app = Fastify({
    requestIdHeader: "x-request-id",
    trustProxy: config.trustProxy,
    logger: config.nodeEnv === "test" ? false : {
      level: config.logLevel,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "res.headers['set-cookie']",
          "password",
          "token"
        ],
        censor: "[REDACTED]"
      }
    }
  });

  void app.register(cors, {
    credentials: true,
    methods: ["GET", "POST", "HEAD", "OPTIONS"],
    origin: config.webOrigin
  });
  registerObservability(app);

  app.get("/health/live", {
    schema: { response: { 200: healthResponseSchema } }
  }, async () => ({
    status: "ok" as const,
    service: "server" as const,
    timestamp: new Date().toISOString()
  }));

  app.get("/health/ready", {
    schema: { response: { 200: healthResponseSchema } }
  }, async () => {
    await dependencies.readinessCheck();
    return {
      status: "ok" as const,
      service: "server" as const,
      timestamp: new Date().toISOString()
    };
  });

  app.get<{ Reply: PlatformStatusResponse }>("/api/v1/platform/status", {
    schema: { response: { 200: platformStatusResponseSchema } }
  }, async () => ({
    status: "ok",
    service: "game-platform-api",
    apiVersion: PLATFORM_API_VERSION,
    serverTime: new Date().toISOString()
  }));

  void app.register(async (authenticatedScope) => {
    await registerAuthRoutes(authenticatedScope, config, dependencies.auth);
    await registerAdminRoutes(authenticatedScope, dependencies.admin);
    await registerPlatformAdminRoutes(authenticatedScope, dependencies.platformAdmin);
    await registerWalletRoutes(authenticatedScope, dependencies.wallet, walletEvents);
    await registerGameRoutes(authenticatedScope, dependencies.gameCatalog);
    await registerGameSessionRoutes(authenticatedScope, dependencies.gameSessions);
  });

  app.setErrorHandler((error, request, reply) => {
    const mapped = mapError(error);
    if (mapped.statusCode >= 500) request.log.error({ error }, "request failed");
    else request.log.warn({ code: mapped.code }, "request rejected");

    return reply.status(mapped.statusCode).send({
      error: {
        code: mapped.code,
        message: mapped.message,
        requestId: request.id
      }
    });
  });

  if (dependencies.close !== undefined) {
    app.addHook("onClose", dependencies.close);
  }

  return app;
}

function mapError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof AuthError) {
    const statusCode = error.code === "RATE_LIMITED" ? 429 : error.code === "ACCESS_DENIED" ? 403 : error.code === "INVALID_PASSWORD" ? 400 : 401;
    return new AppError(error.code, statusCode, error.message);
  }
  if (error instanceof PlayerAdminError) {
    const statusCode = error.code === "ACCESS_DENIED" ? 403
      : error.code === "PLAYER_NOT_FOUND" ? 404
        : error.code === "CONFLICT" ? 409 : 400;
    return new AppError(error.code, statusCode, error.message);
  }
  if (error instanceof PlatformAdminError) {
    const statusCode = error.code === "ACCESS_DENIED" ? 403 : error.code === "GAME_NOT_FOUND" || error.code === "PLAYER_NOT_FOUND" ? 404 : error.code === "CONFLICT" ? 409 : 400;
    return new AppError(error.code, statusCode, error.message);
  }
  if (error instanceof WalletError) {
    const statusCode = error.code === "ACCESS_DENIED" ? 403
      : error.code === "WALLET_NOT_FOUND" ? 404
        : error.code === "IDEMPOTENCY_CONFLICT" ? 409
          : error.code === "INSUFFICIENT_BALANCE" ? 422 : 400;
    return new AppError(error.code, statusCode, error.message);
  }
  if (error instanceof GameCatalogError) return new AppError(error.code, 403, error.message);
  if (error instanceof NeonReelsError) {
    const statusCode = error.code === "ACCESS_DENIED" ? 403 : error.code === "GAME_NOT_AVAILABLE" || error.code === "SESSION_NOT_FOUND" ? 404
      : error.code === "INSUFFICIENT_BALANCE" ? 422 : error.code === "INVALID_ENTRY" ? 400 : 409;
    return new AppError(error.code, statusCode, error.message);
  }
  const externalError = typeof error === "object" && error !== null
    ? error as { statusCode?: number; validation?: unknown }
    : {};
  if (externalError.statusCode === 429) return new AppError("RATE_LIMITED", 429, "Too many requests");
  if (externalError.validation !== undefined) return new AppError("INVALID_REQUEST", 400, "Request validation failed");
  return new AppError("INTERNAL_ERROR", 500, "An unexpected error occurred");
}
