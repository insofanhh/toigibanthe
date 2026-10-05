import { createHash, randomBytes } from "node:crypto";
import { exec, rows, sqlDate, transaction, type DB } from "./db";
import { ensureEmailVerificationSchema } from "./email-verification-schema";
import { safeLoginNext } from "./google-auth-domain";
import { AppError } from "./http";
import { analyticsLive } from "./admin-events";
import {
  sendVerificationMail,
  verificationMailConfig,
} from "./verification-mail";

const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const tokenValid = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);

export async function emailNeedsVerification(userId: string, db?: DB) {
  const [status] = await rows<{
    verification_required: number;
    verified_at: string | null;
  }>(
    "SELECT verification_required,verified_at FROM user_email_status WHERE user_id=?",
    [userId],
    db,
  );
  return !!status?.verification_required && !status.verified_at;
}

// Caller locks the user row: token issuance and resend cooldown are atomic per account.
export async function issueEmailVerification(
  db: DB,
  userId: string,
  email: string,
  next: string,
) {
  const now = sqlDate();
  const recent = await rows<{ created_at: string }>(
    "SELECT created_at FROM email_verification_tokens WHERE user_id=? AND created_at>? ORDER BY created_at DESC",
    [userId, sqlDate(new Date(Date.now() - 3600000))],
    db,
  );
  if (
    recent.length >= 5 ||
    (recent[0] &&
      new Date(recent[0].created_at.replace(" ", "T") + "Z").getTime() >
        Date.now() - 60000)
  )
    throw new AppError(
      "Vui lòng chờ ít nhất 60 giây trước khi gửi lại. Tối đa 5 email mỗi giờ.",
      429,
    );
  const token = randomBytes(32).toString("base64url");
  await exec(
    "INSERT INTO email_verification_tokens (token_hash,user_id,email,next_path,expires_at,created_at) VALUES (?,?,?,?,?,?)",
    [
      tokenHash(token),
      userId,
      email,
      safeLoginNext(next),
      sqlDate(new Date(Date.now() + 86400000)),
      now,
    ],
    db,
  );
  return token;
}

export async function deliverVerification(email: string, token: string) {
  try {
    await sendVerificationMail(email, token);
    return true;
  } catch (error) {
    // SMTP errors may contain credentials, recipients or message bodies. Log only a safe code.
    const code = (error as { code?: string }).code;
    console.error(
      "Verification SMTP failed",
      code && /^[A-Z0-9_]+$/.test(code) ? code : "SEND_FAILED",
    );
    return false;
  }
}

export async function resendEmailVerification(email: string, next: string) {
  verificationMailConfig();
  await ensureEmailVerificationSchema();
  const token = await transaction(async (db) => {
    const [user] = await rows<{ id: string; active: number }>(
      "SELECT id,active FROM users WHERE email=? FOR UPDATE",
      [email.toLowerCase()],
      db,
    );
    if (!user || !user.active || !(await emailNeedsVerification(user.id, db)))
      return null;
    const [last] = await rows<{ next_path: string }>(
      "SELECT next_path FROM email_verification_tokens WHERE user_id=? ORDER BY created_at DESC LIMIT 1",
      [user.id],
      db,
    );
    return issueEmailVerification(
      db,
      user.id,
      email.toLowerCase(),
      last?.next_path || next,
    );
  });
  if (token && !(await deliverVerification(email.toLowerCase(), token)))
    throw new AppError(
      "Chưa gửi được email. Vui lòng thử lại sau 60 giây.",
      503,
    );
  return {
    ok: true,
    message:
      "Nếu tài khoản đang chờ xác minh, email hướng dẫn đã được gửi. Hãy kiểm tra cả thư rác.",
  };
}

type Verification = {
  user_id: string;
  email: string;
  next_path: string;
  expires_at: string;
  consumed_at: string | null;
};
export async function verificationInfo(token: string) {
  await ensureEmailVerificationSchema();
  if (!tokenValid(token)) throw new AppError("Liên kết xác minh không hợp lệ.");
  const [entry] = await rows<Verification & { active: number }>(
    "SELECT t.*,u.active FROM email_verification_tokens t JOIN users u ON u.id=t.user_id AND u.email=t.email WHERE t.token_hash=?",
    [tokenHash(token)],
  );
  if (!entry || entry.consumed_at || entry.expires_at <= sqlDate())
    throw new AppError(
      "Liên kết đã dùng hoặc hết hạn. Hãy đăng nhập để gửi lại email xác minh.",
    );
  if (!entry.active) throw new AppError("Tài khoản đang bị khóa.", 403);
  return { email: entry.email };
}

export async function confirmEmailVerification(token: string) {
  await ensureEmailVerificationSchema();
  if (!tokenValid(token)) throw new AppError("Liên kết xác minh không hợp lệ.");
  return transaction(async (db) => {
    const [candidate] = await rows<Verification>(
      "SELECT * FROM email_verification_tokens WHERE token_hash=?",
      [tokenHash(token)],
      db,
    );
    if (!candidate) throw new AppError("Liên kết xác minh không hợp lệ.");
    const [user] = await rows<{ id: string; email: string; active: number }>(
      "SELECT id,email,active FROM users WHERE id=? FOR UPDATE",
      [candidate.user_id],
      db,
    );
    const [entry] = await rows<Verification>(
      "SELECT * FROM email_verification_tokens WHERE token_hash=? FOR UPDATE",
      [tokenHash(token)],
      db,
    );
    if (
      !entry ||
      entry.consumed_at ||
      entry.expires_at <= sqlDate() ||
      !user ||
      user.email !== entry.email
    )
      throw new AppError(
        "Liên kết đã dùng hoặc hết hạn. Hãy đăng nhập để gửi lại email xác minh.",
      );
    if (!user.active) throw new AppError("Tài khoản đang bị khóa.", 403);
    if (!(await emailNeedsVerification(user.id, db)))
      throw new AppError("Email đã được xác minh. Vui lòng đăng nhập.");
    await exec(
      "UPDATE user_email_status SET verified_at=?,verification_required=FALSE WHERE user_id=?",
      [sqlDate(), user.id],
      db,
    );
    await exec(
      "UPDATE email_verification_tokens SET consumed_at=? WHERE user_id=? AND consumed_at IS NULL",
      [sqlDate(), user.id],
      db,
    );
    await analyticsLive(db, user.id);
    return { userId: user.id, next: safeLoginNext(entry.next_path) };
  });
}
