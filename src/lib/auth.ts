import { randomBytes, createHash } from "node:crypto";
import { cookies } from "next/headers";
import { compare, hash } from "bcryptjs";
import { exec, rows, sqlDate, transaction } from "./db";
import { AppError } from "./http";
import type { Actor } from "./domain";
import { revokeSessionPush } from "./push";
import { createAccount } from "./account-registration";
import { ensureRegistrationAlertSchema } from "./admin-registration-alerts";
import { ensureEmailVerificationSchema } from "./email-verification-schema";
import {
  emailNeedsVerification,
  issueEmailVerification,
  deliverVerification,
} from "./email-verification";
import { verificationMailConfig } from "./verification-mail";
import { ensureUserAccountSchema } from "./user-account-schema";
export const COOKIE = "tgbd_session";
export const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function actor(required = true): Promise<Actor | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (token) await ensureUserAccountSchema();
  const user = token
    ? (
        await rows<Actor>(
          "SELECT u.id,u.name,u.email,u.phone,u.role,u.active,u.avatar_url,d.avatar_asset_id FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN user_account_details d ON d.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND u.active=TRUE AND d.deleted_at IS NULL",
          [digest(token), sqlDate()],
        )
      )[0]
    : null;
  if (!user && required)
    throw new AppError("Vui lòng đăng nhập để tiếp tục.", 401);
  return user || null;
}
export async function requireRole(role: "chef" | "admin") {
  const user = (await actor())!;
  if (user.role !== role && user.role !== "admin")
    throw new AppError("Bạn không có quyền thực hiện thao tác này.", 403);
  return user;
}
export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url"),
    expires = new Date(Date.now() + 7 * 86400000);
  await exec("INSERT INTO sessions VALUES (?,?,?)", [
    digest(token),
    userId,
    sqlDate(expires),
  ]);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}
export async function signIn(email: string, password: string) {
  await ensureEmailVerificationSchema();
  const user = (
    await rows<Actor & { password_hash: string }>(
      "SELECT * FROM users WHERE email=?",
      [email.toLowerCase()],
    )
  )[0];
  // Compare a fixed hash even for missing accounts to reduce account timing leakage.
  const valid = await compare(
    password,
    user?.password_hash ||
      "$2b$12$C6UzMDM.H6dfI/f/IKcEe.6VhTjQbg5oGDGGFKykDtHwVDfzMJcGW",
  );
  if (!user || !user.active || !valid)
    throw new AppError("Email hoặc mật khẩu chưa đúng.", 401);
  if (await emailNeedsVerification(user.id))
    throw new AppError(
      "Vui lòng xác minh email trước khi đăng nhập.",
      403,
      "EMAIL_VERIFICATION_REQUIRED",
    );
  await createSession(user.id);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
  };
}
export async function signUp(
  name: string,
  email: string,
  password: string,
  next = "/me",
) {
  verificationMailConfig();
  await ensureEmailVerificationSchema();
  await ensureRegistrationAlertSchema();
  const passwordHash = await hash(password, 12);
  const token = await transaction(async (db) => {
    if (
      (
        await rows(
          "SELECT id FROM users WHERE email=?",
          [email.toLowerCase()],
          db,
        )
      ).length
    )
      throw new AppError("Email đã được sử dụng.");
    const id = await createAccount(db, name, email, passwordHash, "pending");
    return issueEmailVerification(db, id, email.toLowerCase(), next);
  });
  const mailSent = await deliverVerification(email.toLowerCase(), token);
  return { verificationRequired: true, email: email.toLowerCase(), mailSent };
}
export async function signOut() {
  const jar = await cookies(),
    token = jar.get(COOKIE)?.value;
  if (token) {
    await revokeSessionPush(digest(token));
    await exec("DELETE FROM sessions WHERE token_hash=?", [digest(token)]);
  }
  jar.delete(COOKIE);
}
