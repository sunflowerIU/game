import { createHash, randomBytes } from "node:crypto";

const SESSION_TOKEN_BYTES = 32;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export interface SessionTokenPair {
  readonly hash: string;
  readonly token: string;
}

export class SessionTokenService {
  public issue(): SessionTokenPair {
    const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
    return { token, hash: this.hash(token) };
  }

  public hash(token: string): string {
    if (!SESSION_TOKEN_PATTERN.test(token)) {
      throw new Error("Invalid session token format");
    }

    return createHash("sha256").update(token, "utf8").digest("hex");
  }
}

