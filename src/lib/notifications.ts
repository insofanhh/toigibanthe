import { randomUUID } from "node:crypto";
import { exec, rows, sqlDate, type DB } from "./db";
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
}
