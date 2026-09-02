import type {
  AccountForLogin,
  AuthRepository,
  AuthenticatedPrincipal,
  CreateSessionInput,
  LoginAuditInput,
  LogoutAuditInput
} from "@game-platform/auth";
import type { DatabaseClient } from "@game-platform/database";

const adminAuthorizationInclude = {
  roleAssignments: {
    include: {
      role: {
        include: {
          grants: { include: { permission: true } }
        }
      }
    }
  }
} as const;

export class PrismaAuthRepository implements AuthRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async findAccountForLogin(usernameNormalized: string): Promise<AccountForLogin | null> {
    const account = await this.database.account.findUnique({
      where: { usernameNormalized },
      include: {
        credential: true,
        adminProfile: { include: adminAuthorizationInclude }
      }
    });

    if (account === null || account.credential === null) return null;

    return {
      id: account.id,
      username: account.username,
      type: account.type,
      status: account.status,
      passwordHash: account.credential.passwordHash,
      permissions: collectPermissions(account.adminProfile)
    };
  }

  public async countRecentFailures(usernameNormalized: string, ipAddress: string, since: Date): Promise<number> {
    return this.database.loginEvent.count({
      where: {
        createdAt: { gte: since },
        outcome: { in: ["INVALID_CREDENTIALS", "ACCOUNT_DISABLED", "RATE_LIMITED"] },
        OR: [{ usernameNormalized }, { ipAddress }]
      }
    });
  }

  public async recordLoginEvent(input: LoginAuditInput): Promise<void> {
    await this.database.loginEvent.create({ data: toLoginEventData(input) });
  }

  public async createSessionAndRecordLogin(input: CreateSessionInput): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      await transaction.authSession.create({
        data: {
          accountId: input.accountId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent
        }
      });
      await transaction.loginEvent.create({ data: toLoginEventData(input) });
      await transaction.playerProfile.updateMany({
        where: { accountId: input.accountId },
        data: { lastLoginAt: input.occurredAt }
      });
    });
  }

  public async findPrincipalBySessionHash(tokenHash: string, now: Date): Promise<AuthenticatedPrincipal | null> {
    const session = await this.database.authSession.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: now },
        account: { status: "ACTIVE" }
      },
      include: {
        account: {
          include: { adminProfile: { include: adminAuthorizationInclude } }
        }
      }
    });

    if (session === null) return null;

    return {
      accountId: session.account.id,
      username: session.account.username,
      type: session.account.type,
      permissions: new Set(collectPermissions(session.account.adminProfile)),
      sessionId: session.id
    };
  }

  public async revokeSessionAndRecordLogout(tokenHash: string, audit: LogoutAuditInput): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      const session = await transaction.authSession.findUnique({
        where: { tokenHash },
        include: { account: { select: { id: true, usernameNormalized: true, type: true } } }
      });
      if (session === null || session.revokedAt !== null) return;

      const revoked = await transaction.authSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: audit.occurredAt, revokeReason: "LOGOUT" }
      });
      if (revoked.count === 0 || session.account.type !== "PLAYER") return;

      await transaction.loginEvent.create({
        data: {
          accountId: session.account.id,
          usernameNormalized: session.account.usernameNormalized,
          outcome: "LOGOUT",
          ipAddress: audit.ipAddress,
          userAgent: audit.userAgent,
          createdAt: audit.occurredAt
        }
      });
    });
  }

  public async findPasswordHashByAccountId(accountId: string): Promise<string | null> {
    return (await this.database.credential.findUnique({ where: { accountId }, select: { passwordHash: true } }))?.passwordHash ?? null;
  }

  public async updatePasswordAndRevokeSessions(input: { readonly accountId: string; readonly passwordHash: string; readonly changedAt: Date }): Promise<void> {
    await this.database.$transaction([
      this.database.credential.update({ where: { accountId: input.accountId }, data: { passwordHash: input.passwordHash, passwordChangedAt: input.changedAt, passwordVersion: { increment: 1 } } }),
      this.database.authSession.updateMany({ where: { accountId: input.accountId, revokedAt: null }, data: { revokedAt: input.changedAt, revokeReason: "PASSWORD_CHANGED" } })
    ]);
  }
}

interface AdminAuthorizationShape {
  readonly roleAssignments: ReadonlyArray<{
    readonly role: {
      readonly grants: ReadonlyArray<{ readonly permission: { readonly code: string } }>;
    };
  }>;
}

function collectPermissions(adminProfile: AdminAuthorizationShape | null): string[] {
  if (adminProfile === null) return [];
  return [...new Set(adminProfile.roleAssignments.flatMap(
    (assignment) => assignment.role.grants.map((grant) => grant.permission.code)
  ))].sort();
}

function toLoginEventData(input: LoginAuditInput) {
  return {
    accountId: input.accountId,
    usernameNormalized: input.usernameNormalized,
    outcome: input.outcome,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    createdAt: input.occurredAt
  } as const;
}
