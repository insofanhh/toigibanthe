import { randomUUID } from "node:crypto";
import { z } from "zod";
import { exec, rows, sqlDate, transaction, type DB } from "./db";
import { notify } from "./notifications";
import type { RegistrationAlerts } from "./admin-registration-alerts";

let schemaReady: Promise<void> | null = null;
export function ensureChefApplicationAlertSchema() {
  if (!schemaReady)
    schemaReady = rows("SELECT id FROM admin_chef_application_alerts LIMIT 0")
      .catch((error) => {
        if ((error as { code?: string }).code !== "ER_NO_SUCH_TABLE")
          throw error;
        return exec(`CREATE TABLE IF NOT EXISTS admin_chef_application_alerts (
          id VARCHAR(36) PRIMARY KEY, admin_id VARCHAR(36) NOT NULL,
          chef_id VARCHAR(36) NOT NULL, submission_id VARCHAR(36) NOT NULL,
          created_at DATETIME(3) NOT NULL, seen_at DATETIME(3) NULL,
          UNIQUE KEY admin_chef_submission (admin_id,submission_id),
          INDEX admin_chef_application_unseen (admin_id,seen_at,created_at)
        )`);
      })
      .then(() => {})
      .catch((error) => {
        schemaReady = null;
        throw error;
      });
  return schemaReady;
}

// Each successful submission, including a resubmission, is a distinct alert.
// Persist the application, alert, notification and realtime event together.
export async function chefApplicationCreated(
  db: DB,
  chefId: string,
  name: string,
) {
  const submissionId = randomUUID(),
    created = sqlDate();
  for (const admin of await rows<{ id: string }>(
    "SELECT id FROM users WHERE role='admin' AND active=TRUE",
    [],
    db,
  )) {
    const alertId = randomUUID();
    await exec(
      "INSERT INTO admin_chef_application_alerts (id,admin_id,chef_id,submission_id,created_at) VALUES (?,?,?,?,?)",
      [alertId, admin.id, chefId, submissionId, created],
      db,
    );
    await notify(
      db,
      admin.id,
      "system",
      "Yêu cầu mở bếp",
      `${name} đang chờ duyệt.`,
      "/admin?tab=chefs&cview=approvals&cstatus=pending",
      { type: "chef-application", alertId },
    );
  }
}

export async function chefApplicationAlerts(
  adminId: string,
): Promise<RegistrationAlerts> {
  await ensureChefApplicationAlertSchema();
  return transaction(async (db) => {
    // Reconcile applications approved before automatic acknowledgement existed.
    // Persist this so an old alert cannot return when a kitchen is suspended.
    await exec(
      "UPDATE admin_chef_application_alerts a JOIN chefs c ON c.id=a.chef_id SET a.seen_at=? WHERE a.admin_id=? AND a.seen_at IS NULL AND c.status='approved'",
      [sqlDate(), adminId],
      db,
    );
    const [{ count }] = await rows<{ count: number }>(
      "SELECT COUNT(*) count FROM admin_chef_application_alerts WHERE admin_id=? AND seen_at IS NULL",
      [adminId],
      db,
    );
    const alerts = await rows<{ id: string }>(
      "SELECT id FROM admin_chef_application_alerts WHERE admin_id=? AND seen_at IS NULL ORDER BY created_at,id LIMIT 500",
      [adminId],
      db,
    );
    return { count: Number(count), ids: alerts.map((a) => a.id) };
  });
}

// Called within the approval transaction while its chef row is locked.
export async function seeApprovedChefApplications(db: DB, chefId: string) {
  const alerts = await rows<{ admin_id: string }>(
    "SELECT admin_id FROM admin_chef_application_alerts WHERE chef_id=? AND seen_at IS NULL FOR UPDATE",
    [chefId],
    db,
  );
  if (!alerts.length) return;
  await exec(
    "UPDATE admin_chef_application_alerts SET seen_at=? WHERE chef_id=? AND seen_at IS NULL",
    [sqlDate(), chefId],
    db,
  );
  // Approval resolves the application for every admin tracking this kitchen.
  for (const adminId of new Set(alerts.map((a) => a.admin_id)))
    await exec(
      "INSERT INTO realtime_outbox VALUES (?,?,?,?,NULL)",
      [
        randomUUID(),
        adminId,
        JSON.stringify({ type: "admin-chefs-seen", chefId }),
        sqlDate(),
      ],
      db,
    );
}

const seenSchema = z.object({ ids: z.array(z.string().uuid()).max(500) });
export async function seeChefApplications(adminId: string, input: unknown) {
  const ids = [...new Set(seenSchema.parse(input).ids)];
  await ensureChefApplicationAlertSchema();
  if (ids.length)
    await transaction(async (db) => {
      const result = await exec(
        `UPDATE admin_chef_application_alerts SET seen_at=? WHERE admin_id=? AND seen_at IS NULL AND id IN (${ids.map(() => "?").join(",")})`,
        [sqlDate(), adminId, ...ids],
        db,
      );
      if (result.affectedRows)
        await exec(
          "INSERT INTO realtime_outbox VALUES (?,?,?,?,NULL)",
          [
            randomUUID(),
            adminId,
            JSON.stringify({ type: "admin-chefs-seen" }),
            sqlDate(),
          ],
          db,
        );
    });
  return chefApplicationAlerts(adminId);
}
