import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { hash } from "bcryptjs";
import { exec, rows, pool, sqlDate } from "../src/lib/db";
import { updateUserProfile, softDeleteAccount } from "../src/lib/user-account";
import { ensureUserAccountSchema } from "../src/lib/user-account-schema";
import { ensurePushSchema } from "../src/lib/push-schema";
import { ensureEmailVerificationSchema } from "../src/lib/email-verification-schema";
import { adminUsersList, adminUserDetail } from "../src/lib/admin-users";
import { updateAccountAccess } from "../src/lib/admin-user-access";
import { signIn } from "../src/lib/auth";
import { type Actor, serviceDate } from "../src/lib/domain";

assert.ok(
  ["localhost", "127.0.0.1"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  ),
  "Local MySQL fixtures only",
);
const suffix = randomUUID();
const users: Actor[] = ["user", "chef", "admin"].map((role) => ({
  id: randomUUID(),
  name: "Account fixture " + suffix,
  email: `${role}-${suffix}@example.invalid`,
  phone: "",
  role: role as Actor["role"],
  active: 1,
}));
const ids = users.map((user) => user.id);
const assets = [randomUUID(), randomUUID(), randomUUID()];
const chefId = randomUUID(),
  orderId = randomUUID(),
  requestId = randomUUID();
const password = randomUUID(),
  passwordHash = await hash(password, 12);
const token = randomBytes(32).toString("base64url");
const sessionHash = createHash("sha256").update(token).digest("hex");
const at = sqlDate(),
  avatarUrl = "https://example.invalid/avatar.webp";
const query = new URLSearchParams({
  from: serviceDate(),
  to: serviceDate(),
  q: suffix,
});
const confirmation = { confirmation: "DELETE" };

