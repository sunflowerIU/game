import argon2 from "argon2";

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

const ARGON2_MEMORY_KIB = 19_456;
const ARGON2_PARALLELISM = 1;
const ARGON2_TIME_COST = 2;

export class Argon2idPasswordHasher implements PasswordHasher {
  public async hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: ARGON2_MEMORY_KIB,
      parallelism: ARGON2_PARALLELISM,
      timeCost: ARGON2_TIME_COST
    });
  }

  public async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }
}
