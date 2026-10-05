import { randomUUID } from "node:crypto";
import { z } from "zod";
import { exec, rows, sqlDate, transaction, type DB } from "./db";

let schemaReady: Promise<void> | null = null;
export function ensureRegistrationAlertSchema() {
  if (!schemaReady)
    schemaReady = rows("SELECT id FROM admin_registration_alerts LIMIT 0")
      .catch((error) => {
        if ((error as { code?: string }).code !== "ER_NO_SUCH_TABLE")
          throw error;
        return exec(`CREATE TABLE IF NOT EXISTS admin_registration_alerts (
      id VARCHAR(36) PRIMARY KEY, admin_id VARCHAR(36) NOT NULL,
      user_id VARCHAR(36) NOT NULL, created_at DATETIME(3) NOT NULL,
      seen_at DATETIME(3) NULL,
      UNIQUE KEY admin_registration_user (admin_id,user_id),
      INDEX admin_registration_unseen (admin_id,seen_at,created_at)
    )`);
      })
      .then(() => {})
      .catch((error) => {
        schemaReady = null;
        throw error;
      });
  return schemaReady;
}

// Called only when an account is created, inside the same transaction.
export async function registrationCreated(db: DB, userId: string) {
  const created = sqlDate();
  for (const admin of await rows<{ id: string }>(
    "SELECT id FROM users WHERE role='admin' AND active=TRUE",
    [],
    db,
  )) {
    await exec(
      "INSERT INTO admin_registration_alerts VALUES (?,?,?,?,NULL)",
      [randomUUID(), admin.id, userId, created],
      db,
    );
    await exec(
      "INSERT INTO realtime_outbox VALUES (?,?,?,?,NULL)",
      [
        randomUUID(),
        admin.id,
        JSON.stringify({ type: "admin-user-registration", entityId: userId }),
        created,
      ],
      db,
    );
  }
}

export type RegistrationAlerts = { count: number; ids: string[] };
export async function registrationAlerts(
  adminId: string,
): Promise<RegistrationAlerts> {
  await ensureRegistrationAlertSchema();
  // A consistent snapshot keeps the badge count and acknowledged IDs in sync.
  return transaction(async (db) => {
    const [{ count }] = await rows<{ count: number }>(
      "SELECT COUNT(*) count FROM admin_registration_alerts WHERE admin_id=? AND seen_at IS NULL",
      [adminId],
      db,
    );
    const alerts = await rows<{ id: string }>(
      "SELECT id FROM admin_registration_alerts WHERE admin_id=? AND seen_at IS NULL ORDER BY created_at,id LIMIT 500",
      [adminId],
      db,
    );
    return { count: Number(count), ids: alerts.map((a) => a.id) };
  });
}

const seenSchema = z.object({ ids: z.array(z.string().uuid()).max(500) });
export async function seeRegistrations(adminId: string, input: unknown) {
  const ids = [...new Set(seenSchema.parse(input).ids)];
  await ensureRegistrationAlertSchema();
  if (ids.length)
    await transaction(async (db) => {
      // Never mark registrations arriving after this client's snapshot as seen.
      const result = await exec(
        `UPDATE admin_registration_alerts SET seen_at=? WHERE admin_id=? AND seen_at IS NULL AND id IN (${ids.map(() => "?").join(",")})`,
        [sqlDate(), adminId, ...ids],
        db,
      );
      if (result.affectedRows)
        await exec(
          "INSERT INTO realtime_outbox VALUES (?,?,?,?,NULL)",
          [
            randomUUID(),
            adminId,
            JSON.stringify({ type: "admin-users-seen" }),
            sqlDate(),
          ],
          db,
        );
    });
  return registrationAlerts(adminId);
}
