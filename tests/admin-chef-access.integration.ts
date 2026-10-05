import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { hash } from "bcryptjs";
import { authenticatedFixture } from "./authenticated-fixture";
import { exec, rows, pool, sqlDate } from "../src/lib/db";
import { ensureUserAccountSchema } from "../src/lib/user-account-schema";
import { updateAccountAccess } from "../src/lib/admin-user-access";
import {
  adminRestoreAccount,
  adminSoftDeleteAccount,
} from "../src/lib/user-account";
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
  // Restore a genuinely soft-deleted chef, then reopen their retained profile.
  await exec(
    "UPDATE user_account_details SET deleted_at=NULL WHERE user_id=?",
    [owner.user.id],
  );
  await exec("UPDATE users SET active=TRUE WHERE id=?", [owner.user.id]);
  const password = randomUUID();
  await exec("UPDATE users SET password_hash=? WHERE id=?", [
    await hash(password, 10),
    owner.user.id,
  ]);
  const oldToken = randomUUID(),
    oldHash = createHash("sha256").update(oldToken).digest("hex");
  await exec("INSERT INTO sessions VALUES (?,?,?)", [
    oldHash,
    owner.user.id,
    sqlDate(new Date(Date.now() + 3600000)),
  ]);
  await adminSoftDeleteAccount(actor, owner.user.id, {
    confirmation: "DELETE",
  });
  assert.equal((await approve(admin.cookie)).status, 409);
  const callRestore = async (
    cookie: string,
    body: unknown = { confirmation: "RESTORE" },
  ) => {
    const response = await fetch(
      `${base}/api/admin/users/${owner.user.id}/restore`,
      {
        method: "POST",
        headers: {
          origin: new URL(process.env.SITE_URL || base).origin,
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify(body),
      },
    );
    return { status: response.status, body: await response.json() };
  };
  const outsider = await authenticatedFixture(
    `${randomUUID()}@example.invalid`,
    "Restore outsider",
  );
  userIds.push(outsider.user.id);
  assert.equal((await callRestore(outsider.cookie)).status, 403);
  await assert.rejects(
    () =>
      adminRestoreAccount({ ...outsider.user, role: "admin" }, owner.user.id, {
        confirmation: "RESTORE",
      }),
    { status: 403 },
  );
  assert.equal((await callRestore(admin.cookie, {})).status, 400);
  const restored = await Promise.all([
    callRestore(admin.cookie),
    callRestore(admin.cookie),
  ]);
  assert.ok(restored.every((result) => result.status === 200));
  assert.equal(restored.filter((result) => result.body.changed).length, 1);
  assert.equal(Number((await state(owner.user.id)).owner.active), 1);
  assert.equal((await state(owner.user.id)).owner.role, "chef");
  assert.equal((await state(owner.user.id)).chef.status, "suspended");
  assert.equal(Number((await state(owner.user.id)).kitchen.is_open), 0);
  assert.equal(
    (
      await rows(
        "SELECT user_id FROM user_account_details WHERE user_id=? AND deleted_at IS NOT NULL",
        [owner.user.id],
      )
    ).length,
    0,
  );
  assert.equal(
    (
      await rows(
        "SELECT id FROM audit_logs WHERE entity_id=? AND action='user.restore'",
        [owner.user.id],
      )
    ).length,
    1,
  );
  const oldMe = await fetch(`${base}/api/auth/me`, {
    headers: { cookie: "tgbd_session=" + oldToken },
  });
  const oldState = await oldMe.json();
  assert.equal(oldState.user, null, "Old sessions must not be restored");
  assert.equal(
    oldState.accountStatus,
    null,
    "Old cookies must not report deletion after restore",
  );
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: {
      origin: new URL(process.env.SITE_URL || base).origin,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email: owner.user.email, password }),
  });
  assert.equal(login.status, 200, await login.text());
  assert.ok(login.headers.get("set-cookie")?.includes("tgbd_session="));
  assert.equal((await approve(admin.cookie)).status, 200);
  assert.equal((await state(owner.user.id)).chef.status, "approved");
  await updateAccountAccess(actor, owner.user.id, { active: false });
  assert.equal((await callRestore(admin.cookie)).body.changed, false);
  assert.equal(
    Number((await state(owner.user.id)).owner.active),
    0,
    "Restore retry must not unlock a separately locked account",
  );
  console.log(
    "Chef approval guards + admin restoration, fresh login, concurrent retries and reopening passed (HTTP + local MySQL).",
  );
} finally {
  await exec("DELETE FROM audit_logs WHERE entity_id=? OR actor_id IN (?)", [
    chefId,
    userIds.length ? userIds : ["none"],
  ]);
  for (const id of userIds) {
    for (const table of [
      "revoked_sessions",
      "user_account_details",
      "user_email_status",
      "email_verification_tokens",
    ])
      await exec(`DELETE FROM ${table} WHERE user_id=?`, [id]);
    await exec("DELETE FROM realtime_outbox WHERE user_id=?", [id]);
    await exec("DELETE FROM notifications WHERE user_id=?", [id]);
    await exec("DELETE FROM users WHERE id=?", [id]);
  }
  await exec(
    "DELETE FROM realtime_outbox WHERE JSON_UNQUOTE(JSON_EXTRACT(payload,'$.entityId')) IN (?)",
    [userIds.length ? userIds : ["none"]],
  );
  await pool().end();
}
