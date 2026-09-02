import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { AuthError, hasPermission, type AdminPermission, type AuthenticatedPrincipal, type LoginCommand, type LoginResult } from "@game-platform/auth";
import type { LoginResponse, MeResponse } from "@game-platform/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { ServerConfig } from "./config.js";

export interface AuthApplication {
  login(command: LoginCommand): Promise<LoginResult>;
  authenticate(sessionToken: string | undefined): Promise<AuthenticatedPrincipal>;
  logout(sessionToken: string | undefined, context?: { readonly ipAddress: string; readonly userAgent: string | null }): Promise<void>;
  changePassword(principal: AuthenticatedPrincipal, input: { readonly currentPassword: string; readonly newPassword: string }): Promise<void>;
}

interface LoginBody {
  readonly username: string;
  readonly password: string;
}

interface ChangePasswordBody { readonly currentPassword: string; readonly newPassword: string; }

const loginBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["username", "password"],
  properties: {
    username: { type: "string", minLength: 3, maxLength: 32, pattern: "^[A-Za-z0-9_.-]+$" },
    password: { type: "string", minLength: 1, maxLength: 1024 }
  }
} as const;

const accountProperties = {
  id: { type: "string", format: "uuid" },
  username: { type: "string" },
  type: { type: "string", enum: ["PLAYER", "ADMIN"] }
} as const;

const loginResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["account", "expiresAt"],
  properties: {
    account: {
      type: "object",
      additionalProperties: false,
      required: ["id", "username", "type"],
      properties: accountProperties
    },
    expiresAt: { type: "string", format: "date-time" }
  }
} as const;

const meResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "username", "type", "permissions"],
  properties: {
    ...accountProperties,
    permissions: { type: "array", items: { type: "string" }, uniqueItems: true }
  }
} as const;

export async function registerAuthRoutes(
  app: FastifyInstance,
  config: ServerConfig,
  auth: AuthApplication
): Promise<void> {
  const cookieName = config.nodeEnv === "production" ? "__Host-gp_session" : "gp_session";
  const cookieOptions = {
    httpOnly: true,
    path: "/",
    sameSite: "strict" as const,
    secure: config.nodeEnv === "production"
  };

  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    hook: "preHandler"
  });

  app.decorateRequest("principal", null);
  app.decorate("authenticate", async (request: FastifyRequest) => {
    request.principal = await auth.authenticate(request.cookies[cookieName]);
  });
  app.decorate("authorize", (permission: AdminPermission) => async (request: FastifyRequest, reply: FastifyReply) => {
    await app.authenticate(request, reply);
    if (request.principal === null || !hasPermission(request.principal, permission)) {
      throw new AuthError("ACCESS_DENIED", "Access denied");
    }
  });

  app.post<{ Body: LoginBody; Reply: LoginResponse }>("/api/v1/auth/login", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: {
      body: loginBodySchema,
      response: { 200: loginResponseSchema }
    }
  }, async (request, reply) => {
    const result = await auth.login({
      username: request.body.username,
      password: request.body.password,
      ipAddress: request.ip,
      userAgent: normalizeUserAgent(request.headers["user-agent"])
    });

    reply.setCookie(cookieName, result.sessionToken, {
      ...cookieOptions,
      expires: result.expiresAt
    });

    return {
      account: result.account,
      expiresAt: result.expiresAt.toISOString()
    };
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    await auth.logout(request.cookies[cookieName], {
      ipAddress: request.ip,
      userAgent: normalizeUserAgent(request.headers["user-agent"])
    });
    reply.clearCookie(cookieName, cookieOptions);
    return reply.status(204).send();
  });

  app.post<{ Body: ChangePasswordBody }>("/api/v1/auth/password", {
    preHandler: app.authenticate,
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    schema: { body: { type: "object", additionalProperties: false, required: ["currentPassword", "newPassword"], properties: { currentPassword: { type: "string", minLength: 1, maxLength: 1024 }, newPassword: { type: "string", minLength: 8, maxLength: 1024 } } } }
  }, async (request, reply) => {
    await auth.changePassword(requirePrincipal(request.principal), request.body);
    reply.clearCookie(cookieName, cookieOptions);
    return reply.status(204).send();
  });

  app.get<{ Reply: MeResponse }>("/api/v1/me", {
    preHandler: app.authenticate,
    schema: { response: { 200: meResponseSchema } }
  }, async (request) => {
    const principal = requirePrincipal(request.principal);
    return {
      id: principal.accountId,
      username: principal.username,
      type: principal.type,
      permissions: [...principal.permissions].sort()
    };
  });
}

function normalizeUserAgent(userAgent: string | undefined): string | null {
  return userAgent === undefined ? null : userAgent.slice(0, 512);
}

function requirePrincipal(principal: AuthenticatedPrincipal | null): AuthenticatedPrincipal {
  if (principal === null) throw new Error("Authentication hook did not set a principal");
  return principal;
}

declare module "fastify" {
  interface FastifyRequest {
    principal: AuthenticatedPrincipal | null;
  }

  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authorize: (permission: AdminPermission) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
