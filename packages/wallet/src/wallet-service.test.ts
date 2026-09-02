import assert from "node:assert/strict";
import { test } from "node:test";
import { WalletError, WalletService, type WalletRepository } from "./wallet-service.js";

const now = new Date("2026-08-25T10:00:00.000Z");
const wallet = { accountId: "player-1", balance: 25n, version: 2, updatedAt: now };
const entry = { id: "entry-1", type: "ADMIN_DEPOSIT" as const, amount: 25n, balanceBefore: 0n, balanceAfter: 25n, referenceType: "ADMIN_ADJUSTMENT", referenceId: "admin-1", createdAt: now };

class FakeRepository implements WalletRepository {
  public lastAdjustment: Parameters<WalletRepository["applyAdminAdjustment"]>[0] | null = null;
  public async findWallet() { return wallet; }
  public async listEntries() { return [entry]; }
  public async applyAdminAdjustment(input: Parameters<WalletRepository["applyAdminAdjustment"]>[0]) {
    this.lastAdjustment = input;
    return { wallet, entry, replayed: false };
  }
}

const player = { accountId: "player-1", type: "PLAYER" as const, permissions: new Set<string>() };
const admin = { accountId: "admin-1", type: "ADMIN" as const, permissions: new Set(["WALLET_CREDIT", "WALLET_DEBIT"]) };
const context = { playerId: "player-1", amount: 10n, idempotencyKey: "request-0000000001", reason: "Manual award", ipAddress: "127.0.0.1", userAgent: null };

test("players can read only their own wallet and history", async () => {
  const service = new WalletService(new FakeRepository());
  assert.equal((await service.getOwnWallet(player)).balance, 25n);
  assert.equal((await service.listOwnEntries(player)).length, 1);
  await assert.rejects(service.getOwnWallet(admin), (error: unknown) => error instanceof WalletError && error.code === "ACCESS_DENIED");
});

test("credit and debit pass correctly signed amounts", async () => {
  const repository = new FakeRepository();
  const service = new WalletService(repository, { now: () => now });
  await service.credit(admin, context);
  assert.equal(repository.lastAdjustment?.signedAmount, 10n);
  await service.debit(admin, context);
  assert.equal(repository.lastAdjustment?.signedAmount, -10n);
  assert.equal(repository.lastAdjustment?.occurredAt, now);
});

test("permissions and adjustment bounds are enforced before persistence", async () => {
  const service = new WalletService(new FakeRepository());
  await assert.rejects(service.credit(player, context), (error: unknown) => error instanceof WalletError && error.code === "ACCESS_DENIED");
  await assert.rejects(service.credit(admin, { ...context, amount: 0n }), (error: unknown) => error instanceof WalletError && error.code === "INVALID_AMOUNT");
  await assert.rejects(service.credit(admin, { ...context, amount: 1_000_000_001n }), (error: unknown) => error instanceof WalletError && error.code === "INVALID_AMOUNT");
});
