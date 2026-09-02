import { AuthError } from "./errors.js";
import type { PasswordHasher } from "./passwords.js";
import { SessionTokenService } from "./session-token.js";

export type PrincipalType = "PLAYER" | "ADMIN";
export type AccountStatus = "ACTIVE" | "DISABLED";
export type LoginOutcome = "SUCCESS" | "LOGOUT" | "INVALID_CREDENTIALS" | "ACCOUNT_DISABLED" | "RATE_LIMITED";

export interface AccountForLogin {
  readonly id: string;
  readonly username: string;
  readonly type: PrincipalType;
  readonly status: AccountStatus;
  readonly passwordHash: string;
  readonly permissions: readonly string[];
}

export interface AuthenticatedPrincipal {
  readonly accountId: string;
  readonly username: string;
  readonly type: PrincipalType;
  readonly permissions: ReadonlySet<string>;
  readonly sessionId: string;
}

export interface LoginAuditInput {
  readonly accountId: string | null;
  readonly usernameNormalized: string;
  readonly outcome: LoginOutcome;
  readonly ipAddress: string;
  readonly userAgent: string | null;
  readonly occurredAt: Date;
}

export interface CreateSessionInput extends LoginAuditInput {
  readonly accountId: string;
  readonly outcome: "SUCCESS";
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

export interface LogoutAuditInput {
  readonly ipAddress: string;
  readonly userAgent: string | null;
  readonly occurredAt: Date;
}

export interface AuthRepository {
  findAccountForLogin(usernameNormalized: string): Promise<AccountForLogin | null>;
  countRecentFailures(usernameNormalized: string, ipAddress: string, since: Date): Promise<number>;
  recordLoginEvent(input: LoginAuditInput): Promise<void>;
  createSessionAndRecordLogin(input: CreateSessionInput): Promise<void>;
  findPrincipalBySessionHash(tokenHash: string, now: Date): Promise<AuthenticatedPrincipal | null>;
  revokeSessionAndRecordLogout(tokenHash: string, audit: LogoutAuditInput): Promise<void>;
  findPasswordHashByAccountId(accountId: string): Promise<string | null>;
  updatePasswordAndRevokeSessions(input: { readonly accountId: string; readonly passwordHash: string; readonly changedAt: Date }): Promise<void>;
}

export interface LoginCommand {
  readonly username: string;
  readonly password: string;
  readonly ipAddress: string;
  readonly userAgent: string | null;
}

export interface LoginResult {
  readonly account: {
    readonly id: string;
    readonly username: string;
    readonly type: PrincipalType;
  };
  readonly sessionToken: string;
  readonly expiresAt: Date;
}

export interface Clock {
  now(): Date;
}

export interface AuthServiceOptions {
  readonly adminSessionTtlMs?: number;
  readonly dummyPasswordHash: string;
  readonly failedLoginLimit?: number;
  readonly failedLoginWindowMs?: number;
  readonly sessionTtlMs?: number;
}

const DEFAULT_FAILED_LOGIN_LIMIT = 5;
const DEFAULT_FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1_000;
const DEFAULT_ADMIN_SESSION_TTL_MS = 2 * 60 * 60 * 1_000;
const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1_000;

export class AuthService {
  readonly #clock: Clock;
  readonly #adminSessionTtlMs: number;
  readonly #dummyPasswordHash: string;
  readonly #failedLoginLimit: number;
  readonly #failedLoginWindowMs: number;
  readonly #passwordHasher: PasswordHasher;
  readonly #repository: AuthRepository;
  readonly #sessionTokenService: SessionTokenService;
  readonly #sessionTtlMs: number;

  public constructor(
    repository: AuthRepository,
    passwordHasher: PasswordHasher,
    sessionTokenService: SessionTokenService,
    options: AuthServiceOptions,
    clock: Clock = { now: () => new Date() }
  ) {
    this.#repository = repository;
    this.#passwordHasher = passwordHasher;
    this.#sessionTokenService = sessionTokenService;
    this.#dummyPasswordHash = options.dummyPasswordHash;
    this.#adminSessionTtlMs = options.adminSessionTtlMs ?? DEFAULT_ADMIN_SESSION_TTL_MS;
    this.#failedLoginLimit = options.failedLoginLimit ?? DEFAULT_FAILED_LOGIN_LIMIT;
    this.#failedLoginWindowMs = options.failedLoginWindowMs ?? DEFAULT_FAILED_LOGIN_WINDOW_MS;
    this.#sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.#clock = clock;
  }

