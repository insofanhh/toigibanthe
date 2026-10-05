import { randomUUID } from "node:crypto";
import { rows, exec, sqlDate, type DB } from "./db";

export async function analyticsLive(db: DB, entityId: string) {
  for (const a of await rows<{ id: string }>(
    'SELECT id FROM users WHERE role="admin" AND active=TRUE',
    [],
    db,
  ))
    await exec(
      "INSERT INTO realtime_outbox VALUES (?,?,?,?,NULL)",
      [
        randomUUID(),
        a.id,
        JSON.stringify({ type: "admin-analytics", entityId }),
        sqlDate(),
      ],
      db,
    );
}
