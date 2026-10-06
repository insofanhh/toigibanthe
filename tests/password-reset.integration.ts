import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { compare, hash } from "bcryptjs";
import { changePassword, resetPassword } from "../src/lib/password-reset";
import { ensurePasswordResetSchema } from "../src/lib/password-reset-schema";
import { exec, rows, pool, sqlDate } from "../src/lib/db";
import type { Actor } from "../src/lib/domain";

assert.ok(
  ["localhost", "127.0.0.1"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  ),
);
const userId = randomUUID();
const otherSession = createHash("sha256").update(randomBytes(32)).digest("hex");
const currentSession = createHash("sha256")
  .update(randomBytes(32))
  .digest("hex");
const initialPassword = "InitialPassword!2026";
const newPassword = "ChangedPassword!2026";
const actor: Actor = {
  id: userId,
  name: "Password fixture",
  email: `${userId}@example.invalid`,
  phone: "",
  role: "user",
  active: 1,
};
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
try {
  await ensurePasswordResetSchema();
  await exec(
    "INSERT INTO users (id,name,email,password_hash,role,active,created_at) VALUES (?,?,?,?,?,?,?)",
    [
      userId,
      actor.name,
      actor.email,
      await hash(initialPassword, 10),
      "user",
      true,
      sqlDate(),
    ],
  );
  await exec("INSERT INTO sessions VALUES (?,?,?)", [
    otherSession,
    userId,
    sqlDate(new Date(Date.now() + 3600000)),
  ]);
  await exec("INSERT INTO sessions VALUES (?,?,?)", [
    currentSession,
    userId,
    sqlDate(new Date(Date.now() + 3600000)),
  ]);

  await assert.rejects(
    () =>
      changePassword(
        actor,
        { currentPassword: "wrong", newPassword, confirmPassword: newPassword },
        currentSession,
      ),
    /Mật khẩu hiện tại/,
  );
  await changePassword(
    actor,
    {
      currentPassword: initialPassword,
      newPassword,
      confirmPassword: newPassword,
    },
    currentSession,
  );
  assert.equal(
    (await rows("SELECT token_hash FROM sessions WHERE user_id=?", [userId]))
      .length,
    1,
  );
  assert.equal(
    (
      await rows<{ token_hash: string }>(
        "SELECT token_hash FROM sessions WHERE user_id=?",
        [userId],
      )
    )[0].token_hash,
    currentSession,
  );
  assert.equal(
    await compare(
      newPassword,
      (
        await rows<{ password_hash: string }>(
          "SELECT password_hash FROM users WHERE id=?",
          [userId],
        )
      )[0].password_hash,
    ),
    true,
  );

  const resetToken = randomBytes(32).toString("base64url");
  await exec(
    "INSERT INTO password_reset_tokens (token_hash,user_id,email,expires_at,created_at) VALUES (?,?,?,?,?)",
    [
      digest(resetToken),
      userId,
      actor.email,
      sqlDate(new Date(Date.now() + 3600000)),
      sqlDate(),
    ],
  );
  await exec("INSERT INTO sessions VALUES (?,?,?)", [
    otherSession,
    userId,
    sqlDate(new Date(Date.now() + 3600000)),
  ]);
  await resetPassword(resetToken, "ResetPassword!2026", "ResetPassword!2026");
  assert.equal(
    (await rows("SELECT token_hash FROM sessions WHERE user_id=?", [userId]))
      .length,
    0,
  );
  assert.equal(
    (
      await rows(
        "SELECT consumed_at FROM password_reset_tokens WHERE token_hash=? AND consumed_at IS NOT NULL",
        [digest(resetToken)],
      )
    ).length,
    1,
  );
  await assert.rejects(
    () =>
      resetPassword(resetToken, "AnotherPassword!2026", "AnotherPassword!2026"),
    /đã dùng/,
  );

  const expiredToken = randomBytes(32).toString("base64url");
  await exec(
    "INSERT INTO password_reset_tokens (token_hash,user_id,email,expires_at,created_at) VALUES (?,?,?,?,?)",
    [
      digest(expiredToken),
      userId,
      actor.email,
      sqlDate(new Date(Date.now() - 1000)),
      sqlDate(),
    ],
  );
  await assert.rejects(
    () =>
      resetPassword(
        expiredToken,
        "ExpiredPassword!2026",
        "ExpiredPassword!2026",
      ),
    /đã dùng/,
  );
  console.log(
    "Password change/reset token, session revocation and one-time expiry passed.",
  );
} finally {
  await exec("DELETE FROM audit_logs WHERE entity_id=?", [userId]);
  await exec("DELETE FROM password_reset_tokens WHERE user_id=?", [userId]);
  await exec("DELETE FROM sessions WHERE user_id=?", [userId]);
  await exec("DELETE FROM users WHERE id=?", [userId]);
  await pool().end();
}
