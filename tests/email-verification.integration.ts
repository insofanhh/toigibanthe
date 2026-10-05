import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import nodemailer from "nodemailer";
import { signUp, signIn } from "../src/lib/auth";
import { exec, rows, pool, transaction, sqlDate } from "../src/lib/db";
import {
  issueEmailVerification,
  confirmEmailVerification,
  verificationInfo,
  emailNeedsVerification,
  resendEmailVerification,
} from "../src/lib/email-verification";
import { ensureEmailVerificationSchema } from "../src/lib/email-verification-schema";
import { adminUsersList } from "../src/lib/admin-users";
import { createAccount } from "../src/lib/account-registration";
import { verificationMailConfig } from "../src/lib/verification-mail";

assert.ok(
  ["127.0.0.1", "localhost"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  ),
  "Only local MySQL fixtures are allowed",
);
const prefix = "verify-" + randomUUID();
const password = randomUUID();
const emails = [0, 1, 2, 3, 4, 5].map((i) => `${prefix}-${i}@example.invalid`);
const accounts: string[] = [];
const messages: { to: string; text: string }[] = [];
const originalTransport = nodemailer.createTransport;
const smtpVars = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "SMTP_FROM",
  "SITE_URL",
];
const originalEnv = Object.fromEntries(
  smtpVars.map((key) => [key, process.env[key]]),
);
Object.assign(process.env, {
  SMTP_HOST: "smtp.test.invalid",
  SMTP_PORT: "587",
  SMTP_SECURE: "false",
  SMTP_USER: "test",
  SMTP_PASSWORD: "test",
  SMTP_FROM: "Test <test@example.invalid>",
  SITE_URL: "http://127.0.0.1:3000",
});
let fail = false;
nodemailer.createTransport = (() => ({
  sendMail: async (mail: { to: string; text: string }) => {
    if (fail)
      throw Object.assign(new Error("SMTP secret detail must not escape"), {
        code: "EAUTH",
      });
    messages.push(mail);
    return { accepted: [mail.to] };
  },
  close() {},
})) as typeof nodemailer.createTransport;
const latestToken = () =>
  new URL(messages.at(-1)!.text.match(/http:\/\/[^\s]+/)![0]).searchParams.get(
    "token",
  )!;
