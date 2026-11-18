import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";

// Synthetic fixtures only. No real user records, database access, or env values.
const LEGACY_PASSWORD = "LegacyFixturePassword!";
const LEGACY_HASH =
  "$2b$10$fjWufwdfMZo1acAjLzJRb.vGB7L43zlglasERJ2dwA4PEfPLWSdXm";
const NEW_PASSWORD = "FreshFixturePassword!";
const WRONG_PASSWORD = "WrongFixturePassword!";

test("fixed legacy $2b$10$ bcrypt-format hash has the expected shape", () => {
  assert.ok(LEGACY_HASH.startsWith("$2b$10$"), "legacy hash must use $2b$ cost 10");
  assert.ok(LEGACY_HASH.length === 60, "legacy hash must be 60 characters");
  assert.ok(bcrypt.getRounds(LEGACY_HASH) === 10, "legacy hash cost must be 10");
});

test("fixed legacy hash verifies the correct password", async () => {
  const matches = await bcrypt.compare(LEGACY_PASSWORD, LEGACY_HASH);
  assert.ok(matches === true, "legacy hash must verify its password");
});

test("correct password comparison returns true", async () => {
  const hash = await bcrypt.hash(NEW_PASSWORD, 10);
  const matches = await bcrypt.compare(NEW_PASSWORD, hash);
  assert.ok(matches === true, "correct password must compare true");
});

test("incorrect password comparison returns false", async () => {
  const hash = await bcrypt.hash(NEW_PASSWORD, 10);
  const matches = await bcrypt.compare(WRONG_PASSWORD, hash);
  assert.ok(matches === false, "incorrect password must compare false");
});

test("new password hash generation uses cost 10", async () => {
  const hash = await bcrypt.hash(NEW_PASSWORD, 10);
  assert.ok(hash.startsWith("$2b$10$"), "new hash must use $2b$ cost 10");
  assert.ok(hash.length === 60, "new hash must be 60 characters");
  assert.ok(bcrypt.getRounds(hash) === 10, "new hash cost must be 10");
});

test("generated hash is compatible with bcryptjs compare", async () => {
  const hash = await bcrypt.hash(NEW_PASSWORD, 10);
  const correct = await bcrypt.compare(NEW_PASSWORD, hash);
  const incorrect = await bcrypt.compare(WRONG_PASSWORD, hash);
  assert.ok(correct === true, "bcryptjs must verify a bcryptjs-generated hash");
  assert.ok(incorrect === false, "bcryptjs must reject a wrong password");
});

test("existing password hashes do not need rehashing or migration", async () => {
  const originalHash = LEGACY_HASH;
  const first = await bcrypt.compare(LEGACY_PASSWORD, LEGACY_HASH);
  const second = await bcrypt.compare(LEGACY_PASSWORD, LEGACY_HASH);
  assert.ok(first === true, "legacy hash must verify before any migration");
  assert.ok(second === true, "legacy hash must remain verifiable");
  assert.ok(LEGACY_HASH === originalHash, "verification must not mutate the hash");
});
