import { randomUUID } from "node:crypto";
import { rows, exec, sqlDate, transaction, type DB } from "./db";
import { notify } from "./notifications";
export async function queueBroadcast(
  db: DB,
  audience: string,
  category: string,
  title: string,
  body: string,
  href: string,
) {
  await exec(
    "INSERT INTO broadcast_jobs VALUES (?,?,?,?,?,?,?,?,?)",
    [randomUUID(), audience, category, title, body, href, "", false, sqlDate()],
    db,
  );
}
export async function processBroadcasts() {
  for (let batch = 0; batch < 5; batch++) {
    const processed = await transaction(async (db) => {
      const job = (
        await rows<{
          id: string;
          audience: string;
          category: string;
          title: string;
          body: string;
          href: string;
          cursor_id: string;
        }>(
          "SELECT * FROM broadcast_jobs WHERE done=FALSE ORDER BY created_at LIMIT 1 FOR UPDATE",
          [],
          db,
        )
      )[0];
      if (!job) return false;
      const users = await rows<{ id: string; role: string }>(
        "SELECT id,role FROM users WHERE id>? AND active=TRUE ORDER BY id LIMIT 100",
        [job.cursor_id],
        db,
      );
      for (const user of users)
        if (
          job.audience === "all" ||
          (job.audience === "chef" && user.role === "chef") ||
          (job.audience === "user" && user.role !== "admin")
        )
          await notify(
            db,
            user.id,
            job.category,
            job.title,
            job.body,
            job.href,
          );
      await exec(
        "UPDATE broadcast_jobs SET cursor_id=?,done=? WHERE id=?",
        [users.at(-1)?.id || job.cursor_id, users.length < 100, job.id],
        db,
      );
      return true;
    });
    if (!processed) break;
  }
}
