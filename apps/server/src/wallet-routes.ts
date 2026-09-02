import type { AuthorizedPrincipal } from "@game-platform/auth";
import type { LedgerEntrySummary, WalletHistoryResponse, WalletMutationResponse, WalletResponse, WalletSummary, WalletUpdateEvent } from "@game-platform/contracts";
import type { LedgerRecord, WalletMutationResult, WalletRecord } from "@game-platform/wallet";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WalletEventBroker } from "./wallet-events.js";

interface PlayerParams { readonly playerId: string }
interface AdjustmentBody { readonly amount: number; readonly reason: string }
interface IdempotencyHeaders { readonly "idempotency-key": string }

export interface WalletApplication {
  getOwnWallet(principal: AuthorizedPrincipal): Promise<WalletRecord>;
  listOwnEntries(principal: AuthorizedPrincipal): Promise<readonly LedgerRecord[]>;
  credit(principal: AuthorizedPrincipal, input: AdjustmentInput): Promise<WalletMutationResult>;
  debit(principal: AuthorizedPrincipal, input: AdjustmentInput): Promise<WalletMutationResult>;
}

interface AdjustmentInput {
  readonly playerId: string;
  readonly amount: bigint;
  readonly idempotencyKey: string;
  readonly reason: string;
  readonly ipAddress: string;
  readonly userAgent: string | null;
}

const walletSchema = {
  type: "object", additionalProperties: false, required: ["accountId", "balance", "version", "updatedAt"],
  properties: { accountId: { type: "string", format: "uuid" }, balance: { type: "string", pattern: "^[0-9]+$" }, version: { type: "integer", minimum: 0 }, updatedAt: { type: "string", format: "date-time" } }
} as const;
const entrySchema = {
  type: "object", additionalProperties: false, required: ["id", "type", "amount", "balanceBefore", "balanceAfter", "referenceType", "referenceId", "createdAt"],
  properties: {
    id: { type: "string", format: "uuid" },
    type: { type: "string", enum: ["ADMIN_DEPOSIT", "ADMIN_DEBIT", "GAME_ENTRY", "GAME_REWARD", "REDEMPTION", "REFUND", "BONUS", "ADJUSTMENT"] },
    amount: { type: "string", pattern: "^-?[0-9]+$" }, balanceBefore: { type: "string", pattern: "^[0-9]+$" }, balanceAfter: { type: "string", pattern: "^[0-9]+$" },
    referenceType: { type: "string" }, referenceId: { type: "string" }, createdAt: { type: "string", format: "date-time" }
  }
} as const;
const paramsSchema = { type: "object", additionalProperties: false, required: ["playerId"], properties: { playerId: { type: "string", format: "uuid" } } } as const;
const headersSchema = { type: "object", required: ["idempotency-key"], properties: { "idempotency-key": { type: "string", minLength: 16, maxLength: 100, pattern: "^[A-Za-z0-9._:-]+$" } } } as const;
const adjustmentBodySchema = { type: "object", additionalProperties: false, required: ["amount", "reason"], properties: { amount: { type: "integer", minimum: 1, maximum: 1_000_000_000 }, reason: { type: "string", minLength: 3, maxLength: 500 } } } as const;
const mutationSchema = { type: "object", additionalProperties: false, required: ["wallet", "entry", "replayed"], properties: { wallet: walletSchema, entry: entrySchema, replayed: { type: "boolean" } } } as const;

