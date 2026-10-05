import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { exec, rows, pool, transaction } from "../src/lib/db";
import { createAccount } from "../src/lib/account-registration";
import { issueEmailVerification } from "../src/lib/email-verification";
import { ensureEmailVerificationSchema } from "../src/lib/email-verification-schema";
import { ensureRegistrationAlertSchema } from "../src/lib/admin-registration-alerts";

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
assert.ok(
  ["localhost", "127.0.0.1"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  ),
);
const email = `verification-http-${randomUUID()}@example.invalid`;
const password = randomUUID();
let userId = "";
const call = (path: string, body?: unknown, cookie = "") =>
  fetch(base + "/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      origin: new URL(process.env.SITE_URL || base).origin,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
try {
  await ensureEmailVerificationSchema();
  await ensureRegistrationAlertSchema();
  const passwordHash = await hash(password, 12);
  const token = await transaction(async (db) => {
    userId = await createAccount(
      db,
      "Verification HTTP fixture",
      email,
      passwordHash,
      "pending",
    );
    return issueEmailVerification(db, userId, email, "/me?verified=1");
  });
  const blocked = await call("auth/login", { email, password });
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).code, "EMAIL_VERIFICATION_REQUIRED");
  assert.equal(blocked.headers.get("set-cookie"), null);
  const info = await call("auth/verification/info", { token });
  assert.equal(info.status, 200);
  assert.equal(info.headers.get("set-cookie"), null);
  assert.equal((await info.json()).email, email);
  const confirmed = await call("auth/verification/confirm", { token });
  assert.equal(confirmed.status, 200);
  assert.equal((await confirmed.json()).next, "/me?verified=1");
  const cookie = confirmed.headers.get("set-cookie");
  assert.ok(cookie);
  assert.ok(cookie.startsWith("tgbd_session="));
  assert.ok(cookie.includes("HttpOnly"));
  const me = await call("auth/me", undefined, cookie.split(";")[0]);
  assert.equal((await me.json()).user.id, userId);
  const replay = await call("auth/verification/confirm", { token });
  assert.equal(replay.status, 400);
  assert.equal(replay.headers.get("set-cookie"), null);
  assert.equal((await call("auth/login", { email, password })).status, 200);
  const page = await fetch(base + "/verify-email");
  assert.equal(page.status, 200);
  const pageText = await page.text();
  assert.ok(pageText.includes('content="no-referrer"'));
  assert.ok(pageText.includes("noindex"));
  console.log(
    "PASS verification HTTP: password login gated, link inspection read-only, confirmation sets HttpOnly session and saved destination, auth/me works, replay rejected, verified password login succeeds, page has noindex/no-referrer.",
  );
} finally {
  if (userId) {
    await exec("DELETE FROM sessions WHERE user_id=?", [userId]);
    await exec("DELETE FROM email_verification_tokens WHERE user_id=?", [
      userId,
    ]);
    await exec("DELETE FROM user_email_status WHERE user_id=?", [userId]);
    await exec("DELETE FROM admin_registration_alerts WHERE user_id=?", [
      userId,
    ]);
    await exec(
      "DELETE FROM realtime_outbox WHERE JSON_UNQUOTE(JSON_EXTRACT(payload,'$.entityId'))=?",
      [userId],
    );
    await exec("DELETE FROM users WHERE id=?", [userId]);
  }
  await pool().end();
}
