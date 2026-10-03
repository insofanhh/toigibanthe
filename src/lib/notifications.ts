import { randomUUID } from "node:crypto";
import { exec, sqlDate, type DB } from "./db";
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
