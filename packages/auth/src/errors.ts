export type AuthErrorCode = "ACCESS_DENIED" | "AUTH_REQUIRED" | "INVALID_CREDENTIALS" | "INVALID_PASSWORD" | "RATE_LIMITED";

export class AuthError extends Error {
  public constructor(
    public readonly code: AuthErrorCode,
    message: string
  ) {
    super(message);
    this.name = "AuthError";
  }
}