const account = async (email: string) => {
  const [user] = await rows<{ id: string }>(
    "SELECT id FROM users WHERE email=?",
    [email],
  );
  if (user && !accounts.includes(user.id)) accounts.push(user.id);
  return user;
};
async function register(index: number, next = "/checkout?from=register") {
  try {
    return await signUp("Verification fixture", emails[index], password, next);
  } finally {
    await account(emails[index]);
  }
}
try {
  await ensureEmailVerificationSchema();
  const result = await register(0);
  assert.equal(result.verificationRequired, true);
  assert.equal(result.mailSent, true);
  const first = await account(emails[0]);
  assert.equal(
    (await rows("SELECT token_hash FROM sessions WHERE user_id=?", [first.id]))
      .length,
    0,
  );
  assert.equal(await emailNeedsVerification(first.id), true);
  await assert.rejects(() => signIn(emails[0], "incorrect"), { status: 401 });
  await assert.rejects(() => signIn(emails[0], password), {
    code: "EMAIL_VERIFICATION_REQUIRED",
  });
  const token = latestToken();
  assert.equal(token.length, 43);
  const [stored] = await rows<{ token_hash: string }>(
    "SELECT token_hash FROM email_verification_tokens WHERE user_id=?",
    [first.id],
  );
  assert.equal(
    stored.token_hash,
    createHash("sha256").update(token).digest("hex"),
  );
  assert.deepEqual(await verificationInfo(token), { email: emails[0] });
  assert.equal(
    await emailNeedsVerification(first.id),
    true,
    "Reading link cannot verify or create a session",
  );
  const before = await adminUsersList(new URLSearchParams({ q: emails[0] }));
  assert.equal(before.users[0].email_verification_required, 1);
  assert.equal(before.users[0].email_verified_at, null);
  await assert.rejects(() => resendEmailVerification(emails[0], "/orders"), {
    status: 429,
  });
  const confirmations = await Promise.allSettled([
    confirmEmailVerification(token),
    confirmEmailVerification(token),
  ]);
  assert.equal(
    confirmations.filter((value) => value.status === "fulfilled").length,
    1,
  );
  const successful = confirmations.find(
    (value) => value.status === "fulfilled",
  ) as PromiseFulfilledResult<{ userId: string; next: string }>;
  assert.equal(successful.value.userId, first.id);
  assert.equal(successful.value.next, "/checkout?from=register");
  await assert.rejects(() => confirmEmailVerification(token));
  await assert.rejects(() => verificationInfo(token));
  assert.equal(await emailNeedsVerification(first.id), false);
  const after = await adminUsersList(new URLSearchParams({ q: emails[0] }));
  assert.ok(after.users[0].email_verified_at);
  assert.equal(after.users[0].email_verification_required, 0);
  const n = messages.length;
  await resendEmailVerification(emails[0], "/me");
  assert.equal(
    messages.length,
    n,
    "Verified accounts do not receive more verification mail",
  );

  await register(1, "https://evil.example");
  const unsafeToken = latestToken();
  assert.equal((await confirmEmailVerification(unsafeToken)).next, "/me");
  await register(2);
  const expired = latestToken();
  await exec(
    "UPDATE email_verification_tokens SET expires_at=? WHERE user_id=?",
    [sqlDate(new Date(Date.now() - 1000)), (await account(emails[2])).id],
  );
  await assert.rejects(() => confirmEmailVerification(expired));
  await register(3);
  const blocked = latestToken();
  await exec("UPDATE users SET active=FALSE WHERE id=?", [
    (await account(emails[3])).id,
  ]);
  await assert.rejects(() => confirmEmailVerification(blocked), {
    status: 403,
  });

  fail = true;
  const failed = await register(4);
  assert.equal(failed.mailSent, false);
  const failedUser = await account(emails[4]);
  assert.equal(await emailNeedsVerification(failedUser.id), true);
  fail = false;
  await exec(
    "UPDATE email_verification_tokens SET created_at=? WHERE user_id=?",
    [sqlDate(new Date(Date.now() - 61000)), failedUser.id],
  );
  await resendEmailVerification(emails[4], "/orders");
  const retry = latestToken();
  assert.equal(
    (await confirmEmailVerification(retry)).next,
    "/checkout?from=register",
    "Resend preserves the original registration destination",
  );

  const googleId = await transaction((db) =>
    createAccount(db, "Google fixture", emails[5], "unknown", "google"),
  );
  accounts.push(googleId);
  assert.equal(await emailNeedsVerification(googleId), false);
  assert.ok(
    (await adminUsersList(new URLSearchParams({ q: emails[5] }))).users[0]
      .email_verified_at,
  );
  assert.equal(
    await emailNeedsVerification(randomUUID()),
    false,
    "Legacy accounts without a marker remain usable",
  );
  await assert.rejects(() => confirmEmailVerification("malformed"));
  delete process.env.SMTP_PASSWORD;
  assert.throws(verificationMailConfig, { status: 503 });
  process.env.SMTP_PASSWORD = "test";
  process.env.SMTP_PORT = "465";
  process.env.SMTP_SECURE = "true";
  assert.equal(verificationMailConfig().secure, true);
  console.log(
    "PASS email verification: pending registration/no session, password gate, hashed tokens, read-only info, atomic single-use confirmation, expiry/lock, safe destination, SMTP failure/resend recovery, cooldown, Google status, admin status, and SMTP configuration.",
  );
} finally {
  nodemailer.createTransport = originalTransport;
  for (const key of smtpVars) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  if (accounts.length) {
    await exec("DELETE FROM admin_registration_alerts WHERE user_id IN (?)", [
      accounts,
    ]);
    await exec(
      "DELETE FROM realtime_outbox WHERE user_id IN (?) OR JSON_UNQUOTE(JSON_EXTRACT(payload,'$.entityId')) IN (?)",
      [accounts, accounts],
    );
    await exec("DELETE FROM email_verification_tokens WHERE user_id IN (?)", [
      accounts,
    ]);
    await exec("DELETE FROM user_email_status WHERE user_id IN (?)", [
      accounts,
    ]);
    await exec("DELETE FROM sessions WHERE user_id IN (?)", [accounts]);
    await exec("DELETE FROM users WHERE id IN (?)", [accounts]);
  }
  await pool().end();
}