export async function registerWalletRoutes(app: FastifyInstance, wallet: WalletApplication, walletEvents: WalletEventBroker): Promise<void> {
  app.get<{ Reply: WalletResponse }>("/api/v1/wallet", { preHandler: app.authenticate, schema: { response: { 200: { type: "object", required: ["wallet"], properties: { wallet: walletSchema } } } } }, async (request) => ({ wallet: toWalletSummary(await wallet.getOwnWallet(requirePrincipal(request))) }));

  app.get("/api/v1/wallet/events", { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    const initialWallet = toWalletSummary(await wallet.getOwnWallet(principal));
    reply.hijack();
    reply.raw.writeHead(200, {
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no"
    });
    reply.raw.flushHeaders();

    const send = (event: WalletUpdateEvent) => {
      if (!reply.raw.destroyed) reply.raw.write(`id: ${event.wallet.version}\nevent: wallet\ndata: ${JSON.stringify(event)}\n\n`);
    };
    const unsubscribe = walletEvents.subscribe(principal.accountId, send);
    const heartbeat = setInterval(() => {
      if (!reply.raw.destroyed) reply.raw.write(": keepalive\n\n");
    }, 20_000);
    const maximumLifetime = setTimeout(() => reply.raw.end(), 5 * 60_000);
    const cleanup = () => {
      clearInterval(heartbeat);
      clearTimeout(maximumLifetime);
      unsubscribe();
    };
    request.raw.once("close", cleanup);
    reply.raw.once("close", cleanup);
    send({ type: "wallet.updated", wallet: initialWallet });
  });

  app.get<{ Reply: WalletHistoryResponse }>("/api/v1/wallet/transactions", { preHandler: app.authenticate, schema: { response: { 200: { type: "object", required: ["entries"], properties: { entries: { type: "array", items: entrySchema } } } } } }, async (request) => ({ entries: (await wallet.listOwnEntries(requirePrincipal(request))).map(toEntrySummary) }));

  const adjustmentRoute = (operation: "credit" | "debit") => async (request: FastifyRequest<{ Params: PlayerParams; Body: AdjustmentBody; Headers: IdempotencyHeaders }>): Promise<WalletMutationResponse> => {
    const result = await wallet[operation](requirePrincipal(request), {
      playerId: request.params.playerId,
      amount: BigInt(request.body.amount),
      idempotencyKey: request.headers["idempotency-key"],
      reason: request.body.reason,
      ...requestContext(request)
    });
    const response = toMutationResponse(result);
    walletEvents.publish({ type: "wallet.updated", wallet: response.wallet });
    return response;
  };

  app.post<{ Params: PlayerParams; Body: AdjustmentBody; Headers: IdempotencyHeaders; Reply: WalletMutationResponse }>("/api/v1/admin/players/:playerId/wallet/credit", {
    preHandler: app.authorize("WALLET_CREDIT"), schema: { params: paramsSchema, headers: headersSchema, body: adjustmentBodySchema, response: { 200: mutationSchema } }
  }, adjustmentRoute("credit"));
  app.post<{ Params: PlayerParams; Body: AdjustmentBody; Headers: IdempotencyHeaders; Reply: WalletMutationResponse }>("/api/v1/admin/players/:playerId/wallet/debit", {
    preHandler: app.authorize("WALLET_DEBIT"), schema: { params: paramsSchema, headers: headersSchema, body: adjustmentBodySchema, response: { 200: mutationSchema } }
  }, adjustmentRoute("debit"));
}

function requirePrincipal(request: FastifyRequest): AuthorizedPrincipal {
  if (request.principal === null) throw new Error("Authorization hook did not set a principal");
  return request.principal;
}
function requestContext(request: FastifyRequest) { return { ipAddress: request.ip, userAgent: request.headers["user-agent"]?.slice(0, 512) ?? null }; }
function toWalletSummary(wallet: WalletRecord): WalletSummary { return { ...wallet, balance: wallet.balance.toString(), updatedAt: wallet.updatedAt.toISOString() }; }
function toEntrySummary(entry: LedgerRecord): LedgerEntrySummary { return { ...entry, amount: entry.amount.toString(), balanceBefore: entry.balanceBefore.toString(), balanceAfter: entry.balanceAfter.toString(), createdAt: entry.createdAt.toISOString() }; }
function toMutationResponse(result: WalletMutationResult): WalletMutationResponse { return { wallet: toWalletSummary(result.wallet), entry: toEntrySummary(result.entry), replayed: result.replayed }; }
