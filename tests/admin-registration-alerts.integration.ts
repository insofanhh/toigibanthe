import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { exec, rows, pool, sqlDate, transaction } from "../src/lib/db";
import { createAccount } from "../src/lib/account-registration";
import {
  ensureRegistrationAlertSchema,
  registrationAlerts,
  seeRegistrations,
} from "../src/lib/admin-registration-alerts";

assert.ok(
  ["localhost", "127.0.0.1"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  ),
  "Fixtures only allowed on local MySQL",
);
const [admin, otherAdmin, blockedAdmin] = Array.from({ length: 3 }, () =>
  randomUUID(),
);
const accounts: string[] = [];
try {
  await ensureRegistrationAlertSchema();
  for (const id of [admin, otherAdmin, blockedAdmin])
    await exec(
      "INSERT INTO users (id,name,email,password_hash,role,active,created_at) VALUES (?,?,?,'unusable','admin',?,?)",
      [
        id,
        "Registration fixture",
        `${id}@example.invalid`,
        id === blockedAdmin ? 0 : 1,
        sqlDate(),
      ],
    );
  assert.equal(
    (await registrationAlerts(admin)).count,
    0,
    "Existing users do not create alerts",
  );
  accounts.push(
    await transaction((db) =>
      createAccount(
        db,
        "Email fixture",
        `${randomUUID()}@example.invalid`,
        "unusable",
      ),
    ),
  );
  const first = await registrationAlerts(admin);
  assert.equal(first.count, 1);
  assert.equal(first.ids.length, 1);
  assert.equal((await registrationAlerts(otherAdmin)).count, 1);
  assert.equal((await registrationAlerts(blockedAdmin)).count, 0);
  accounts.push(
    await transaction((db) =>
      createAccount(
        db,
        "Google fixture",
        `${randomUUID()}@example.invalid`,
        "unusable",
      ),
    ),
  );
  assert.equal((await registrationAlerts(admin)).count, 2);
  const read = await seeRegistrations(admin, {
    ids: [...first.ids, ...first.ids],
  });
  assert.equal(
    read.count,
    1,
    "New registration arriving after snapshot remains unseen, duplicate IDs safe",
  );
  assert.equal(
    (await registrationAlerts(otherAdmin)).count,
    2,
    "Reading is isolated per admin",
  );
  assert.equal(
    (
      await seeRegistrations(admin, {
        ids: (await registrationAlerts(otherAdmin)).ids,
      })
    ).count,
    1,
    "Cannot acknowledge another admin's alerts",
  );
  const seenAgain = await seeRegistrations(admin, { ids: first.ids });
  assert.equal(seenAgain.count, 1, "Acknowledgement is idempotent");
  assert.equal(
    (await seeRegistrations(admin, { ids: seenAgain.ids })).count,
    0,
  );
  assert.equal(
    (await registrationAlerts(admin)).count,
    0,
    "Seen state persists across requests",
  );
  await assert.rejects(seeRegistrations(admin, { ids: ["invalid"] }));
  const before = (await registrationAlerts(otherAdmin)).count;
  await assert.rejects(
    transaction(async (db) => {
      const id = await createAccount(
        db,
        "Rollback",
        `${randomUUID()}@example.invalid`,
        "unusable",
      );
      accounts.push(id);
      throw new Error("Intentional rollback");
    }),
  );
  assert.equal(
    (await registrationAlerts(otherAdmin)).count,
    before,
    "Registration, alerts and outbox rollback together",
  );
  for (const id of accounts.slice(0, 2)) {
    const outbox = await rows<{
      user_id: string;
      payload: string | { type: string };
    }>(
      "SELECT user_id,payload FROM realtime_outbox WHERE JSON_UNQUOTE(JSON_EXTRACT(payload,'$.entityId'))=?",
      [id],
    );
    assert.ok(
      outbox.some(
        (e) =>
          e.user_id === admin &&
          (typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload)
            .type === "admin-user-registration",
      ),
    );
    assert.ok(!outbox.some((e) => e.user_id === blockedAdmin));
    const [alert] = await rows<{ id: string }>(
      "SELECT id FROM admin_registration_alerts WHERE admin_id=? AND user_id=?",
      [admin, id],
    );
    const registration = outbox.find(
      (e) =>
        e.user_id === admin &&
        (typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload)
          .type === "admin-user-registration",
    )!;
    const payload =
      typeof registration.payload === "string"
        ? JSON.parse(registration.payload)
        : registration.payload;
    assert.equal(
      (payload as { alertId: string }).alertId,
      alert.id,
      "WebSocket contains durable alert ID for immediate badge update",
    );
  }
  console.log(
    "PASS registration alerts: both account creation paths, active admins only, snapshot-safe reads, ownership, idempotency, persistence, validation and transactional rollback.",
  );
} finally {
  if (accounts.length) {
    const marks = accounts.map(() => "?").join(",");
    await exec(
      `DELETE FROM admin_registration_alerts WHERE user_id IN (${marks})`,
      accounts,
    );
    await exec(
      `DELETE FROM realtime_outbox WHERE JSON_UNQUOTE(JSON_EXTRACT(payload,'$.entityId')) IN (${marks})`,
      accounts,
    );
    await exec(`DELETE FROM users WHERE id IN (${marks})`, accounts);
  }
  await exec("DELETE FROM realtime_outbox WHERE user_id IN (?,?,?)", [
    admin,
    otherAdmin,
    blockedAdmin,
  ]);
  await exec(
    "DELETE FROM admin_registration_alerts WHERE admin_id IN (?,?,?)",
    [admin, otherAdmin, blockedAdmin],
  );
  await exec("DELETE FROM users WHERE id IN (?,?,?)", [
    admin,
    otherAdmin,
    blockedAdmin,
  ]);
  await pool().end();
}
