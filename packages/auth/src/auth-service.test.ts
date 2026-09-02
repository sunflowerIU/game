import assert from "node:assert/strict";
import { test } from "node:test";

import { AuthService, type AuthRepository, type AccountForLogin, type AuthenticatedPrincipal, type CreateSessionInput, type LoginAuditInput, type LogoutAuditInput } from "./auth-service.js";
import { AuthError } from "./errors.js";
import type { PasswordHasher } from "./passwords.js";
import { SessionTokenService } from "./session-token.js";

class FakeRepository implements AuthRepository {
  public account: AccountForLogin | null = null;
  public failures = 0;
  public readonly events: LoginAuditInput[] = [];
  public readonly sessions: CreateSessionInput[] = [];
  public principal: AuthenticatedPrincipal | null = null;
  public revokedHash: string | null = null;
  public logoutAudit: LogoutAuditInput | null = null;
  public passwordHash: string | null = null;
  public passwordUpdate: { accountId: string; passwordHash: string; changedAt: Date } | null = null;

  public async findAccountForLogin(): Promise<AccountForLogin | null> { return this.account; }
  public async countRecentFailures(): Promise<number> { return this.failures; }
  public async recordLoginEvent(input: LoginAuditInput): Promise<void> { this.events.push(input); }
  public async createSessionAndRecordLogin(input: CreateSessionInput): Promise<void> { this.sessions.push(input); }
  public async findPrincipalBySessionHash(): Promise<AuthenticatedPrincipal | null> { return this.principal; }
  public async revokeSessionAndRecordLogout(tokenHash: string, audit: LogoutAuditInput): Promise<void> { this.revokedHash = tokenHash; this.logoutAudit = audit; }
  public async findPasswordHashByAccountId(): Promise<string | null> { return this.passwordHash; }
  public async updatePasswordAndRevokeSessions(input: { accountId: string; passwordHash: string; changedAt: Date }): Promise<void> { this.passwordUpdate = input; }
}

const passwordHasher: PasswordHasher = {
  hash: async (password) => `hash:${password}`,
  verify: async (hash, password) => hash === `hash:${password}`
};
const clock = { now: () => new Date("2026-08-24T12:00:00.000Z") };

function createService(repository: FakeRepository): AuthService {
  return new AuthService(repository, passwordHasher, new SessionTokenService(), {
    dummyPasswordHash: "hash:not-the-password",
    adminSessionTtlMs: 60_000,
    failedLoginLimit: 3,
    sessionTtlMs: 60_000
  }, clock);
}

test("valid credentials create one hashed, expiring session and success audit event", async () => {
  const repository = new FakeRepository();
  repository.account = {
    id: "account-1",
    username: "PlayerOne",
    type: "PLAYER",
    status: "ACTIVE",
    passwordHash: "hash:correct horse battery staple",
    permissions: []
  };

  const result = await createService(repository).login({
    username: " PLAYERONE ",
    password: "correct horse battery staple",
    ipAddress: "127.0.0.1",
    userAgent: "test"
  });

  assert.equal(result.account.id, "account-1");
  assert.equal(repository.sessions.length, 1);
  assert.notEqual(repository.sessions[0]?.tokenHash, result.sessionToken);
  assert.equal(repository.sessions[0]?.outcome, "SUCCESS");
  assert.equal(result.expiresAt.toISOString(), "2026-08-24T12:01:00.000Z");
});

test("invalid password produces a generic error and an immutable audit input", async () => {
  const repository = new FakeRepository();
  repository.account = {
    id: "account-1",
    username: "PlayerOne",
    type: "PLAYER",
    status: "ACTIVE",
    passwordHash: "hash:correct",
    permissions: []
  };

  await assert.rejects(
    createService(repository).login({ username: "PlayerOne", password: "wrong", ipAddress: "127.0.0.1", userAgent: null }),
    (error: unknown) => error instanceof AuthError && error.code === "INVALID_CREDENTIALS"
  );
  assert.equal(repository.sessions.length, 0);
  assert.equal(repository.events[0]?.outcome, "INVALID_CREDENTIALS");
});

test("disabled accounts cannot log in even with a valid password", async () => {
  const repository = new FakeRepository();
  repository.account = {
    id: "account-2",
    username: "DisabledPlayer",
    type: "PLAYER",
    status: "DISABLED",
    passwordHash: "hash:correct",
    permissions: []
  };

  await assert.rejects(
    createService(repository).login({ username: "DisabledPlayer", password: "correct", ipAddress: "127.0.0.1", userAgent: null }),
    (error: unknown) => error instanceof AuthError && error.code === "INVALID_CREDENTIALS"
  );
  assert.equal(repository.events[0]?.outcome, "ACCOUNT_DISABLED");
});

test("throttled credentials are rejected before session creation", async () => {
  const repository = new FakeRepository();
  repository.failures = 3;

  await assert.rejects(
    createService(repository).login({ username: "PlayerOne", password: "anything", ipAddress: "127.0.0.1", userAgent: null }),
    (error: unknown) => error instanceof AuthError && error.code === "RATE_LIMITED"
  );
  assert.equal(repository.events[0]?.outcome, "RATE_LIMITED");
});

test("expired or revoked sessions are rejected by the repository boundary", async () => {
  const repository = new FakeRepository();
  const token = new SessionTokenService().issue().token;

  await assert.rejects(
    createService(repository).authenticate(token),
    (error: unknown) => error instanceof AuthError && error.code === "AUTH_REQUIRED"
  );
});

test("logout hashes the presented token before revoking it and is idempotent", async () => {
  const repository = new FakeRepository();
  const tokenService = new SessionTokenService();
  const token = tokenService.issue().token;

  await createService(repository).logout(token, { ipAddress: "127.0.0.2", userAgent: "logout-test" });
  assert.equal(repository.revokedHash, tokenService.hash(token));
  assert.equal(repository.logoutAudit?.ipAddress, "127.0.0.2");
  assert.equal(repository.logoutAudit?.occurredAt.toISOString(), "2026-08-24T12:00:00.000Z");

  await createService(repository).logout(undefined);
  assert.equal(repository.revokedHash, tokenService.hash(token));
});

test("changing a password verifies the current password, hashes the new one, and revokes sessions", async () => {
  const repository = new FakeRepository();
  repository.passwordHash = "hash:old-password";
  const principal: AuthenticatedPrincipal = { accountId: "account-1", username: "player", type: "PLAYER", permissions: new Set(), sessionId: "session-1" };

  await createService(repository).changePassword(principal, { currentPassword: "old-password", newPassword: "new-password" });
  assert.equal(repository.passwordUpdate?.accountId, "account-1");
  assert.equal(repository.passwordUpdate?.passwordHash, "hash:new-password");
  assert.equal(repository.passwordUpdate?.changedAt.toISOString(), "2026-08-24T12:00:00.000Z");
});

test("changing a password rejects an incorrect current password", async () => {
  const repository = new FakeRepository(); repository.passwordHash = "hash:old-password";
  const principal: AuthenticatedPrincipal = { accountId: "account-1", username: "player", type: "PLAYER", permissions: new Set(), sessionId: "session-1" };
  await assert.rejects(createService(repository).changePassword(principal, { currentPassword: "wrong-password", newPassword: "new-password" }), (error: unknown) => error instanceof AuthError && error.code === "INVALID_CREDENTIALS");
  assert.equal(repository.passwordUpdate, null);
});
