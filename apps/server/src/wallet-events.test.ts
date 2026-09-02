import assert from "node:assert/strict";
import test from "node:test";

import type { WalletUpdateEvent } from "@game-platform/contracts";

import { WalletEventBroker } from "./wallet-events.js";

const update: WalletUpdateEvent = {
  type: "wallet.updated",
  wallet: {
    accountId: "5fdb5ce8-a3c9-41f7-bd25-4072f67123e1",
    balance: "1250",
    version: 4,
    updatedAt: "2026-09-01T10:00:00.000Z"
  }
};

test("wallet events reach only the matching account and can unsubscribe", () => {
  const broker = new WalletEventBroker();
  const received: WalletUpdateEvent[] = [];
  const unrelated: WalletUpdateEvent[] = [];
  const unsubscribe = broker.subscribe(update.wallet.accountId, (event) => received.push(event));
  broker.subscribe("fa05dfb8-e4e3-49f6-bd92-50d086b28294", (event) => unrelated.push(event));

  broker.publish(update);
  unsubscribe();
  broker.publish(update);

  assert.deepEqual(received, [update]);
  assert.deepEqual(unrelated, []);
});

test("a failed listener cannot block delivery or fail a committed wallet update", () => {
  const broker = new WalletEventBroker();
  const received: WalletUpdateEvent[] = [];
  broker.subscribe(update.wallet.accountId, () => { throw new Error("disconnected"); });
  broker.subscribe(update.wallet.accountId, (event) => received.push(event));

  assert.doesNotThrow(() => broker.publish(update));
  assert.deepEqual(received, [update]);
});
