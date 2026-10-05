import { test } from "node:test";
import assert from "node:assert/strict";
import { googleProfile, safeLoginNext } from "../src/lib/google-auth-domain";

test("Login return paths cannot leave the app, including normalized double slashes", () => {
  for (const value of [
    null,
    "",
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/..//evil.example",
    "/\nevil",
    "/api/auth/google",
    "/login",
  ]) {
    assert.equal(safeLoginNext(value), "/me", String(value));
  }
  assert.equal(safeLoginNext("/checkout?cart=1#pay"), "/checkout?cart=1#pay");
  assert.equal(safeLoginNext("/chef?tab=orders"), "/chef?tab=orders");
});

const claims = {
  sub: "google-sub",
  nonce: "nonce",
  email: "Test@gmail.com",
  email_verified: true,
  name: " Test ",
};
test("Google identity uses sub and only authoritative Google email can link an existing account", () => {
  assert.deepEqual(googleProfile(claims, "nonce", "client"), {
    sub: "google-sub",
    email: "test@gmail.com",
    name: "Test",
    authoritativeEmail: true,
  });
  assert.equal(
    googleProfile({ ...claims, email: "a@example.com" }, "nonce", "client")
      .authoritativeEmail,
    false,
  );
  assert.equal(
    googleProfile(
      { ...claims, email: "a@example.com", hd: "example.com" },
      "nonce",
      "client",
    ).authoritativeEmail,
    true,
  );
});
test("Google rejects mismatched nonce/presenter and unverified or missing identity", () => {
  for (const invalid of [
    { ...claims, nonce: "replay" },
    { ...claims, azp: "other-client" },
    { ...claims, email_verified: false },
    { ...claims, sub: "" },
    { ...claims, email: "invalid" },
  ]) {
    assert.throws(() => googleProfile(invalid, "nonce", "client"));
  }
});
