import { randomUUID } from "node:crypto";
import { z } from "zod";
import { exec, rows, sqlDate, transaction } from "./db";
import { AppError } from "./http";
import { type Actor, ACTIVE_ORDER_STATUSES } from "./domain";
import { ensureUserAccountSchema } from "./user-account-schema";
import { ensurePushSchema } from "./push-schema";
import { ensureEmailVerificationSchema } from "./email-verification-schema";
import { ensurePaymentRequestSchema } from "./payment-request-store";
import { analyticsLive } from "./admin-events";
import { ensureSessionRevocationSchema } from "./session-revocations";

const profileSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    phone: z.string().trim().max(30),
    avatarAssetId: z.uuid().nullable().optional(),
  })
  .strict();

export async function updateUserProfile(actor: Actor, input: unknown) {
  const change = profileSchema.parse(input);
  await ensureUserAccountSchema();
  return transaction(async (db) => {
    const [user] = await rows<Actor>(
      "SELECT id,active FROM users WHERE id=? FOR UPDATE",
      [actor.id],
      db,
    );
    if (!user?.active)
      throw new AppError("Tài khoản không còn hoạt động.", 401);
    let avatarUrl: string | null = null;
    if (change.avatarAssetId) {
      const [asset] = await rows<{ url: string }>(
        "SELECT url FROM assets WHERE id=? AND user_id=? AND kind='image' AND content_type='image/webp'",
        [change.avatarAssetId, actor.id],
        db,
      );
      if (!asset)
        throw new AppError(
          "Ảnh đại diện không hợp lệ. Hãy tải lại ảnh của bạn.",
        );
      avatarUrl = asset.url;
    }
    await exec(
      "UPDATE users SET name=?,phone=? WHERE id=?",
      [change.name, change.phone, actor.id],
      db,
    );
    if (change.avatarAssetId !== undefined) {
      await exec(
        "UPDATE users SET avatar_url=? WHERE id=?",
        [avatarUrl, actor.id],
        db,
      );
      await exec(
        "INSERT INTO user_account_details (user_id,avatar_asset_id) VALUES (?,?) ON DUPLICATE KEY UPDATE avatar_asset_id=VALUES(avatar_asset_id)",
        [actor.id, change.avatarAssetId],
        db,
      );
    }
    await analyticsLive(db, actor.id);
    return { ok: true };
  });
}

export async function softDeleteAccount(actor: Actor, input: unknown) {
  return deleteAccount(actor, actor.id, input, false);
}

export async function adminSoftDeleteAccount(
  actor: Actor,
  id: string,
  input: unknown,
) {
  if (actor.role !== "admin" || !actor.active)
    throw new AppError("Bạn không có quyền xóa tài khoản.", 403);
  if (!id || id.length > 36) throw new AppError("Tài khoản không hợp lệ.");
  return deleteAccount(actor, id, input, true);
}