  public async login(command: LoginCommand): Promise<LoginResult> {
    const now = this.#clock.now();
    const usernameNormalized = normalizeUsername(command.username);
    const recentFailureCount = await this.#repository.countRecentFailures(
      usernameNormalized,
      command.ipAddress,
      new Date(now.getTime() - this.#failedLoginWindowMs)
    );

    if (recentFailureCount >= this.#failedLoginLimit) {
      await this.#repository.recordLoginEvent({
        accountId: null,
        usernameNormalized,
        outcome: "RATE_LIMITED",
        ipAddress: command.ipAddress,
        userAgent: command.userAgent,
        occurredAt: now
      });
      throw new AuthError("RATE_LIMITED", "Too many authentication attempts");
    }

    const account = await this.#repository.findAccountForLogin(usernameNormalized);
    const passwordMatches = await this.#passwordHasher.verify(
      account?.passwordHash ?? this.#dummyPasswordHash,
      command.password
    );

    if (account === null || !passwordMatches || account.status !== "ACTIVE") {
      await this.#repository.recordLoginEvent({
        accountId: account?.id ?? null,
        usernameNormalized,
        outcome: account?.status === "DISABLED" && passwordMatches ? "ACCOUNT_DISABLED" : "INVALID_CREDENTIALS",
        ipAddress: command.ipAddress,
        userAgent: command.userAgent,
        occurredAt: now
      });
      throw new AuthError("INVALID_CREDENTIALS", "Invalid username or password");
    }

    const session = this.#sessionTokenService.issue();
    const sessionTtlMs = account.type === "ADMIN" ? this.#adminSessionTtlMs : this.#sessionTtlMs;
    const expiresAt = new Date(now.getTime() + sessionTtlMs);
    await this.#repository.createSessionAndRecordLogin({
      accountId: account.id,
      usernameNormalized,
      outcome: "SUCCESS",
      ipAddress: command.ipAddress,
      userAgent: command.userAgent,
      occurredAt: now,
      tokenHash: session.hash,
      expiresAt
    });

    return {
      account: { id: account.id, username: account.username, type: account.type },
      sessionToken: session.token,
      expiresAt
    };
  }

  public async authenticate(sessionToken: string | undefined): Promise<AuthenticatedPrincipal> {
    if (sessionToken === undefined) throw new AuthError("AUTH_REQUIRED", "Authentication required");

    let tokenHash: string;
    try {
      tokenHash = this.#sessionTokenService.hash(sessionToken);
    } catch {
      throw new AuthError("AUTH_REQUIRED", "Authentication required");
    }

    const principal = await this.#repository.findPrincipalBySessionHash(tokenHash, this.#clock.now());
    if (principal === null) throw new AuthError("AUTH_REQUIRED", "Authentication required");
    return principal;
  }

  public async logout(sessionToken: string | undefined, context?: Omit<LogoutAuditInput, "occurredAt">): Promise<void> {
    if (sessionToken === undefined) return;

    try {
      await this.#repository.revokeSessionAndRecordLogout(this.#sessionTokenService.hash(sessionToken), {
        ipAddress: context?.ipAddress ?? "unknown",
        userAgent: context?.userAgent ?? null,
        occurredAt: this.#clock.now()
      });
    } catch {
      // Logout is intentionally idempotent for malformed, expired, or repeated cookies.
    }
  }

  public async changePassword(principal: AuthenticatedPrincipal, input: { readonly currentPassword: string; readonly newPassword: string }): Promise<void> {
    if (input.newPassword.length < 8 || input.newPassword.length > 1024) throw new AuthError("INVALID_PASSWORD", "New password must be at least 8 characters");
    if (input.currentPassword === input.newPassword) throw new AuthError("INVALID_PASSWORD", "New password must be different from the current password");
    const currentHash = await this.#repository.findPasswordHashByAccountId(principal.accountId);
    if (currentHash === null || !(await this.#passwordHasher.verify(currentHash, input.currentPassword))) throw new AuthError("INVALID_CREDENTIALS", "Current password is incorrect");
    await this.#repository.updatePasswordAndRevokeSessions({ accountId: principal.accountId, passwordHash: await this.#passwordHasher.hash(input.newPassword), changedAt: this.#clock.now() });
  }
}

export function normalizeUsername(username: string): string {
  return username.trim().toLocaleLowerCase("en-US");
}
