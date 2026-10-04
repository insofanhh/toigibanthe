import { randomUUID } from "node:crypto";
import { z } from "zod";
import { exec, rows, transaction, sqlDate, type DB } from "./db";
import type { Actor } from "./domain";
import { AppError } from "./http";
import { getOrder } from "./orders";
import { notify } from "./notifications";
import { ensurePaymentRequestSchema } from "./payment-request-store";
export {
  ensurePaymentRequestSchema,
  backfillPaymentRequests,
} from "./payment-request-store";

export async function listPaymentRequests(orderId: string) {
  await ensurePaymentRequestSchema();
  return rows(
    `SELECT e.id,e.kind,e.amount,e.note,e.status,e.created_at,d.contact_phone,
    d.resolution_note,d.evidence_asset_id,d.resolution_type,d.submitted_at,d.review_note,d.reviewed_at,
    a.original_name evidence_name
    FROM payment_request_details d JOIN payment_exceptions e ON e.id=d.exception_id
    LEFT JOIN assets a ON a.id=d.evidence_asset_id WHERE d.order_id=?`,
    [orderId],
  );
}

export async function listAdminPaymentExceptions() {
  await ensurePaymentRequestSchema();
  return rows(`SELECT e.*,o.code,o.chef_id,c.name chef_name,u.name customer_name,
    d.exception_id customer_request_id,d.contact_phone,d.resolution_note,d.evidence_asset_id,
    d.resolution_type,d.submitted_at,d.review_note,d.reviewed_at,a.original_name evidence_name
    FROM payment_exceptions e JOIN orders o ON o.id=e.order_id
    JOIN chefs c ON c.id=o.chef_id JOIN users u ON u.id=o.user_id
    LEFT JOIN payment_request_details d ON d.exception_id=e.id
    LEFT JOIN assets a ON a.id=d.evidence_asset_id
    WHERE e.actor_id<>o.user_id OR d.exception_id IS NOT NULL
    ORDER BY CASE WHEN e.status='REVIEW' THEN 0 WHEN e.status='OPEN' THEN 1 ELSE 2 END,e.created_at DESC`);
}

export async function canReadPaymentEvidence(userId: string, assetId: string) {
  await ensurePaymentRequestSchema();
  return (
    (
      await rows(
        `SELECT d.exception_id FROM payment_request_details d
    JOIN orders o ON o.id=d.order_id WHERE d.evidence_asset_id=? AND o.user_id=?`,
        [assetId, userId],
      )
    ).length > 0
  );
}

const requestSchema = z.object({
  kind: z.enum([
    "LATE",
    "UNDERPAID",
    "OVERPAID",
    "DUPLICATE",
    "WRONG_REFERENCE",
    "REFUND",
  ]),
  amount: z.number().int().min(0).max(100000000),
  note: z.string().trim().min(5).max(1000),
  phone: z
    .string()
    .trim()
    .transform((s) => s.replace(/[\s().-]/g, ""))
    .pipe(
      z
        .string()
        .regex(/^(\+84|0)[0-9]{9,10}$/, "Nhập số điện thoại liên hệ hợp lệ."),
    ),
});
export async function submitPaymentRequest(
  user: Actor,
  orderId: string,
  raw: unknown,
) {
  await ensurePaymentRequestSchema();
  const b = requestSchema.parse(raw);
  await transaction(async (db) => {
    const o = await getOrder(orderId, user, db, true);
    if (o.user_id !== user.id)
      throw new AppError(
        "Chỉ khách đặt đơn được gửi yêu cầu đối soát / hoàn tiền.",
        403,
      );
    if (["PLACED", "PAID"].includes(o.status))
      throw new AppError(
        "Đơn chưa được bếp nhận. Nếu cần hoàn tiền, hãy hủy và yêu cầu hoàn tiền.",
        409,
      );
    if (
      (
        await rows(
          "SELECT exception_id FROM payment_request_details WHERE order_id=? FOR UPDATE",
          [o.id],
          db,
        )
      ).length
    )
      throw new AppError(
        "Bạn đã gửi yêu cầu cho đơn này. Vui lòng chờ xử lý.",
        409,
      );
    const requestId = randomUUID();
    await exec(
      "INSERT INTO payment_exceptions VALUES (?,?,?,?,?,?,?,?)",
      [requestId, o.id, user.id, b.kind, b.amount, b.note, "OPEN", sqlDate()],
      db,
    );
    await exec(
      "INSERT INTO payment_request_details (exception_id,order_id,contact_phone) VALUES (?,?,?)",
      [requestId, o.id, b.phone],
      db,
    );
    await notify(
      db,
      o.chef_user_id,
      "order",
      b.kind === "REFUND" ? "Yêu cầu hoàn tiền" : "Yêu cầu đối soát",
      `Đơn ${o.code} có yêu cầu của khách cần xử lý.`,
      `/orders/${o.id}`,
    );
  });
  return { ok: true };
}