export async function adminRestoreAccount(
  actor: Actor,
  id: string,
  input: unknown,
) {
  if (actor.role !== "admin" || !actor.active)
    throw new AppError("Bạn không có quyền khôi phục tài khoản.", 403);
  if (!id || id.length > 36) throw new AppError("Tài khoản không hợp lệ.");
  z.object({ confirmation: z.literal("RESTORE") })
    .strict()
    .parse(input);
  await ensureUserAccountSchema();
  await ensureSessionRevocationSchema();
  return transaction(async (db) => {
    // Serialize restoration with deletion, role changes and chef approval.
    await exec(
      "INSERT IGNORE INTO platform_settings (id,value) VALUES ('account-access-lock',JSON_OBJECT())",
      [],
      db,
    );
    await rows(
      "SELECT id FROM platform_settings WHERE id='account-access-lock' FOR UPDATE",
      [],
      db,
    );
    const [admin] = await rows<Actor>(
      "SELECT id,role,active FROM users WHERE id=? FOR UPDATE",
      [actor.id],
      db,
    );
    if (!admin?.active || admin.role !== "admin")
      throw new AppError(
        "Quyền quản trị của bạn đã thay đổi. Hãy đăng nhập lại.",
        403,
      );
    const [user] = await rows<Actor>(
      "SELECT id,role,active FROM users WHERE id=? FOR UPDATE",
      [id],
      db,
    );
    if (!user) throw new AppError("Không tìm thấy tài khoản.", 404);
    const [deleted] = await rows<{ deleted_at: string }>(
      "SELECT deleted_at FROM user_account_details WHERE user_id=? AND deleted_at IS NOT NULL FOR UPDATE",
      [id],
      db,
    );
    // Retrying must neither duplicate audit entries nor unlock a separately locked account.
    if (!deleted) return { ok: true, changed: false };
    await exec(
      "UPDATE user_account_details SET deleted_at=NULL WHERE user_id=?",
      [id],
      db,
    );
    await exec("UPDATE users SET active=TRUE WHERE id=?", [id], db);
    // Require a fresh login. Old cookies must not regain access or keep reporting deletion.
    await exec("DELETE FROM sessions WHERE user_id=?", [id], db);
    await exec("DELETE FROM revoked_sessions WHERE user_id=?", [id], db);
    await exec(
      "INSERT INTO audit_logs VALUES (?,?,?,?,?,?)",
      [
        randomUUID(),
        actor.id,
        "user.restore",
        id,
        JSON.stringify({
          before: {
            role: user.role,
            active: Boolean(user.active),
            deletedAt: deleted.deleted_at,
          },
          after: { role: user.role, active: true, deletedAt: null },
        }),
        sqlDate(),
      ],
      db,
    );
    await exec(
      "INSERT INTO realtime_outbox VALUES (?,?,?,?,NULL)",
      [
        randomUUID(),
        id,
        JSON.stringify({ type: "account-access-changed" }),
        sqlDate(),
      ],
      db,
    );
    await analyticsLive(db, id);
    return { ok: true, changed: true };
  });
}

