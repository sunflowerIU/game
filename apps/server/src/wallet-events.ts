import type { WalletUpdateEvent } from "@game-platform/contracts";

type WalletEventListener = (event: WalletUpdateEvent) => void;

export class WalletEventBroker {
  private readonly listeners = new Map<string, Set<WalletEventListener>>();

  public publish(event: WalletUpdateEvent): void {
    for (const listener of this.listeners.get(event.wallet.accountId) ?? []) {
      try { listener(event); } catch { /* A disconnected client cannot roll back an already committed wallet update. */ }
    }
  }

  public subscribe(accountId: string, listener: WalletEventListener): () => void {
    const accountListeners = this.listeners.get(accountId) ?? new Set<WalletEventListener>();
    accountListeners.add(listener);
    this.listeners.set(accountId, accountListeners);
    return () => {
      accountListeners.delete(listener);
      if (accountListeners.size === 0) this.listeners.delete(accountId);
    };
  }
}
