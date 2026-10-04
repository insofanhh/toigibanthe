import { randomUUID } from "node:crypto";
import { exec, rows, sqlDate, transaction, type DB } from "./db";
import { AppError } from "./http";
import { queueNotificationPush } from "./push";
export async function readNotification(userId: string, notificationId: string) {
  await transaction(async (db) => {
    const [notification] = await rows(
      "SELECT id FROM notifications WHERE id=? AND user_id=? FOR UPDATE",
      [notificationId, userId],
      db,
    );
    if (!notification) throw new AppError("Không tìm thấy thông báo.", 404);
    await exec(
      "UPDATE notifications SET is_read=TRUE WHERE id=? AND user_id=? AND is_read=FALSE",
      [notificationId, userId],
      db,
    );
  });
  return {
    ok: true,
    notificationId,
    unreadCounts: await unreadNotificationCounts(userId),
  };
}
export async function unreadNotificationCounts(userId: string) {
  const counts = { news: 0, order: 0, promotion: 0, total: 0 };
  for (const row of await rows<{ category: string; count: number }>(
    "SELECT category,COUNT(*) count FROM notifications WHERE user_id=? AND is_read=FALSE GROUP BY category",
    [userId],
  )) {
    const count = Number(row.count);
    const group =
      row.category === "order"
        ? "order"
        : row.category === "promotion"
          ? "promotion"
          : "news";
    counts[group] += count;
    counts.total += count;
  }
  return counts;
}
export async function notify(
  db: DB,
  userId: string,
  category: string,
  title: string,
  body: string,
  href: string,
) {
  const id = randomUUID(),
    created = sqlDate();
  await exec(
    "INSERT INTO notifications VALUES (?,?,?,?,?,?,?,?)",
    [id, userId, category, title, body, href, false, created],
    db,
  );
  await exec(
    "INSERT INTO realtime_outbox VALUES (?,?,?,?,NULL)",
    [
      randomUUID(),
      userId,
      JSON.stringify({
        type: "notification",
        id,
        category,
        title,
        body,
        href,
        created_at: created,
      }),
      created,
    ],
    db,
  );
  await queueNotificationPush(db, userId, id, category);
}