async function log(
  db: DB,
  user: Actor,
  action: string,
  id: string,
  detail: unknown,
) {
  await exec(
    "INSERT INTO audit_logs VALUES (?,?,?,?,?,?)",
    [randomUUID(), user.id, action, id, JSON.stringify(detail), sqlDate()],
    db,
  );
}
export async function submitPaymentResolution(
  user: Actor,
  orderId: string,
  raw: unknown,
) {
  await ensurePaymentRequestSchema();
  const b = z
    .object({
      requestId: z.string().uuid(),
      note: z.string().trim().min(5).max(2000),
      evidenceAssetId: z.string().uuid(),
      resolution: z.enum(["RESOLVED", "REFUNDED"]),
    })
    .parse(raw);
  await transaction(async (db) => {
    const o = await getOrder(orderId, user, db, true);
    if (o.chef_user_id !== user.id)
      throw new AppError(
        "Chỉ bếp của đơn được gửi bằng chứng giải quyết.",
        403,
      );
    const r = (
      await rows<{ status: string }>(
        `SELECT e.status FROM payment_request_details d
      JOIN payment_exceptions e ON e.id=d.exception_id WHERE d.order_id=? AND d.exception_id=? FOR UPDATE`,
        [orderId, b.requestId],
        db,
      )
    )[0];
    if (!r) throw new AppError("Không tìm thấy yêu cầu của khách.", 404);
    if (r.status !== "OPEN")
      throw new AppError("Yêu cầu đã được gửi duyệt hoặc đã xử lý.", 409);
    const asset = (
      await rows<{ user_id: string; kind: string }>(
        "SELECT user_id,kind FROM assets WHERE id=?",
        [b.evidenceAssetId],
        db,
      )
    )[0];
    if (!asset || asset.user_id !== user.id || asset.kind !== "document")
      throw new AppError("Chọn bằng chứng riêng tư do bếp tải lên.", 400);
    await exec(
      `UPDATE payment_request_details SET resolution_note=?,evidence_asset_id=?,resolution_type=?,
      submitted_at=?,review_note=NULL,reviewed_at=NULL,reviewed_by=NULL WHERE exception_id=?`,
      [b.note, b.evidenceAssetId, b.resolution, sqlDate(), b.requestId],
      db,
    );
    await exec(
      "UPDATE payment_exceptions SET status='REVIEW' WHERE id=?",
      [b.requestId],
      db,
    );
    await notify(
      db,
      o.user_id,
      "order",
      "Yêu cầu đang chờ hệ thống",
      `Bếp đã gửi bằng chứng giải quyết cho đơn ${o.code}. Hệ thống đang kiểm tra.`,
      `/orders/${o.id}`,
    );
    const admins = await rows<{ id: string }>(
      "SELECT id FROM users WHERE role='admin' AND active=TRUE",
      [],
      db,
    );
    for (const a of admins)
      await notify(
        db,
        a.id,
        "order",
        "Bằng chứng đối soát chờ duyệt",
        `Bếp đã gửi bằng chứng giải quyết cho đơn ${o.code}.`,
        "/admin?tab=payments",
      );
    await log(db, user, "payment.resolution.submit", b.requestId, b);
  });
  return { ok: true };
}

export async function reviewPaymentException(
  user: Actor,
  requestId: string,
  raw: unknown,
) {
  if (user.role !== "admin")
    throw new AppError("Chỉ quản trị được duyệt.", 403);
  await ensurePaymentRequestSchema();
  const b = z
    .object({
      action: z.enum(["APPROVE", "REJECT"]).optional(),
      status: z.enum(["RESOLVED", "REFUNDED"]).optional(),
      note: z.string().trim().min(5).max(500),
    })
    .parse(raw);
  // Lock the order before the request, matching chef submission's lock order.
  const initial = (
    await rows<{ order_id: string }>(
      "SELECT order_id FROM payment_exceptions WHERE id=?",
      [requestId],
    )
  )[0];
  if (!initial) throw new AppError("Không tìm thấy yêu cầu.", 404);
  await transaction(async (db) => {
    const o = await getOrder(initial.order_id, user, db, true);
    const e = (
      await rows<{ status: string }>(
        "SELECT status FROM payment_exceptions WHERE id=? FOR UPDATE",
        [requestId],
        db,
      )
    )[0];
    if (!e) throw new AppError("Không tìm thấy yêu cầu.", 404);
    const d = (
      await rows<{ evidence_asset_id: string | null; resolution_type: string }>(
        "SELECT evidence_asset_id,resolution_type FROM payment_request_details WHERE exception_id=? FOR UPDATE",
        [requestId],
        db,
      )
    )[0];
    let status: string;
    if (d) {
      if (e.status !== "REVIEW" || !d.evidence_asset_id)
        throw new AppError(
          "Chỉ duyệt yêu cầu có bằng chứng của bếp đang chờ hệ thống.",
          409,
        );
      if (!b.action)
        throw new AppError("Chọn duyệt hoặc yêu cầu bếp bổ sung bằng chứng.");
      status = b.action === "APPROVE" ? d.resolution_type : "OPEN";
      await exec(
        "UPDATE payment_request_details SET review_note=?,reviewed_at=?,reviewed_by=? WHERE exception_id=?",
        [b.note, sqlDate(), user.id, requestId],
        db,
      );
    } else {
      if (e.status !== "OPEN" || !b.status)
        throw new AppError("Yêu cầu không còn chờ xử lý.", 409);
      status = b.status;
    }
    await exec(
      "UPDATE payment_exceptions SET status=? WHERE id=?",
      [status, requestId],
      db,
    );
    if (status === "REFUNDED")
      await exec(
        'UPDATE orders SET payment_status="REFUNDED_MANUAL" WHERE id=? AND payment_status="REFUND_PENDING"',
        [o.id],
        db,
      );
    for (const userId of new Set([o.user_id, o.chef_user_id]))
      await notify(
        db,
        userId,
        "order",
        status === "OPEN" ? "Cần bổ sung bằng chứng" : "Yêu cầu đã xử lý",
        `Đơn ${o.code}: ${b.note}`,
        `/orders/${o.id}`,
      );
    await log(db, user, "payment.exception.review", requestId, {
      ...b,
      status,
    });
  });
  return { ok: true };
}
