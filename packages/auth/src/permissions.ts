export const ADMIN_PERMISSIONS = [
  "PLAYER_VIEW",
  "PLAYER_CREATE",
  "PLAYER_DISABLE",
  "PLAYER_DELETE",
  "PLAYER_PASSWORD_RESET",
  "DATA_RETENTION_MANAGE",
  "WALLET_CREDIT",
  "WALLET_DEBIT",
  "GAME_VIEW",
  "GAME_MANAGE",
  "SECURITY_VIEW",
  "ADMIN_MANAGE"
] as const;

export type AdminPermission = typeof ADMIN_PERMISSIONS[number];

export interface AuthorizedPrincipal {
  readonly accountId: string;
  readonly type: "PLAYER" | "ADMIN";
  readonly permissions: ReadonlySet<string>;
}

export function hasPermission(principal: AuthorizedPrincipal, permission: AdminPermission): boolean {
  return principal.type === "ADMIN" && principal.permissions.has(permission);
}
