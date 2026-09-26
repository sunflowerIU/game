export const PLATFORM_API_VERSION = "1" as const;

export interface PlatformStatusResponse {
  readonly status: "ok";
  readonly service: "game-platform-api";
  readonly apiVersion: typeof PLATFORM_API_VERSION;
  readonly serverTime: string;
}

export interface AccountSummary {
  readonly id: string;
  readonly username: string;
  readonly type: "PLAYER" | "ADMIN";
}

export interface LoginResponse {
  readonly account: AccountSummary;
  readonly expiresAt: string;
}

export interface MeResponse extends AccountSummary {
  readonly permissions: readonly string[];
}

export interface ApiErrorResponse {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string;
  };
}

export interface PlayerSummary {
  readonly id: string;
  readonly username: string;
  readonly status: "ACTIVE" | "DISABLED";
  readonly balance: string;
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PlayerListResponse {
  readonly players: readonly PlayerSummary[];
}

export interface PlayerCleanupCounts {
  readonly authSessions: number;
  readonly loginEvents: number;
  readonly securityEvents: number;
  readonly ownedGameSessions: number;
  readonly gameParticipations: number;
  readonly gameResults: number;
  readonly ledgerEntries: number;
  readonly adminAuditLogs: number;
}

export interface PlayerDeletionPreviewResponse {
  readonly playerId: string;
  readonly username: string;
  readonly status: "ACTIVE" | "DISABLED";
  readonly balance: string;
  readonly activeGameSessions: number;
  readonly counts: PlayerCleanupCounts;
}

export interface PlayerDeletionResponse {
  readonly cleanupRunId: string;
  readonly playerId: string;
  readonly username: string;
  readonly balanceDeleted: string;
  readonly counts: PlayerCleanupCounts;
}

export interface PlayerRecordCleanupPreviewResponse {
  readonly playerId: string;
  readonly username: string;
  readonly retentionDays: number;
  readonly cutoffAt: string;
  readonly counts: PlayerCleanupCounts;
}

export interface PlayerRecordCleanupResponse extends PlayerRecordCleanupPreviewResponse {
  readonly cleanupRunId: string;
}

export interface InactivePlayerCleanupPreviewResponse {
  readonly inactivityDays: number;
  readonly cutoffAt: string;
  readonly includePositiveBalances: boolean;
  readonly inactivePlayers: number;
  readonly activeSessionPlayers: number;
  readonly positiveBalancePlayers: number;
  readonly positiveBalanceTotal: string;
  readonly deletablePlayers: number;
}

export interface InactivePlayerCleanupResponse {
  readonly cleanupRunId: string;
  readonly inactivityDays: number;
  readonly cutoffAt: string;
  readonly includePositiveBalances: boolean;
  readonly batchSize: number;
  readonly deletedPlayers: number;
  readonly deletedBalance: string;
  readonly deletedRecords: PlayerCleanupCounts;
  readonly remainingPlayers: number;
}

export interface SessionCleanupCounts {
  readonly authSessions: number;
  readonly gameSessions: number;
  readonly gameParticipations: number;
  readonly gameResults: number;
  readonly securityEvents: number;
}

export interface SessionCleanupPreviewResponse {
  readonly retentionDays: number;
  readonly cutoffAt: string;
  readonly counts: SessionCleanupCounts;
}

export interface SessionCleanupResponse extends SessionCleanupPreviewResponse {
  readonly cleanupRunId: string;
  readonly batchSize: number;
  readonly remaining: SessionCleanupCounts;
}

export interface AdminAuditSummary {
  readonly id: string;
  readonly adminUsername: string;
  readonly targetType: "ACCOUNT" | "GAME";
  readonly targetLabel: string;
  readonly action: "PLAYER_CREATED" | "PLAYER_ENABLED" | "PLAYER_DISABLED" | "PLAYER_PASSWORD_RESET" | "WALLET_CREDITED" | "WALLET_DEBITED" | "GAME_STATUS_CHANGED" | "GAME_CONFIG_UPDATED";
  readonly amount: string | null;
  readonly reason: string;
  readonly ipAddress: string;
  readonly createdAt: string;
}

export interface AdminAuditListResponse {
  readonly auditLogs: readonly AdminAuditSummary[];
}

export interface WalletSummary {
  readonly accountId: string;
  readonly balance: string;
  readonly version: number;
  readonly updatedAt: string;
}

export interface WalletResponse {
  readonly wallet: WalletSummary;
}

export interface WalletUpdateEvent {
  readonly type: "wallet.updated";
  readonly wallet: WalletSummary;
}

export interface LedgerEntrySummary {
  readonly id: string;
  readonly type: "ADMIN_DEPOSIT" | "ADMIN_DEBIT" | "GAME_ENTRY" | "GAME_REWARD" | "REDEMPTION" | "REFUND" | "BONUS" | "ADJUSTMENT";
  readonly amount: string;
  readonly balanceBefore: string;
  readonly balanceAfter: string;
  readonly referenceType: string;
  readonly referenceId: string;
  readonly createdAt: string;
}

export interface WalletHistoryResponse {
  readonly entries: readonly LedgerEntrySummary[];
}

export interface WalletMutationResponse {
  readonly wallet: WalletSummary;
  readonly entry: LedgerEntrySummary;
  readonly replayed: boolean;
}

export interface GameCatalogItem {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly status: "ACTIVE";
  readonly gameType: "SINGLE_PLAYER" | "MULTIPLAYER";
  readonly version: string;
  readonly minimumEntry: string;
  readonly maximumEntry: string;
  readonly configuration: Readonly<Record<string, unknown>>;
}

export interface GameCatalogResponse {
  readonly games: readonly GameCatalogItem[];
}

export interface GameSessionSummary {
  readonly id: string;
  readonly gameId: string;
  readonly gameVersion: string;
  readonly status: "CREATED" | "ACTIVE" | "COMPLETED" | "ABANDONED" | "FAILED";
  readonly entryAmount: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly score: number | null;
  readonly reward: string | null;
}
export interface StartGameSessionResponse { readonly session: GameSessionSummary; readonly publicState: unknown; readonly replayed: boolean; readonly nextSequence: number; readonly expiresAt?: string | null }
export interface GameHistoryResponse { readonly sessions: readonly GameSessionSummary[] }
export interface ActiveGameSessionResponse { readonly active: StartGameSessionResponse | null }

export * from "./neon-mines.js";