async function deleteAccount(
  actor: Actor,
  id: string,
  input: unknown,
  byAdmin: boolean,
) {
  z.object({ confirmation: z.literal("DELETE") })
    .strict()
    .parse(input);
  await ensureUserAccountSchema();
  await ensurePushSchema();
  await ensureEmailVerificationSchema();
  await ensurePaymentRequestSchema();
  await ensureSessionRevocationSchema();
  return transaction(async (db) => {
    // Share the lock with admin role changes to protect the final active admin.
    await exec(
      "INSERT IGNORE INTO platform_settings (id,value) VALUES ('account-access-lock',JSON_OBJECT())",
      [],
      db,
    );
    await rows(
      "SELECT id FROM platform_settings WHERE id='account-access-lock' FOR UPDATE",
      [],
      db,
    );
    if (byAdmin) {
      const [currentAdmin] = await rows<Actor>(
        "SELECT id,role,active FROM users WHERE id=? FOR UPDATE",
        [actor.id],
        db,
      );
      if (!currentAdmin?.active || currentAdmin.role !== "admin")
        throw new AppError(
          "Quyền quản trị của bạn đã thay đổi. Hãy đăng nhập lại.",
          403,
        );
      if (id === actor.id)
        throw new AppError(
          "Không thể xóa tài khoản quản trị đang dùng trong bảng Users.",
        );
    }
    const [user] = await rows<Actor>(
      "SELECT id,role,active FROM users WHERE id=? FOR UPDATE",
      [id],
      db,
    );
    if (!user) throw new AppError("Không tìm thấy tài khoản.", 404);
    const [deleted] = await rows(
      "SELECT user_id FROM user_account_details WHERE user_id=? AND deleted_at IS NOT NULL",
      [id],
      db,
    );
    if (deleted && byAdmin) return { ok: true, changed: false };
    if ((!user.active || deleted) && !byAdmin)
      throw new AppError("Tài khoản không còn hoạt động.", 401);
    if (!byAdmin && user.role === "admin")
      throw new AppError(
        "Tài khoản Admin không được tự xóa trong Cài đặt. Hãy liên hệ Admin khác để quản lý tài khoản trong mục Users.",
        403,
      );
    if (user.role === "admin" && user.active) {
      const [{ total }] = await rows<{ total: number }>(
        "SELECT COUNT(*) total FROM users WHERE role='admin' AND active=TRUE",
        [],
        db,
      );
      if (Number(total) <= 1)
        throw new AppError(
          "Cần có admin khác đang hoạt động trước khi xóa tài khoản này.",
        );
    }
    const [chef] = await rows<{ id: string }>(
      "SELECT id FROM chefs WHERE user_id=? FOR UPDATE",
      [user.id],
      db,
    );
    const orders = await rows(
      "SELECT id FROM orders WHERE (user_id=? OR chef_id=?) AND (status IN (?) OR payment_status IN ('REFUND_PENDING','PAYMENT_REVIEW')) LIMIT 1",
      [user.id, chef?.id || "", [...ACTIVE_ORDER_STATUSES]],
      db,
    );
    const requests = await rows(
      "SELECT p.id FROM payment_exceptions p JOIN orders o ON o.id=p.order_id WHERE (o.user_id=? OR o.chef_id=?) AND p.status IN ('OPEN','REVIEW') LIMIT 1",
      [user.id, chef?.id || ""],
      db,
    );
    if (orders.length || requests.length)
      throw new AppError(
        byAdmin
          ? "Tài khoản còn đơn hàng hoặc đối soát/hoàn tiền chưa xử lý. Hãy hoàn tất trước khi xóa."
          : "Bạn còn đơn hàng hoặc yêu cầu đối soát/hoàn tiền chưa xử lý. Hãy hoàn tất trước khi xóa tài khoản.",
        409,
      );
    const now = sqlDate();
    await exec("UPDATE users SET active=FALSE WHERE id=?", [user.id], db);
    await exec(
      "INSERT INTO user_account_details (user_id,deleted_at) VALUES (?,?) ON DUPLICATE KEY UPDATE deleted_at=VALUES(deleted_at)",
      [user.id, now],
      db,
    );
    if (chef) {
      await exec(
        "UPDATE kitchen_sessions SET is_open=FALSE WHERE chef_id=?",
        [chef.id],
        db,
      );
      await exec(
        "UPDATE chefs SET status='suspended',rejection_reason=? WHERE id=?",
        [
          byAdmin
            ? "Admin đã xóa tài khoản chủ bếp."
            : "Chủ bếp đã xóa tài khoản.",
          chef.id,
        ],
        db,
      );
    }
    await exec(
      "INSERT INTO revoked_sessions (token_hash,user_id,reason,expires_at) SELECT token_hash,user_id,'ACCOUNT_DELETED',expires_at FROM sessions WHERE user_id=? ON DUPLICATE KEY UPDATE reason=VALUES(reason),expires_at=VALUES(expires_at)",
      [user.id],
      db,
    );
    await exec("DELETE FROM sessions WHERE user_id=?", [user.id], db);
    await exec(
      "UPDATE push_subscriptions SET active=FALSE,updated_at=? WHERE user_id=?",
      [now, user.id],
      db,
    );
    await exec(
      "DELETE FROM push_deliveries WHERE user_id=? AND state IN ('PENDING','SENDING')",
      [user.id],
      db,
    );
    await exec(
      "UPDATE email_verification_tokens SET consumed_at=? WHERE user_id=? AND consumed_at IS NULL",
      [now, user.id],
      db,
    );
    await exec(
      "INSERT INTO audit_logs VALUES (?,?,?,?,?,?)",
      [
        randomUUID(),
        actor.id,
        "user.delete",
        user.id,
        JSON.stringify({
          softDelete: true,
          initiatedBy: byAdmin ? "admin" : "user",
        }),
        now,
      ],
      db,
    );
    await exec(
      "INSERT INTO realtime_outbox VALUES (?,?,?,?,NULL)",
      [
        randomUUID(),
        user.id,
        JSON.stringify({ type: "account-access-changed" }),
        now,
      ],
      db,
    );
    await analyticsLive(db, user.id);
    return { ok: true, changed: true };
  });
}
