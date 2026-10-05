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
  z.object({ confirmation: z.literal("DELETE") })
    .strict()
    .parse(input);
  await ensureUserAccountSchema();
  await ensurePushSchema();
  await ensureEmailVerificationSchema();
  await ensurePaymentRequestSchema();
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
    const [user] = await rows<Actor>(
      "SELECT id,role,active FROM users WHERE id=? FOR UPDATE",
      [actor.id],
      db,
    );
    if (!user?.active)
      throw new AppError("Tài khoản không còn hoạt động.", 401);
    if (user.role === "admin") {
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
        "Bạn còn đơn hàng hoặc yêu cầu đối soát/hoàn tiền chưa xử lý. Hãy hoàn tất trước khi xóa tài khoản.",
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
        "UPDATE chefs SET status='suspended',rejection_reason='Chủ bếp đã xóa tài khoản.' WHERE id=?",
        [chef.id],
        db,
      );
    }
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
        user.id,
        "user.delete",
        user.id,
        JSON.stringify({ softDelete: true }),
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
    return { ok: true };
  });
}
