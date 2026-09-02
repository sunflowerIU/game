import type { DatabaseClient } from "@game-platform/database";
import { WalletError, type LedgerRecord, type WalletMutationResult, type WalletRecord, type WalletRepository } from "@game-platform/wallet";

export class PrismaWalletRepository implements WalletRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async findWallet(accountId: string): Promise<WalletRecord | null> {
    const wallet = await this.database.wallet.findUnique({ where: { accountId } });
    return wallet === null ? null : toWalletRecord(wallet);
  }

  public async listEntries(accountId: string, limit: number): Promise<readonly LedgerRecord[] | null> {
    const wallet = await this.database.wallet.findUnique({ where: { accountId }, select: { id: true } });
    if (wallet === null) return null;
    const entries = await this.database.ledgerEntry.findMany({
      where: { walletId: wallet.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit
    });
    return entries.map(toLedgerRecord);
  }

  public async applyAdminAdjustment(input: Parameters<WalletRepository["applyAdminAdjustment"]>[0]): Promise<WalletMutationResult | null> {
    const target = await this.database.wallet.findUnique({
      where: { accountId: input.playerId },
      select: { id: true }
    });
    if (target === null) return null;

    return this.database.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<readonly { id: string }[]>`
        SELECT "id" FROM "Wallet" WHERE "id" = ${target.id}::uuid FOR UPDATE
      `;
      if (locked.length === 0) return null;

      const existing = await transaction.ledgerEntry.findUnique({
        where: { walletId_idempotencyKey: { walletId: target.id, idempotencyKey: input.idempotencyKey } }
      });
      if (existing !== null) {
        const sameRequest = existing.type === input.type
          && existing.amount === input.signedAmount
          && existing.referenceType === "ADMIN_ADJUSTMENT"
          && existing.referenceId === input.adminId
          && existing.createdById === input.adminId;
        if (!sameRequest) throw new WalletError("IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different wallet operation");
        const replayWallet = await transaction.wallet.findUniqueOrThrow({ where: { id: target.id } });
        return { wallet: toWalletRecord(replayWallet), entry: toLedgerRecord(existing), replayed: true };
      }

      const current = await transaction.wallet.findUniqueOrThrow({ where: { id: target.id } });
      const nextBalance = current.balance + input.signedAmount;
      if (nextBalance < 0n) throw new WalletError("INSUFFICIENT_BALANCE", "Wallet has insufficient balance");

      const updated = await transaction.wallet.update({
        where: { id: current.id },
        data: { balance: nextBalance, version: { increment: 1 } }
      });
      const entry = await transaction.ledgerEntry.create({
        data: {
          walletId: current.id,
          type: input.type,
          amount: input.signedAmount,
          balanceBefore: current.balance,
          balanceAfter: nextBalance,
          referenceType: "ADMIN_ADJUSTMENT",
          referenceId: input.adminId,
          idempotencyKey: input.idempotencyKey,
          createdByType: "ADMIN",
          createdById: input.adminId,
          metadata: { reason: input.reason }
        }
      });
      await transaction.adminAuditLog.create({
        data: {
          adminId: input.adminId,
          action: input.type === "ADMIN_DEPOSIT" ? "WALLET_CREDITED" : "WALLET_DEBITED",
          targetType: "ACCOUNT",
          targetAccountId: input.playerId,
          before: { balance: current.balance.toString(), version: current.version },
          after: { balance: updated.balance.toString(), version: updated.version, ledgerEntryId: entry.id },
          reason: input.reason,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          createdAt: input.occurredAt
        }
      });
      return { wallet: toWalletRecord(updated), entry: toLedgerRecord(entry), replayed: false };
    }, { isolationLevel: "ReadCommitted" });
  }
}

function toWalletRecord(wallet: { accountId: string; balance: bigint; version: number; updatedAt: Date }): WalletRecord {
  return { accountId: wallet.accountId, balance: wallet.balance, version: wallet.version, updatedAt: wallet.updatedAt };
}

function toLedgerRecord(entry: {
  id: string;
  type: LedgerRecord["type"];
  amount: bigint;
  balanceBefore: bigint;
  balanceAfter: bigint;
  referenceType: string;
  referenceId: string;
  createdAt: Date;
}): LedgerRecord {
  return { id: entry.id, type: entry.type, amount: entry.amount, balanceBefore: entry.balanceBefore, balanceAfter: entry.balanceAfter, referenceType: entry.referenceType, referenceId: entry.referenceId, createdAt: entry.createdAt };
}
