import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { updateAccountAccess } from "../src/lib/admin-user-access";
import { exec, rows, pool, sqlDate } from "../src/lib/db";
import type { Actor } from "../src/lib/domain";

assert.ok(
  ["localhost", "127.0.0.1"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  ),
  "Only run fixtures on local MySQL",
);
const ids = Array.from({ length: 5 }, () => randomUUID());
const chefId = randomUUID();
const actors = ids.map((id, index): Actor => ({
  id,
  name: "Access fixture",
  email: `${id}@access.local`,
  phone: "",
  role: index < 3 ? "admin" : "user",
  active: 1,
}));
const session = randomUUID();
const kitchen = randomUUID();
const orderId = randomUUID();
const state = async (id: string) =>
  (await rows<Actor>("SELECT id,role,active FROM users WHERE id=?", [id]))[0];
try {
  for (const actor of actors)
    await exec(
      "INSERT INTO users (id,name,email,password_hash,role,active,created_at) VALUES (?,?,?,?,?,?,?)",
      [
        actor.id,
        actor.name,
        actor.email,
        "invalid-fixture",
        actor.role,
        true,
        sqlDate(),
      ],
    );
  await assert.rejects(
    () => updateAccountAccess(actors[3], ids[4], { role: "admin" }),
    { status: 403 },
  );
  await assert.rejects(
    () => updateAccountAccess(actors[0], ids[0], { role: "user" }),
    /đang dùng/,
  );
  await assert.rejects(
    () => updateAccountAccess(actors[0], ids[0], { active: false }),
    /đang dùng/,
  );
  await assert.rejects(
    () => updateAccountAccess(actors[0], randomUUID(), { role: "admin" }),
    { status: 404 },
  );
  await assert.rejects(() =>
    updateAccountAccess(actors[0], ids[4], { role: "owner" }),
  );
  await assert.rejects(() => updateAccountAccess(actors[0], ids[4], {}));
  await assert.rejects(() =>
    updateAccountAccess(actors[0], ids[4], {
      role: "chef",
      active: true,
      name: "ignored",
    }),
  );
  await assert.rejects(
    () => updateAccountAccess(actors[0], ids[4], { role: "chef" }),
    /hồ sơ bếp đã duyệt/,
  );
  await exec("INSERT INTO sessions VALUES (?,?,?)", [
    session,
    ids[4],
    sqlDate(new Date(Date.now() + 86400000)),
  ]);
  await updateAccountAccess(actors[0], ids[4], { role: "admin" });
  assert.equal((await state(ids[4])).role, "admin");
  assert.equal(
    (await rows("SELECT token_hash FROM sessions WHERE user_id=?", [ids[4]]))
      .length,
    0,
  );
  const [audit] = await rows<{
    detail: { before: { role: string }; after: { role: string } };
  }>("SELECT detail FROM audit_logs WHERE entity_id=? AND action='user.role'", [
    ids[4],
  ]);
  assert.equal(audit.detail.before.role, "user");
  assert.equal(audit.detail.after.role, "admin");
  assert.equal(
    (await rows("SELECT id FROM realtime_outbox WHERE user_id=?", [ids[4]]))
      .length,
    2,
  ); // Own access event and admin refresh.
  assert.equal(
    (await updateAccountAccess(actors[0], ids[4], { role: "admin" })).changed,
    false,
  );
  await updateAccountAccess(actors[0], ids[4], { role: "user" });
  await updateAccountAccess(actors[0], ids[4], { active: false });
  assert.equal(Number((await state(ids[4])).active), 0);
  await updateAccountAccess(actors[0], ids[4], { active: true });

  await exec(
    "INSERT INTO chefs (id,user_id,name,bio,address,area,lat,lng,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [
      chefId,
      ids[4],
      "Access fixture",
      "Fixture",
      "Fixture",
      "Fixture",
      10,
      106,
      "pending",
      sqlDate(),
    ],
  );
  await assert.rejects(
    () => updateAccountAccess(actors[0], ids[4], { role: "chef" }),
    /hồ sơ bếp đã duyệt/,
  );
  await exec("UPDATE chefs SET status='approved' WHERE id=?", [chefId]);
  await updateAccountAccess(actors[0], ids[4], { role: "chef" });
  assert.equal((await state(ids[4])).role, "chef");
  await exec("INSERT INTO kitchen_sessions VALUES (?,?,?,?,?)", [
    kitchen,
    chefId,
    "2026-10-05",
    true,
    sqlDate(),
  ]);
  await exec(
    "INSERT INTO orders (id,code,user_id,chef_id,meal_id,status,subtotal,delivery_fee,total,recipient,phone,address,lat,lng,chef_lat,chef_lng,distance_km,bank_bin,bank_name,account_no,account_name,transfer_content,idempotency_key,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      orderId,
      orderId.slice(0, 20),
      ids[3],
      chefId,
      "lunch",
      "DELIVERED",
      45000,
      0,
      45000,
      "Fixture",
      "",
      "Fixture",
      10,
      106,
      10,
      106,
      0,
      "970423",
      "Fixture",
      "0",
      "Fixture",
      orderId.slice(0, 25),
      orderId,
      sqlDate(),
      sqlDate(),
      sqlDate(),
    ],
  );
  await assert.rejects(
    () => updateAccountAccess(actors[0], ids[4], { role: "user" }),
    /còn đơn/,
  );
  assert.equal((await state(ids[4])).role, "chef");
  await exec("UPDATE orders SET status='COMPLETED' WHERE id=?", [orderId]);
  const requestId = randomUUID();
  await exec("INSERT INTO payment_exceptions VALUES (?,?,?,?,?,?,?,?)", [
    requestId,
    orderId,
    ids[3],
    "REFUND",
    45000,
    "Fixture",
    "REVIEW",
    sqlDate(),
  ]);
  await assert.rejects(
    () => updateAccountAccess(actors[0], ids[4], { role: "user" }),
    /đối soát/,
  );
  await exec("UPDATE payment_exceptions SET status='RESOLVED' WHERE id=?", [
    requestId,
  ]);
  await updateAccountAccess(actors[0], ids[4], { role: "user" });
  assert.equal((await state(ids[4])).role, "user");
  assert.equal(
    (
      await rows<{ status: string }>("SELECT status FROM chefs WHERE id=?", [
        chefId,
      ])
    )[0].status,
    "suspended",
  );
  assert.equal(
    Number(
      (
        await rows<{ is_open: number }>(
          "SELECT is_open FROM kitchen_sessions WHERE id=?",
          [kitchen],
        )
      )[0].is_open,
    ),
    0,
  );

  // Cross-demotions serialize. The loser must revalidate their current role.
  const results = await Promise.allSettled([
    updateAccountAccess(actors[1], ids[2], { role: "user" }),
    updateAccountAccess(actors[2], ids[1], { role: "user" }),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const removed =
    (await state(ids[1])).role !== "admin" ? actors[1] : actors[2];
  await assert.rejects(
    () => updateAccountAccess(removed, ids[3], { role: "admin" }),
    { status: 403 },
  );
  console.log(
    "PASS account access: admin authorization, self protection, strict validation, approved chef requirement, session revocation, audit, realtime, open orders/refunds, kitchen closure, and concurrent demotions.",
  );
} finally {
  await exec("DELETE FROM payment_exceptions WHERE order_id=?", [orderId]);
  await exec("DELETE FROM orders WHERE id=?", [orderId]);
  await exec("DELETE FROM kitchen_sessions WHERE id=?", [kitchen]);
  await exec("DELETE FROM chefs WHERE id=?", [chefId]);
  await exec("DELETE FROM sessions WHERE user_id IN (?)", [ids]);
  await exec("DELETE FROM audit_logs WHERE actor_id IN (?)", [ids]);
  // Admin broadcasts also reach real local admins; remove only events referencing these fixtures.
  await exec(
    "DELETE FROM realtime_outbox WHERE user_id IN (?) OR JSON_UNQUOTE(JSON_EXTRACT(payload,'$.entityId')) IN (?)",
    [ids, ids],
  );
  await exec("DELETE FROM users WHERE id IN (?)", [ids]);
  await pool().end();
}
