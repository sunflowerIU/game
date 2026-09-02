import { hasPermission, type AuthorizedPrincipal } from "@game-platform/auth";

export type LedgerEntryType = "ADMIN_DEPOSIT" | "ADMIN_DEBIT" | "GAME_ENTRY" | "GAME_REWARD" | "REDEMPTION" | "REFUND" | "BONUS" | "ADJUSTMENT";

export interface WalletRecord {
  readonly accountId: string;
  readonly balance: bigint;
  readonly version: number;
  readonly updatedAt: Date;
}

export interface LedgerRecord {
  readonly id: string;
  readonly type: LedgerEntryType;
  readonly amount: bigint;
  readonly balanceBefore: bigint;
  readonly balanceAfter: bigint;
  readonly referenceType: string;
  readonly referenceId: string;
  readonly createdAt: Date;
}

export interface WalletMutationResult {
  readonly wallet: WalletRecord;
  readonly entry: LedgerRecord;
  readonly replayed: boolean;
}

export interface WalletRepository {
  findWallet(accountId: string): Promise<WalletRecord | null>;
  listEntries(accountId: string, limit: number): Promise<readonly LedgerRecord[] | null>;
  applyAdminAdjustment(input: {
    readonly playerId: string;
    readonly signedAmount: bigint;
    readonly type: "ADMIN_DEPOSIT" | "ADMIN_DEBIT";
    readonly idempotencyKey: string;
    readonly reason: string;
    readonly adminId: string;
    readonly ipAddress: string;
    readonly userAgent: string | null;
    readonly occurredAt: Date;
  }): Promise<WalletMutationResult | null>;
}

export class WalletError extends Error {
  public constructor(
    public readonly code: "ACCESS_DENIED" | "IDEMPOTENCY_CONFLICT" | "INSUFFICIENT_BALANCE" | "INVALID_AMOUNT" | "INVALID_REQUEST" | "WALLET_NOT_FOUND",
    message: string
  ) {
    super(message);
    this.name = "WalletError";
  }
}

const MAX_ADMIN_ADJUSTMENT = 1_000_000_000n;

export class WalletService {
  public constructor(
    private readonly repository: WalletRepository,
    private readonly clock: { now(): Date } = { now: () => new Date() }
  ) {}

  public async getOwnWallet(principal: AuthorizedPrincipal): Promise<WalletRecord> {
    requirePlayer(principal);
    const wallet = await this.repository.findWallet(principal.accountId);
    if (wallet === null) throw new WalletError("WALLET_NOT_FOUND", "Wallet not found");
    return wallet;
  }

  public async listOwnEntries(principal: AuthorizedPrincipal): Promise<readonly LedgerRecord[]> {
    requirePlayer(principal);
    const entries = await this.repository.listEntries(principal.accountId, 100);
    if (entries === null) throw new WalletError("WALLET_NOT_FOUND", "Wallet not found");
    return entries;
  }

  public credit(principal: AuthorizedPrincipal, input: AdminAdjustmentInput): Promise<WalletMutationResult> {
    return this.adjust(principal, input, "ADMIN_DEPOSIT");
  }

  public debit(principal: AuthorizedPrincipal, input: AdminAdjustmentInput): Promise<WalletMutationResult> {
    return this.adjust(principal, input, "ADMIN_DEBIT");
  }

  private async adjust(principal: AuthorizedPrincipal, input: AdminAdjustmentInput, type: "ADMIN_DEPOSIT" | "ADMIN_DEBIT"): Promise<WalletMutationResult> {
    const permission = type === "ADMIN_DEPOSIT" ? "WALLET_CREDIT" : "WALLET_DEBIT";
    if (!hasPermission(principal, permission)) throw new WalletError("ACCESS_DENIED", "Access denied");
    if (input.amount <= 0n || input.amount > MAX_ADMIN_ADJUSTMENT) {
      throw new WalletError("INVALID_AMOUNT", "Amount must be between 1 and 1000000000 coins");
    }
    const reason = input.reason.trim();
    if (reason.length < 3 || reason.length > 500) throw new WalletError("INVALID_REQUEST", "A reason between 3 and 500 characters is required");
    if (!/^[A-Za-z0-9._:-]{16,100}$/u.test(input.idempotencyKey)) throw new WalletError("INVALID_REQUEST", "Invalid idempotency key");

    const result = await this.repository.applyAdminAdjustment({
      ...input,
      reason,
      signedAmount: type === "ADMIN_DEBIT" ? -input.amount : input.amount,
      type,
      adminId: principal.accountId,
      occurredAt: this.clock.now()
    });
    if (result === null) throw new WalletError("WALLET_NOT_FOUND", "Player wallet not found");
    return result;
  }
}

export interface AdminAdjustmentInput {
  readonly playerId: string;
  readonly amount: bigint;
  readonly idempotencyKey: string;
  readonly reason: string;
  readonly ipAddress: string;
  readonly userAgent: string | null;
}

function requirePlayer(principal: AuthorizedPrincipal): void {
  if (principal.type !== "PLAYER") throw new WalletError("ACCESS_DENIED", "Player wallet access required");
}
