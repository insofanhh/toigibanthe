import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { authenticatedFixture } from "./authenticated-fixture";
import { exec, rows, pool, sqlDate } from "../src/lib/db";
import { ensureUserAccountSchema } from "../src/lib/user-account-schema";
import { updateAccountAccess } from "../src/lib/admin-user-access";
import type { Actor } from "../src/lib/domain";

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3010";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
assert.ok(
  ["localhost", "127.0.0.1"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  ),
);
const userIds: string[] = [];
const chefId = randomUUID(),
  kitchenId = randomUUID();
async function approve(cookie: string, status = "approved") {
  const response = await fetch(`${base}/api/admin/chefs/${chefId}`, {
    method: "POST",
    headers: {
      origin: new URL(process.env.SITE_URL || base).origin,
      "content-type": "application/json",
      cookie,
    },
    body: JSON.stringify({
      status,
      reason: status === "approved" ? "" : "Fixture suspension",
    }),
  });
  return { status: response.status, body: await response.json() };
}
async function state(ownerId: string) {
  return {
    chef: (
      await rows("SELECT status,rejection_reason FROM chefs WHERE id=?", [
        chefId,
      ])
    )[0],
    owner: (
      await rows("SELECT role,active FROM users WHERE id=?", [ownerId])
    )[0],
    kitchen: (
      await rows("SELECT is_open FROM kitchen_sessions WHERE id=?", [kitchenId])
    )[0],
    audits: await rows(
      "SELECT id FROM audit_logs WHERE entity_id=? AND action='chef.status' ORDER BY id",
      [chefId],
    ),
    notifications: await rows(
      "SELECT id FROM notifications WHERE user_id=? ORDER BY id",
      [ownerId],
    ),
  };
}
try {
  await ensureUserAccountSchema();
  const admin = await authenticatedFixture(
    `${randomUUID()}@example.invalid`,
    "Chef access admin",
  );
  userIds.push(admin.user.id);
  const owner = await authenticatedFixture(
    `${randomUUID()}@example.invalid`,
    "Chef access owner",
  );
  userIds.push(owner.user.id);
  await exec("UPDATE users SET role='admin' WHERE id=?", [admin.user.id]);
  const actor: Actor = { ...admin.user, role: "admin" };
  await exec(
    "INSERT INTO chefs (id,user_id,name,bio,address,area,lat,lng,status,created_at) VALUES (?,?,?,'Fixture','Fixture','Fixture',10,106,'pending',?)",
    [chefId, owner.user.id, "Chef access fixture", sqlDate()],
  );
  await exec("INSERT INTO kitchen_sessions VALUES (?,?,?,?,?)", [
    kitchenId,
    chefId,
    "2026-10-06",
    false,
    sqlDate(),
  ]);
  assert.equal((await approve(owner.cookie)).status, 403);

  await updateAccountAccess(actor, owner.user.id, { active: false });
  for (const status of ["pending", "suspended", "approved"]) {
    await exec(
      "UPDATE chefs SET status=?,rejection_reason='Existing reason' WHERE id=?",
      [status, chefId],
    );
    const before = await state(owner.user.id);
    const result = await approve(admin.cookie);
    assert.equal(result.status, 409, JSON.stringify(result.body));
    assert.match(result.body.error, /đang bị khóa/);
    assert.deepEqual(
      await state(owner.user.id),
      before,
      "Blocked approval must not mutate profile, role, kitchen, audit or notifications",
    );
  }
  // Unlocking the account permits reopening, but does not open the kitchen automatically.
  await updateAccountAccess(actor, owner.user.id, { active: true });
  await exec("UPDATE chefs SET status='suspended' WHERE id=?", [chefId]);
  assert.equal((await approve(admin.cookie)).status, 200);
  const reopened = await state(owner.user.id);
  assert.equal(reopened.chef.status, "approved");
  assert.equal(reopened.owner.role, "chef");
  assert.equal(Number(reopened.kitchen.is_open), 0);
  assert.equal(reopened.audits.length, 1);
  assert.equal(reopened.notifications.length, 1);

  // A locked owner can still have their kitchen suspended by admin.
  await updateAccountAccess(actor, owner.user.id, { active: false });
  assert.equal((await approve(admin.cookie, "suspended")).status, 200);
  await exec(
    "INSERT INTO user_account_details (user_id,deleted_at) VALUES (?,?)",
    [owner.user.id, sqlDate()],
  );
  for (const active of [false, true]) {
    // deleted_at must win even if active is accidentally changed directly in SQL.
    await exec("UPDATE users SET active=? WHERE id=?", [active, owner.user.id]);
    const before = await state(owner.user.id);
    const result = await approve(admin.cookie);
    assert.equal(result.status, 409);
    assert.match(result.body.error, /đã bị xóa/);
    assert.deepEqual(await state(owner.user.id), before);
  }
  console.log(
    "Chef approval/reopening account guards passed (HTTP + local MySQL).",
  );
} finally {
  await exec("DELETE FROM audit_logs WHERE entity_id=? OR actor_id IN (?)", [
    chefId,
    userIds.length ? userIds : ["none"],
  ]);
  for (const id of userIds) {
    await exec("DELETE FROM realtime_outbox WHERE user_id=?", [id]);
    await exec("DELETE FROM notifications WHERE user_id=?", [id]);
    await exec("DELETE FROM users WHERE id=?", [id]);
  }
  await pool().end();
}
