import { compare, hash } from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { exec, rows, sqlDate, transaction } from "./db";
import { AppError } from "./http";
import { ensurePasswordResetSchema } from "./password-reset-schema";
import {
  sendPasswordResetMail,
  verificationMailConfig,
} from "./verification-mail";
import type { Actor } from "./domain";

const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const validToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);
const passwordSchema = z
  .string()
  .min(10, "Mật khẩu cần ít nhất 10 ký tự.")
  .max(128);

export async function changePassword(
  actor: Actor,
  input: unknown,
  currentSessionHash?: string,
) {
  const data = z
    .object({
      currentPassword: z.string().min(1).max(128),
      newPassword: passwordSchema,
      confirmPassword: z.string().max(128),
    })
    .strict()
    .refine((value) => value.newPassword === value.confirmPassword, {
      message: "Mật khẩu xác nhận chưa khớp.",
      path: ["confirmPassword"],
    })
    .parse(input);
  if (data.currentPassword === data.newPassword)
    throw new AppError("Mật khẩu mới cần khác mật khẩu hiện tại.");
  return transaction(async (db) => {
    const [user] = await rows<{
      id: string;
      active: number;
      password_hash: string;
    }>(
      "SELECT id,active,password_hash FROM users WHERE id=? FOR UPDATE",
      [actor.id],
      db,
    );
    if (!user?.active)
      throw new AppError("Tài khoản không còn hoạt động.", 401);
    if (!(await compare(data.currentPassword, user.password_hash)))
      throw new AppError("Mật khẩu hiện tại chưa đúng.", 401);
    await exec(
      "UPDATE users SET password_hash=? WHERE id=?",
      [await hash(data.newPassword, 12), user.id],
      db,
    );
    if (currentSessionHash)
      await exec(
        "DELETE FROM sessions WHERE user_id=? AND token_hash<>?",
        [user.id, currentSessionHash],
        db,
      );
    else await exec("DELETE FROM sessions WHERE user_id=?", [user.id], db);
    await exec(
      "INSERT INTO audit_logs VALUES (?,?,?,?,?,?)",
      [
        randomUUID(),
        actor.id,
        "user.password.change",
        actor.id,
        JSON.stringify({}),
        sqlDate(),
      ],
      db,
    );
    return { ok: true };
  });
}

export async function requestPasswordReset(email: string) {
  verificationMailConfig();
  await ensurePasswordResetSchema();
  const normalized = email.toLowerCase();
  const token = await transaction(async (db) => {
    const [user] = await rows<{ id: string; active: number }>(
      "SELECT id,active FROM users WHERE email=? FOR UPDATE",
      [normalized],
      db,
    );
    // Keep the response identical for unknown, inactive and known accounts.
    if (!user || !user.active) return null;
    const recent = await rows<{ created_at: string }>(
      "SELECT created_at FROM password_reset_tokens WHERE user_id=? AND created_at>? ORDER BY created_at DESC",
      [user.id, sqlDate(new Date(Date.now() - 3600000))],
      db,
    );
    if (
      recent.length >= 5 ||
      (recent[0] &&
        new Date(recent[0].created_at.replace(" ", "T") + "Z").getTime() >
          Date.now() - 60000)
    )
      throw new AppError(
        "Vui lòng chờ ít nhất 60 giây trước khi yêu cầu lại. Tối đa 5 email mỗi giờ.",
        429,
      );
    await exec(
      "UPDATE password_reset_tokens SET consumed_at=? WHERE user_id=? AND consumed_at IS NULL",
      [sqlDate(), user.id],
      db,
    );
    const raw = randomBytes(32).toString("base64url");
    await exec(
      "INSERT INTO password_reset_tokens (token_hash,user_id,email,expires_at,created_at) VALUES (?,?,?,?,?)",
      [
        digest(raw),
        user.id,
        normalized,
        sqlDate(new Date(Date.now() + 3600000)),
        sqlDate(),
      ],
      db,
    );
    return raw;
  });
  if (token) {
    try {
      await sendPasswordResetMail(normalized, token);
    } catch (error) {
      const code = (error as { code?: string }).code;
      console.error(
        "Password reset SMTP failed",
        code && /^[A-Z0-9_]+$/.test(code) ? code : "SEND_FAILED",
      );
    }
  }
  return {
    ok: true,
    message:
      "Nếu email tồn tại, hướng dẫn đặt lại mật khẩu đã được gửi. Hãy kiểm tra cả thư rác.",
  };
}

export async function resetPassword(
  token: string,
  newPassword: string,
  confirmPassword: string,
) {
  const data = z
    .object({
      token: z.string().max(100),
      newPassword: passwordSchema,
      confirmPassword: z.string().max(128),
    })
    .strict()
    .refine((value) => value.newPassword === value.confirmPassword, {
      message: "Mật khẩu xác nhận chưa khớp.",
      path: ["confirmPassword"],
    })
    .parse({ token, newPassword, confirmPassword });
  if (!validToken(data.token))
    throw new AppError("Liên kết đặt lại mật khẩu không hợp lệ.");
  return transaction(async (db) => {
    const [entry] = await rows<{
      user_id: string;
      email: string;
      expires_at: string;
      consumed_at: string | null;
    }>(
      "SELECT user_id,email,expires_at,consumed_at FROM password_reset_tokens WHERE token_hash=? FOR UPDATE",
      [digest(data.token)],
      db,
    );
    const [user] = entry
      ? await rows<{ id: string; email: string; active: number }>(
          "SELECT id,email,active FROM users WHERE id=? FOR UPDATE",
          [entry.user_id],
          db,
        )
      : [];
    if (
      !entry ||
      !user ||
      entry.consumed_at ||
      entry.expires_at <= sqlDate() ||
      user.email !== entry.email ||
      !user.active
    )
      throw new AppError(
        "Liên kết đặt lại mật khẩu đã dùng, hết hạn hoặc không hợp lệ.",
        400,
      );
    await exec(
      "UPDATE users SET password_hash=? WHERE id=?",
      [await hash(data.newPassword, 12), user.id],
      db,
    );
    await exec(
      "UPDATE password_reset_tokens SET consumed_at=? WHERE user_id=? AND consumed_at IS NULL",
      [sqlDate(), user.id],
      db,
    );
    await exec("DELETE FROM sessions WHERE user_id=?", [user.id], db);
    await exec(
      "INSERT INTO audit_logs VALUES (?,?,?,?,?,?)",
      [
        randomUUID(),
        user.id,
        "user.password.reset",
        user.id,
        JSON.stringify({}),
        sqlDate(),
      ],
      db,
    );
    return { ok: true };
  });
}