try {
  await ensureUserAccountSchema();
  await ensurePushSchema();
  await ensureEmailVerificationSchema();
  for (const user of users)
    await exec(
      "INSERT INTO users (id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)",
      [user.id, user.name, user.email, passwordHash, user.role, at],
    );
  for (let i = 0; i < assets.length; i++)
    await exec("INSERT INTO assets VALUES (?,?,?,?,?,?,?,?)", [
      assets[i],
      i === 1 ? users[1].id : users[0].id,
      i === 2 ? "document" : "image",
      avatarUrl,
      `image/${assets[i]}.webp`,
      i === 2 ? "application/pdf" : "image/webp",
      "fixture.webp",
      at,
    ]);
  await updateUserProfile(users[0], {
    name: users[0].name,
    phone: "0901234567",
    avatarAssetId: assets[0],
  });
  let list = await adminUsersList(query);
  assert.equal(
    list.users.find((u) => u.id === users[0].id)?.avatar_url,
    avatarUrl,
  );
  await assert.rejects(
    () =>
      updateUserProfile(users[0], {
        name: "Rejected avatar",
        phone: "",
        avatarAssetId: assets[1],
      }),
    /Ảnh đại diện không hợp lệ/,
  );
  await assert.rejects(
    () =>
      updateUserProfile(users[0], {
        name: "Rejected document",
        phone: "",
        avatarAssetId: assets[2],
      }),
    /Ảnh đại diện không hợp lệ/,
  );
  await updateUserProfile(users[0], {
    name: users[0].name,
    phone: "0901234567",
    avatarAssetId: null,
  });
  assert.equal(
    (await adminUsersList(query)).users.find((u) => u.id === users[0].id)
      ?.avatar_url,
    null,
  );
  await updateUserProfile(users[0], {
    name: users[0].name,
    phone: "0901234567",
    avatarAssetId: assets[0],
  });
  await assert.rejects(() => softDeleteAccount(users[0], {}));
  await exec(
    "INSERT INTO chefs (id,user_id,name,bio,address,area,lat,lng,status,created_at) VALUES (?,?,?,'Fixture','Fixture','Fixture',10,106,'approved',?)",
    [chefId, users[1].id, users[1].name, at],
  );
  await exec("INSERT INTO kitchen_sessions VALUES (?,?,?,TRUE,?)", [
    randomUUID(),
    chefId,
    serviceDate(),
    at,
  ]);
  await exec(
    `INSERT INTO orders (id,code,user_id,chef_id,meal_id,status,payment_status,subtotal,delivery_fee,total,recipient,phone,address,lat,lng,chef_lat,chef_lng,distance_km,bank_bin,bank_name,account_no,account_name,transfer_content,idempotency_key,expires_at,created_at,updated_at)
    VALUES (?,?,?,?, 'lunch','DELIVERED','PAID',50000,0,50000,'Fixture','0901234567','Fixture',10,106,10,106,0,'970422','Bank','123','Fixture',?,?, ?,?,?)`,
    [
      orderId,
      suffix.slice(0, 16),
      users[0].id,
      chefId,
      suffix.slice(0, 20),
      suffix,
      at,
      at,
      at,
    ],
  );
  await assert.rejects(() => softDeleteAccount(users[0], confirmation), {
    status: 409,
  });
  await assert.rejects(() => softDeleteAccount(users[1], confirmation), {
    status: 409,
  });
  await exec(
    "UPDATE orders SET status='COMPLETED',payment_status='REFUND_PENDING' WHERE id=?",
    [orderId],
  );
  await assert.rejects(() => softDeleteAccount(users[0], confirmation), {
    status: 409,
  });
  await exec("UPDATE orders SET payment_status='PAID' WHERE id=?", [orderId]);
  await exec("INSERT INTO payment_exceptions VALUES (?,?,?,?,?,?,?,?)", [
    requestId,
    orderId,
    users[0].id,
    "REFUND",
    50000,
    "Fixture",
    "REVIEW",
    at,
  ]);
  await assert.rejects(() => softDeleteAccount(users[0], confirmation), {
    status: 409,
  });
  await exec("UPDATE payment_exceptions SET status='RESOLVED' WHERE id=?", [
    requestId,
  ]);
  await exec("INSERT INTO sessions VALUES (?,?,?)", [
    sessionHash,
    users[0].id,
    sqlDate(new Date(Date.now() + 3600000)),
  ]);
  await exec("INSERT INTO sessions VALUES (?,?,?)", [
    randomUUID(),
    users[0].id,
    sqlDate(new Date(Date.now() + 3600000)),
  ]);
  await exec(
    "INSERT INTO email_verification_tokens (token_hash,user_id,email,next_path,expires_at,created_at) VALUES (?,?,?,'/me',?,?)",
    [
      randomUUID(),
      users[0].id,
      users[0].email,
      sqlDate(new Date(Date.now() + 3600000)),
      at,
    ],
  );
  await exec(
    "INSERT INTO push_subscriptions (id,endpoint_hash,user_id,session_hash,endpoint,p256dh,auth,vapid_hash,created_at,updated_at) VALUES (?,?,?,?,?,'fixture','fixture','fixture',?,?)",
    [
      randomUUID(),
      randomUUID(),
      users[0].id,
      sessionHash,
      "https://example.invalid/push",
      at,
      at,
    ],
  );

  const base = process.env.TEST_BASE_URL;
  if (base) {
    assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
    const call = (method: string, body?: unknown) =>
      fetch(base + "/api/profile", {
        method,
        headers: {
          cookie: "tgbd_session=" + token,
          origin: new URL(process.env.SITE_URL || base).origin,
          "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const me = await fetch(base + "/api/auth/me", {
      headers: { cookie: "tgbd_session=" + token },
    });
    assert.equal((await me.json()).user.avatar_url, avatarUrl);
    const invalid = await call("DELETE", {});
    assert.equal(invalid.status, 400);
    const result = await call("DELETE", confirmation);
    assert.equal(result.status, 200, await result.text());
    assert.ok(result.headers.get("set-cookie")?.includes("tgbd_session=;"));
    const rejected = await call("PATCH", {
      name: "Deleted account",
      phone: "",
    });
    assert.equal(rejected.status, 401);
    const anonymous = await fetch(base + "/api/auth/me", {
      headers: { cookie: "tgbd_session=" + token },
    });
    assert.equal((await anonymous.json()).user, null);
  } else await softDeleteAccount(users[0], confirmation);

  const [deleted] = await rows<{ active: number; deleted_at: string }>(
    "SELECT u.active,d.deleted_at FROM users u JOIN user_account_details d ON d.user_id=u.id WHERE u.id=?",
    [users[0].id],
  );
  assert.equal(deleted.active, 0);
  assert.ok(deleted.deleted_at);
  assert.equal(
    (await rows("SELECT * FROM sessions WHERE user_id=?", [users[0].id]))
      .length,
    0,
  );
  assert.equal(
    (
      await rows<{ active: number }>(
        "SELECT active FROM push_subscriptions WHERE user_id=?",
        [users[0].id],
      )
    )[0].active,
    0,
  );
  assert.ok(
    (
      await rows<{ consumed_at: string }>(
        "SELECT consumed_at FROM email_verification_tokens WHERE user_id=?",
        [users[0].id],
      )
    )[0].consumed_at,
  );
  await assert.rejects(() => signIn(users[0].email, password), { status: 401 });
  await assert.rejects(
    () => updateUserProfile(users[0], { name: "Stale session", phone: "" }),
    { status: 401 },
  );
  await assert.rejects(
    () => updateAccountAccess(users[2], users[0].id, { active: true }),
    { status: 409 },
  );
  await assert.rejects(
    () => updateAccountAccess(users[2], users[0].id, { role: "admin" }),
    { status: 409 },
  );
  list = await adminUsersList(query);
  assert.ok(list.users.find((u) => u.id === users[0].id)?.deleted_at);
  const detail = await adminUserDetail(users[0].id, query);
  assert.equal(detail.total, 1);
  assert.equal(detail.user.avatar_url, avatarUrl);
  const attempts = await Promise.allSettled([
    softDeleteAccount(users[1], confirmation),
    softDeleteAccount(users[1], confirmation),
  ]);
  assert.equal(
    attempts.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    (
      await rows<{ status: string }>("SELECT status FROM chefs WHERE id=?", [
        chefId,
      ])
    )[0].status,
    "suspended",
  );
  assert.equal(
    (
      await rows<{ is_open: number }>(
        "SELECT is_open FROM kitchen_sessions WHERE chef_id=?",
        [chefId],
      )
    )[0].is_open,
    0,
  );
  console.log(
    "PASS account profile/avatar ownership, removal, admin visibility, pending order/refund guards, soft delete preserving order history, session/push/token revocation, login/access rejection, concurrent deletion, chef closure" +
      (base ? ", authenticated HTTP and cookie removal" : ""),
  );
} finally {
  await exec("DELETE FROM audit_logs WHERE actor_id IN (?)", [ids]);
  await exec(
    "DELETE FROM realtime_outbox WHERE user_id IN (?) OR JSON_UNQUOTE(JSON_EXTRACT(payload,'$.entityId')) IN (?)",
    [ids, ids],
  );
  await exec("DELETE FROM payment_exceptions WHERE id=?", [requestId]);
  await exec("DELETE FROM orders WHERE id=?", [orderId]);
  await exec("DELETE FROM kitchen_sessions WHERE chef_id=?", [chefId]);
  await exec("DELETE FROM chefs WHERE id=?", [chefId]);
  for (const table of [
    "sessions",
    "push_subscriptions",
    "email_verification_tokens",
    "user_account_details",
    "user_email_status",
  ])
    await exec(`DELETE FROM ${table} WHERE user_id IN (?)`, [ids]);
  await exec("DELETE FROM assets WHERE id IN (?)", [assets]);
  await exec("DELETE FROM users WHERE id IN (?)", [ids]);
  await pool().end();
}
