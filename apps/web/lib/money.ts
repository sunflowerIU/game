const CENTS_PER_COIN = 100n;

export function formatCents(value: string | number | bigint): string {
  const cents = typeof value === "bigint" ? value : BigInt(value);
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const coins = absolute / CENTS_PER_COIN;
  const fraction = (absolute % CENTS_PER_COIN).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${coins}.${fraction}`;
}

export function coinsToCents(value: FormDataEntryValue | string | number | null): number {
  const normalized = String(value ?? "").trim();
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/u.exec(normalized);
  if (match === null) throw new Error("Enter a valid coin amount with no more than two decimal places.");
  const cents = BigInt(match[1] ?? "0") * CENTS_PER_COIN + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Coin amount is too large.");
  return Number(cents);
}
