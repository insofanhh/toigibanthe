import { randomUUID } from "node:crypto";
import { z } from "zod";
import { exec, rows, sqlDate, transaction } from "./db";
import { AppError } from "./http";
import { type Actor, ACTIVE_ORDER_STATUSES } from "./domain";
import { analyticsLive } from "./admin-events";
import { ensureUserAccountSchema } from "./user-account-schema";

export const accountAccessSchema = z
  .object({
    role: z.enum(["user", "chef", "admin"]).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine(
    (input) => input.role !== undefined || input.active !== undefined,
    "Chọn vai trò hoặc trạng thái cần cập nhật.",
  );

export async function updateAccountAccess(
  actor: Actor,
  id: string,
  input: unknown,
) {
  if (actor.role !== "admin" || !actor.active)
    throw new AppError("Bạn không có quyền phân quyền tài khoản.", 403);
  if (!id || id.length > 36) throw new AppError("Tài khoản không hợp lệ.");
  const change = accountAccessSchema.parse(input);
  await ensureUserAccountSchema();
  return transaction(async (db) => {
    // Serialize access changes so concurrent requests cannot remove the last admin.
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
    const [currentActor] = await rows<Actor>(
      "SELECT id,role,active FROM users WHERE id=? FOR UPDATE",
      [actor.id],
      db,
    );
    if (!currentActor || currentActor.role !== "admin" || !currentActor.active)
      throw new AppError(
        "Quyền quản trị của bạn đã thay đổi. Hãy đăng nhập lại.",
        403,
      );
    const [target] = await rows<Actor>(
      "SELECT id,role,active FROM users WHERE id=? FOR UPDATE",
      [id],
      db,
    );
    if (!target) throw new AppError("Không tìm thấy tài khoản.", 404);
    const [deleted] = await rows(
      "SELECT user_id FROM user_account_details WHERE user_id=? AND deleted_at IS NOT NULL",
      [id],
      db,
    );
    if (deleted)
      throw new AppError(
        "Tài khoản đã được chủ tài khoản xóa; không thể mở khóa hoặc phân quyền.",
        409,
      );
    const role = change.role ?? target.role;
    const active = change.active ?? Boolean(target.active);
    if (id === actor.id && (role !== target.role || !active))
      throw new AppError(
        "Không thể đổi quyền hoặc khóa tài khoản quản trị đang dùng.",
      );
    if (role === target.role && active === Boolean(target.active))
      return { ok: true, changed: false };
    if (
      target.role === "admin" &&
      target.active &&
      (role !== "admin" || !active)
    ) {
      const [{ total }] = await rows<{ total: number }>(
        "SELECT COUNT(*) total FROM users WHERE role='admin' AND active=TRUE",
        [],
        db,
      );
      if (Number(total) <= 1)
        throw new AppError("Phải giữ ít nhất một tài khoản admin đang mở.");
    }
    const [chef] = await rows<{ id: string; status: string }>(
      "SELECT id,status FROM chefs WHERE user_id=? FOR UPDATE",
      [id],
      db,
    );
    if (role === "chef" && role !== target.role && chef?.status !== "approved")
      throw new AppError(
        "Chỉ cấp quyền Chef cho tài khoản có hồ sơ bếp đã duyệt. Hãy duyệt hồ sơ trong mục Chefs trước.",
      );
    if (chef && target.role === "chef" && role !== "chef") {
      const openOrders = await rows(
        "SELECT id FROM orders WHERE chef_id=? AND status IN (?) LIMIT 1",
        [chef.id, [...ACTIVE_ORDER_STATUSES]],
        db,
      );
      const refunds = await rows(
        "SELECT id FROM payment_exceptions WHERE order_id IN (SELECT id FROM orders WHERE chef_id=?) AND status IN ('OPEN','REVIEW') LIMIT 1",
        [chef.id],
        db,
      );
      if (openOrders.length || refunds.length)
        throw new AppError(
          "Bếp còn đơn hoặc yêu cầu đối soát chưa xử lý. Hoàn tất trước khi đổi vai trò.",
        );
    }
    if (chef && (role !== "chef" || !active)) {
      await exec(
        "UPDATE kitchen_sessions SET is_open=FALSE WHERE chef_id=?",
        [chef.id],
        db,
      );
      if (role === "user" && chef.status === "approved")
        await exec(
          "UPDATE chefs SET status='suspended',rejection_reason='Đã thu hồi quyền Chef trong quản lý tài khoản.' WHERE id=?",
          [chef.id],
          db,
        );
    }
    await exec(
      "UPDATE users SET role=?,active=? WHERE id=?",
      [role, active, id],
      db,
    );
    // Old sessions cannot retain permissions after a role change.
    if (role !== target.role || !active)
      await exec("DELETE FROM sessions WHERE user_id=?", [id], db);
    await exec(
      "INSERT INTO audit_logs VALUES (?,?,?,?,?,?)",
      [
        randomUUID(),
        actor.id,
        role !== target.role ? "user.role" : "user.active",
        id,
        JSON.stringify({
          before: { role: target.role, active: Boolean(target.active) },
          after: { role, active },
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
