import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { exec, rows, pool, sqlDate, transaction } from "../src/lib/db";
import { applyChef } from "../src/lib/manage";
import type { Actor } from "../src/lib/domain";
import {
  ensureChefApplicationAlertSchema,
  chefApplicationCreated,
  chefApplicationAlerts,
  seeChefApplications,
  seeApprovedChefApplications,
} from "../src/lib/admin-chef-application-alerts";
import { registrationAlerts } from "../src/lib/admin-registration-alerts";

assert.ok(
  ["localhost", "127.0.0.1"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  ),
  "Fixtures only allowed on local MySQL",
);
const [admin, otherAdmin, blockedAdmin, applicant, laterApplicant] = Array.from(
  { length: 5 },
  () => randomUUID(),
);
const userIds = [admin, otherAdmin, blockedAdmin, applicant, laterApplicant];
// Never queue device pushes to existing local admin subscriptions from fixtures.
process.env.VAPID_PUBLIC_KEY = "";
const names = ["Application " + randomUUID(), "Application " + randomUUID()];
const input = {
  name: names[0],
  bio: "Hồ sơ kiểm thử yêu cầu bếp",
  address: "123 Đường kiểm thử, Quận 3",
  area: "Quận 3",
  lat: 10.78,
  lng: 106.68,
  radiusKm: 5,
};
const actor = (id: string): Actor => ({
  id,
  name: "Fixture",
  email: `${id}@example.invalid`,
  phone: "",
  role: "user",
  active: 1,
});
try {
  await ensureChefApplicationAlertSchema();
  for (const id of userIds)
    await exec(
      "INSERT INTO users (id,name,email,password_hash,role,active,created_at) VALUES (?,?,?,'unusable',?,?,?)",
      [
        id,
        "Application fixture",
        `${id}@example.invalid`,
        [admin, otherAdmin, blockedAdmin].includes(id) ? "admin" : "user",
        id === blockedAdmin ? 0 : 1,
        sqlDate(),
      ],
    );
  assert.equal(
    (await chefApplicationAlerts(admin)).count,
    0,
    "No historical backfill",
  );
  const firstChef = await applyChef(actor(applicant), input);
  const first = await chefApplicationAlerts(admin);
  assert.equal(first.count, 1);
  assert.equal((await chefApplicationAlerts(otherAdmin)).count, 1);
  assert.equal((await chefApplicationAlerts(blockedAdmin)).count, 0);
  assert.equal(
    (await registrationAlerts(admin)).count,
    0,
    "Application does not increment Users badge",
  );
  await assert.rejects(
    applyChef(actor(applicant), input),
    /Bạn đã có hồ sơ bếp/,
  );
  assert.equal(
    (await chefApplicationAlerts(admin)).count,
    1,
    "Duplicate submission creates no alert",
  );
  for (const status of ["needs_changes", "rejected"]) {
    await exec("UPDATE chefs SET status=? WHERE id=?", [status, firstChef.id]);
    const again = await applyChef(actor(applicant), input);
    assert.equal(again.id, firstChef.id, "Resubmission retains chef identity");
  }
  assert.equal(
    (await chefApplicationAlerts(admin)).count,
    3,
    "Both resubmission paths create distinct alerts",
  );
  const snapshot = await chefApplicationAlerts(admin);
  await applyChef(actor(laterApplicant), {
    ...input,
    name: names[1],
  });
  const read = await seeChefApplications(admin, {
    ids: [...snapshot.ids, ...snapshot.ids],
  });
  assert.equal(read.count, 1, "Request after snapshot remains unseen");
  assert.equal(
    (await chefApplicationAlerts(otherAdmin)).count,
    4,
    "Each admin has independent read state",
  );
  assert.equal(
    (
      await seeChefApplications(admin, {
        ids: (await chefApplicationAlerts(otherAdmin)).ids,
      })
    ).count,
    1,
    "Cannot acknowledge another admin's alerts",
  );
  assert.equal(
    (await seeChefApplications(admin, { ids: snapshot.ids })).count,
    1,
    "Repeated acknowledgement is idempotent",
  );
  assert.equal((await seeChefApplications(admin, { ids: read.ids })).count, 0);
  assert.equal(
    (await chefApplicationAlerts(admin)).count,
    0,
    "Read state persists across requests",
  );
  await assert.rejects(seeChefApplications(admin, { ids: ["invalid"] }));
  const before = (await chefApplicationAlerts(otherAdmin)).count;
  await assert.rejects(
    transaction(async (db) => {
      await chefApplicationCreated(db, String(firstChef.id), names[0]);
      throw new Error("Intentional rollback");
    }),
    /Intentional rollback/,
  );
  assert.equal(
    (await chefApplicationAlerts(otherAdmin)).count,
    before,
    "Alert and event rollback together",
  );
  const alerts = await rows<{ id: string; admin_id: string }>(
    "SELECT id,admin_id FROM admin_chef_application_alerts WHERE chef_id=?",
    [firstChef.id],
  );
  for (const alert of alerts) {
    const events = await rows<{
      user_id: string;
      payload: string | Record<string, any>;
    }>(
      "SELECT user_id,payload FROM realtime_outbox WHERE JSON_UNQUOTE(JSON_EXTRACT(payload,'$.adminAlert.alertId'))=?",
      [alert.id],
    );
    assert.equal(
      events.length,
      1,
      "One realtime notification per alert, no duplicate toast event",
    );
    assert.equal(events[0].user_id, alert.admin_id);
    const payload =
      typeof events[0].payload === "string"
        ? JSON.parse(events[0].payload)
        : events[0].payload;
    assert.equal(payload.type, "notification");
    assert.equal(payload.adminAlert.type, "chef-application");
    assert.ok(payload.href.includes("cview=approvals"));
    assert.equal(
      (await rows("SELECT id FROM notifications WHERE id=?", [payload.id]))
        .length,
      1,
      "System notification retained",
    );
  }
  assert.ok(!alerts.some((a) => a.admin_id === blockedAdmin));
  await exec("UPDATE chefs SET status='needs_changes' WHERE id=?", [
    firstChef.id,
  ]);
  await applyChef(actor(applicant), input);
  assert.equal((await chefApplicationAlerts(admin)).count, 1);
  assert.equal((await chefApplicationAlerts(otherAdmin)).count, 5);
  await assert.rejects(
    transaction(async (db) => {
      await exec(
        "UPDATE chefs SET status='approved' WHERE id=?",
        [firstChef.id],
        db,
      );
      await seeApprovedChefApplications(db, String(firstChef.id));
      throw new Error("Approval rollback");
    }),
    /Approval rollback/,
  );
  assert.equal(
    (await chefApplicationAlerts(admin)).count,
    1,
    "Failed approval leaves badge intact",
  );
  assert.equal((await chefApplicationAlerts(otherAdmin)).count, 5);
  await transaction(async (db) => {
    await exec(
      "UPDATE chefs SET status='approved' WHERE id=?",
      [firstChef.id],
      db,
    );
    await seeApprovedChefApplications(db, String(firstChef.id));
  });
  assert.equal((await chefApplicationAlerts(admin)).count, 0);
  assert.equal(
    (await chefApplicationAlerts(otherAdmin)).count,
    1,
    "Approval clears only this kitchen, for all admins",
  );
  const approvalEvents = await rows<{ user_id: string }>(
    "SELECT user_id FROM realtime_outbox WHERE JSON_UNQUOTE(JSON_EXTRACT(payload,'$.chefId'))=? AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.type'))='admin-chefs-seen'",
    [firstChef.id],
  );
  assert.ok(approvalEvents.some((e) => e.user_id === admin));
  assert.ok(approvalEvents.some((e) => e.user_id === otherAdmin));
  await transaction((db) =>
    seeApprovedChefApplications(db, String(firstChef.id)),
  );
  assert.equal(
    (
      await rows(
        "SELECT id FROM realtime_outbox WHERE JSON_UNQUOTE(JSON_EXTRACT(payload,'$.chefId'))=?",
        [firstChef.id],
      )
    ).length,
    approvalEvents.length,
    "Repeated approval does not emit duplicate read events",
  );
  await exec("UPDATE chefs SET status='approved' WHERE user_id=?", [
    laterApplicant,
  ]);
  assert.equal(
    (await chefApplicationAlerts(otherAdmin)).count,
    0,
    "Previously approved kitchen alerts are reconciled",
  );
  await exec("UPDATE chefs SET status='suspended' WHERE user_id IN (?,?)", [
    applicant,
    laterApplicant,
  ]);
  assert.equal(
    (await chefApplicationAlerts(otherAdmin)).count,
    0,
    "Suspending an approved kitchen does not revive old alerts",
  );
  console.log(
    "PASS chef application alerts: submissions, duplicate prevention, active admins, Users isolation, snapshot-safe reads, ownership, persistence, rollback, approval acknowledgement for all admins, other kitchen preserved, realtime read events, idempotency and historical approval reconciliation.",
  );
} finally {
  // Also find chefs if an assertion failed immediately after applyChef committed.
  const allChefs = await rows<{ id: string }>(
    "SELECT id FROM chefs WHERE user_id IN (?,?)",
    [applicant, laterApplicant],
  );
  for (const { id } of allChefs) {
    await exec(
      "DELETE FROM realtime_outbox WHERE JSON_UNQUOTE(JSON_EXTRACT(payload,'$.chefId'))=?",
      [id],
    );
    await exec(
      "DELETE o FROM realtime_outbox o JOIN admin_chef_application_alerts a ON JSON_UNQUOTE(JSON_EXTRACT(o.payload,'$.adminAlert.alertId'))=a.id WHERE a.chef_id=?",
      [id],
    );
    await exec("DELETE FROM admin_chef_application_alerts WHERE chef_id=?", [
      id,
    ]);
    await exec("DELETE FROM audit_logs WHERE entity_id=?", [id]);
    await exec("DELETE FROM chefs WHERE id=?", [id]);
  }
  await exec(
    "DELETE FROM notifications WHERE body IN (?,?)",
    names.map((name) => `${name} đang chờ duyệt.`),
  );
  const marks = userIds.map(() => "?").join(",");
  await exec(
    `DELETE FROM realtime_outbox WHERE user_id IN (${marks})`,
    userIds,
  );
  await exec(
    `DELETE FROM admin_chef_application_alerts WHERE admin_id IN (${marks})`,
    userIds,
  );
  await exec(`DELETE FROM users WHERE id IN (${marks})`, userIds);
  await pool().end();
}
