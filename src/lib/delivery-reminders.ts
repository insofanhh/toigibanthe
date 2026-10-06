import { exec, rows, sqlDate, transaction, type DB } from "./db";
import { notify } from "./notifications";

export const DELIVERY_CONFIRMATION_DELAY_MS = 60 * 60 * 1000;
export const DELIVERY_REMINDER_SCHEMA = `CREATE TABLE IF NOT EXISTS order_delivery_reminders (
  order_id VARCHAR(36) PRIMARY KEY,
  due_at DATETIME(3) NOT NULL,
  state VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  notification_id VARCHAR(36), processed_at DATETIME(3),
  INDEX delivery_reminder_due(state,due_at)
)`;
let ready: Promise<void> | null = null;
export function ensureDeliveryReminderSchema() {
  if (!ready)
    ready = exec(DELIVERY_REMINDER_SCHEMA)
      .then(() => {})
      .catch((error) => {
        ready = null;
        throw error;
      });
  return ready;
}

// Called with the order locked; the unique order ID keeps retries from resetting the clock.
export async function queueDeliveryReminder(
  db: DB,
  orderId: string,
  deliveredAt = new Date(),
) {
  await exec(
    "INSERT IGNORE INTO order_delivery_reminders (order_id,due_at) VALUES (?,?)",
    [
      orderId,
      sqlDate(new Date(deliveredAt.getTime() + DELIVERY_CONFIRMATION_DELAY_MS)),
    ],
    db,
  );
}
export async function cancelDeliveryReminder(db: DB, orderId: string) {
  await exec(
    "UPDATE order_delivery_reminders SET state='CANCELLED',processed_at=? WHERE order_id=? AND state='PENDING'",
    [sqlDate(), orderId],
    db,
  );
}

export async function processDeliveryReminders(now = new Date()) {
  await ensureDeliveryReminderSchema();
  // Upgrade orders delivered before this feature. Use the actual delivery event, not later updates.
  await exec(`INSERT IGNORE INTO order_delivery_reminders (order_id,due_at)
    SELECT o.id,DATE_ADD(COALESCE(
      (SELECT MAX(e.created_at) FROM order_events e WHERE e.order_id=o.id AND e.status='DELIVERED'),
      o.updated_at),INTERVAL 1 HOUR)
    FROM orders o LEFT JOIN order_delivery_reminders r ON r.order_id=o.id
    WHERE o.status='DELIVERED' AND r.order_id IS NULL
    ORDER BY o.updated_at,o.id LIMIT 100`);
  const cutoff = sqlDate(now);
  const pending = await rows<{ order_id: string }>(
    "SELECT order_id FROM order_delivery_reminders WHERE state='PENDING' AND due_at<=? ORDER BY due_at,order_id LIMIT 100",
    [cutoff],
  );
  const result = { sent: 0, cancelled: 0 };
  for (const item of pending) {
    const state = await transaction(async (db) => {
      // Always lock the order before the reminder, matching the transition lock order.
      // This serializes with customer confirmation and with other cron/worker instances.
      const [order] = await rows<{
        id: string;
        code: string;
        user_id: string;
        status: string;
      }>(
        "SELECT id,code,user_id,status FROM orders WHERE id=? FOR UPDATE",
        [item.order_id],
        db,
      );
      const [reminder] = await rows<{ order_id: string }>(
        "SELECT order_id FROM order_delivery_reminders WHERE order_id=? AND state='PENDING' AND due_at<=? FOR UPDATE",
        [item.order_id, cutoff],
        db,
      );
      if (!reminder) return null;
      if (!order || order.status !== "DELIVERED") {
        await cancelDeliveryReminder(db, item.order_id);
        return "cancelled" as const;
      }
      const notificationId = await notify(
        db,
        order.user_id,
        "order",
        "Xác nhận đã nhận món",
        `Bếp đã báo giao đơn ${order.code} hơn 1 giờ trước. Nếu đã nhận đủ món, hãy mở đơn và bấm “Đã nhận món” để hoàn thành. Nếu chưa nhận được, hãy liên hệ bếp.`,
        `/orders/${order.id}`,
      );
      await exec(
        "UPDATE order_delivery_reminders SET state='SENT',notification_id=?,processed_at=? WHERE order_id=?",
        [notificationId, cutoff, order.id],
        db,
      );
      return "sent" as const;
    });
    if (state) result[state]++;
  }
  return result;
}
