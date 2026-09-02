import assert from "node:assert/strict";
import { test } from "node:test";

import { Argon2idPasswordHasher } from "./passwords.js";

test("passwords are stored as salted Argon2id PHC strings", async () => {
  const hasher = new Argon2idPasswordHasher();
  const first = await hasher.hash("a long test password");
  const second = await hasher.hash("a long test password");

  assert.match(first, /^\$argon2id\$/u);
  assert.notEqual(first, second);
  assert.equal(await hasher.verify(first, "a long test password"), true);
  assert.equal(await hasher.verify(first, "wrong password"), false);
});

