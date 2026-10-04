import { randomUUID } from "node:crypto";
import { exec, rows, sqlDate, type DB } from "./db";
import { AppError } from "./http";
import { notify } from "./notifications";

let ready: Promise<void> | null = null;
export function ensurePaymentRequestSchema() {
  if (!ready)
    ready = (async () => {
      await exec(`CREATE TABLE IF NOT EXISTS payment_request_details (
        exception_id VARCHAR(36) PRIMARY KEY, order_id VARCHAR(36) NOT NULL,
        contact_phone VARCHAR(20) NOT NULL, resolution_note TEXT,
        evidence_asset_id VARCHAR(36), resolution_type VARCHAR(20), submitted_at DATETIME(3),
        review_note TEXT, reviewed_at DATETIME(3), reviewed_by VARCHAR(36),
        UNIQUE KEY payment_request_order(order_id))`);
      await backfillPaymentRequests();
    })().catch((e) => {
      ready = null;
      throw e;
    });
  return ready;
}

export async function backfillPaymentRequests() {
  await exec(`INSERT IGNORE INTO payment_request_details (exception_id,order_id,contact_phone)
    SELECT e.id,e.order_id,COALESCE(NULLIF(u.phone,''),o.phone)
    FROM payment_exceptions e JOIN orders o ON o.id=e.order_id AND e.actor_id=o.user_id
    LEFT JOIN users u ON u.id=o.user_id
    WHERE NOT EXISTS (SELECT 1 FROM payment_exceptions older
      WHERE older.order_id=e.order_id AND older.actor_id=o.user_id
      AND (older.created_at<e.created_at OR (older.created_at=e.created_at AND older.id<e.id)))`);
}

export async function attachPaymentRequestSummaries<T extends { id: string }>(
  orders: T[],
) {
  if (!orders.length) return [];
  await ensurePaymentRequestSchema();
  const requests = await rows<{
    order_id: string;
    status: string;
    kind: string;
  }>(
    `SELECT d.order_id,e.status,e.kind FROM payment_request_details d
     JOIN payment_exceptions e ON e.id=d.exception_id
     WHERE d.order_id IN (${orders.map(() => "?").join(",")})`,
    orders.map((o) => o.id),
  );
  const byOrder = new Map(requests.map((r) => [r.order_id, r]));
  return orders.map((o) => ({
    ...o,
    payment_request_status: byOrder.get(o.id)?.status || null,
    payment_request_kind: byOrder.get(o.id)?.kind || null,
  }));
}

type RefundOrder = {
  id: string;
  code: string;
  user_id: string;
  chef_user_id: string;
  received_amount: number;
  total: number;
  phone: string;
};
// The caller holds the order lock; cancellation and this request commit together.
export async function createCancellationRefundRequest(
  db: DB,
  order: RefundOrder,
  reason: string,
  actorId: string,
) {
  const profile = (
    await rows<{ phone: string | null }>(
      "SELECT phone FROM users WHERE id=?",
      [order.user_id],
      db,
    )
  )[0];
  const phone = [profile?.phone, order.phone]
    .map((s) => (s || "").replace(/[\s().-]/g, ""))
    .find((s) => /^(\+84|0)[0-9]{9,10}$/.test(s));
  if (!phone)
    throw new AppError(
      "Bổ sung số điện thoại trong hồ sơ để bếp liên hệ hoàn tiền.",
    );
  const existing = (
    await rows<{ exception_id: string }>(
      "SELECT exception_id FROM payment_request_details WHERE order_id=? FOR UPDATE",
      [order.id],
      db,
    )
  )[0];
  const id = existing?.exception_id || randomUUID(),
    amount = Number(order.received_amount) || order.total;
  const note = `Yêu cầu hoàn tiền do đơn bị hủy / từ chối. Lý do: ${reason}`;
  if (existing) {
    await exec(
      "UPDATE payment_exceptions SET kind='REFUND',amount=?,note=CONCAT(note,'\n',?),status='OPEN' WHERE id=?",
      [amount, note, id],
      db,
    );
    await exec(
      `UPDATE payment_request_details SET contact_phone=?,resolution_note=NULL,evidence_asset_id=NULL,
      resolution_type=NULL,submitted_at=NULL,review_note=NULL,reviewed_at=NULL,reviewed_by=NULL WHERE exception_id=?`,
      [phone, id],
      db,
    );
  } else {
    await exec(
      "INSERT INTO payment_exceptions VALUES (?,?,?,?,?,?,?,?)",
      [id, order.id, order.user_id, "REFUND", amount, note, "OPEN", sqlDate()],
      db,
    );
    await exec(
      "INSERT INTO payment_request_details (exception_id,order_id,contact_phone) VALUES (?,?,?)",
      [id, order.id, phone],
      db,
    );
  }
  await notify(
    db,
    order.chef_user_id,
    "order",
    "Yêu cầu hoàn tiền",
    `Đơn ${order.code} đã hủy / từ chối. Liên hệ khách để hoàn tiền.`,
    `/orders/${order.id}`,
  );
  await exec(
    "INSERT INTO audit_logs VALUES (?,?,?,?,?,?)",
    [
      randomUUID(),
      actorId,
      "payment.cancellation.refund",
      id,
      JSON.stringify({ orderId: order.id, amount, reason }),
      sqlDate(),
    ],
    db,
  );
}
