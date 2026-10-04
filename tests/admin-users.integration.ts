import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  adminUsersReport,
  adminUsersList,
  adminUserDetail,
} from "../src/lib/admin-users";
import { exec, rows, pool, sqlDate } from "../src/lib/db";
import { serviceDate } from "../src/lib/domain";
import { shiftDate } from "../src/lib/analytics-domain";
import { ensurePaymentRequestSchema } from "../src/lib/payment-request-store";

assert.ok(
  ["localhost", "127.0.0.1"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  ),
  "Fixtures are only allowed on local MySQL",
);
const suffix = "users-" + randomUUID(),
  today = serviceDate(),
  ids = Array.from({ length: 110 }, () => randomUUID()),
  chef = randomUUID(),
  orders: string[] = [];
const at = (offset: number, hour = 12) =>
  sqlDate(
    new Date(
      shiftDate(today, offset) +
        `T${String(hour).padStart(2, "0")}:00:00+07:00`,
    ),
  );
const opts = new URLSearchParams({
  from: shiftDate(today, -6),
  to: today,
  q: suffix,
});
async function order(
  user: string,
  status: string,
  day: number,
  completedDay = day,
  legacy = false,
) {
  const id = randomUUID();
  orders.push(id);
  await exec(
    `INSERT INTO orders (id,code,user_id,chef_id,meal_id,status,payment_status,subtotal,discount,delivery_fee,total,recipient,phone,address,lat,lng,chef_lat,chef_lng,distance_km,bank_bin,bank_name,account_no,account_name,transfer_content,idempotency_key,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      id.slice(0, 20),
      user,
      chef,
      "lunch",
      status,
      "PAID_AUTO",
      100000,
      10000,
      15000,
      105000,
      "Test",
      "0901234567",
      "Local fixture",
      10,
      106,
      10,
      106,
      1,
      "970436",
      "Test",
      "000",
      "Test",
      id.slice(0, 20),
      id,
      at(day, 13),
      at(day),
      at(legacy ? completedDay : 0),
    ],
  );
  await exec("INSERT INTO order_items VALUES (?,?,?,?,?,?,?,?)", [
    randomUUID(),
    id,
    randomUUID(),
    randomUUID(),
    "Fixture meal",
    "/icon.svg",
    50000,
    2,
  ]);
  if (!legacy)
    await exec("INSERT INTO order_events VALUES (?,?,?,?,?,?)", [
      randomUUID(),
      id,
      ids[0],
      status,
      "Users fixture",
      at(completedDay),
    ]);
  return id;
}
try {
  for (let i = 0; i < ids.length; i++)
    await exec(
      "INSERT INTO users (id,name,email,password_hash,role,active,created_at) VALUES (?,?,?,?,?,?,?)",
      [
        ids[i],
        suffix + " " + i,
        `${i}-${suffix}@local.test`,
        "invalid-fixture",
        i === 0 ? "chef" : i === 1 ? "admin" : "user",
        i === 4 ? 0 : 1,
        at(i === 2 ? -20 : -1),
      ],
    );
  await exec(
    "INSERT INTO chefs (id,user_id,name,bio,address,area,lat,lng,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [
      chef,
      ids[0],
      suffix,
      "Fixture",
      "Fixture",
      "Test",
      10,
      106,
      "approved",
      sqlDate(),
    ],
  );
  await order(ids[2], "COMPLETED", -30, -20);
  await order(ids[2], "COMPLETED", -1, -1);
  await order(ids[2], "COMPLETED", -1, -1); // Same completion time: deterministic tie ordering.
  await order(ids[3], "COMPLETED", -25, -2); // Created outside, completed within period.
  await order(ids[4], "COMPLETED", -3, -3, true); // Legacy fallback.
  await order(ids[5], "CANCELLED", -2);
  await order(ids[6], "COMPLETED", -1, -1);
  await order(ids[6], "COMPLETED", -1, -1);
  const report = await adminUsersReport(opts);
  assert.deepEqual(report.metrics, {
    total: 110,
    registered: 109,
    buyers: 4,
    first: 3,
    returning: 2,
    locked: 1,
  });
  assert.deepEqual(report.groups, { never: 106, once: 2, repeat: 2 });
  assert.equal(report.days.length, 7);
  assert.equal(
    report.days.reduce((n, d) => n + d.registered, 0),
    109,
  );
  assert.equal(
    report.days.reduce((n, d) => n + d.first, 0),
    3,
  );
  const list = await adminUsersList(opts);
  assert.equal(list.total, 110);
  assert.equal(list.users.length, 20);
  assert.equal(list.pages, 6);
  const allIds = new Set<string>();
  for (let page = 1; page <= 6; page++) {
    const data = await adminUsersList(
      new URLSearchParams({ ...Object.fromEntries(opts), page: String(page) }),
    );
    for (const u of data.users) {
      assert.ok(!allIds.has(u.id));
      allIds.add(u.id);
      assert.ok(!("password_hash" in u));
    }
  }
  assert.equal(allIds.size, 110);
  const clamped = await adminUsersList(
    new URLSearchParams({ ...Object.fromEntries(opts), page: "9999" }),
  );
  assert.equal(clamped.page, 6);
  for (const [segment, n] of Object.entries({
    registered: 109,
    buyers: 4,
    first: 3,
    returning: 2,
  }))
    assert.equal(
      (
        await adminUsersList(
          new URLSearchParams({ ...Object.fromEntries(opts), segment }),
        )
      ).total,
      n,
    );
  for (const [group, n] of Object.entries(report.groups))
    assert.equal(
      (
        await adminUsersList(
          new URLSearchParams({ ...Object.fromEntries(opts), group }),
        )
      ).total,
      n,
    );
  assert.equal(
    (
      await adminUsersReport(
        new URLSearchParams({ ...Object.fromEntries(opts), role: "user" }),
      )
    ).metrics.total,
    108,
  );
  assert.equal(
    (
      await adminUsersList(
        new URLSearchParams({ ...Object.fromEntries(opts), status: "locked" }),
      )
    ).users[0].id,
    ids[4],
  );
  const spend = await adminUsersList(
    new URLSearchParams({ ...Object.fromEntries(opts), sort: "spend" }),
  );
  assert.equal(spend.users[0].id, ids[2]);
  assert.equal(spend.users[0].food_value, 270000);
  await ensurePaymentRequestSchema();
  const cancelled = orders[5],
    request = randomUUID();
  await exec("INSERT INTO payment_exceptions VALUES (?,?,?,?,?,?,?,?)", [
    request,
    cancelled,
    ids[5],
    "REFUND",
    105000,
    "Test",
    "OPEN",
    at(-2),
  ]);
  await exec(
    "INSERT INTO payment_request_details (exception_id,order_id,contact_phone) VALUES (?,?,?)",
    [request, cancelled, "0901234567"],
  );
  const detail = await adminUserDetail(ids[5], opts);
  assert.equal(detail.orders.length, 1);
  assert.match(String(detail.orders[0].summary), /2 × Fixture meal/);
  assert.equal(detail.counts[0].status, "CANCELLED");
  assert.equal(detail.requests[0].id, request);
  const purchases = await adminUserDetail(ids[2], opts);
  assert.equal(purchases.user.completed_orders, 3);
  assert.equal(purchases.user.food_value, 270000);
  for (const params of [
    { from: "2026-02-30" },
    { sort: "toString" },
    { group: "__proto__" },
    { segment: "buyers OR 1=1" },
    { status: "invalid" },
    { page: "0" },
    { page: "1.5" },
  ] as Record<string, string>[])
    await assert.rejects(() =>
      adminUsersList(
        new URLSearchParams({ ...Object.fromEntries(opts), ...params }),
      ),
    );
  const literal = await adminUsersList(
    new URLSearchParams({ q: suffix + "%" }),
  );
  assert.equal(literal.total, 0);
  const injection = await adminUsersList(
    new URLSearchParams({ q: "' OR 1=1 --" }),
  );
  assert.equal(injection.total, 0);
  await assert.rejects(() => adminUserDetail(randomUUID(), opts));
  await exec("UPDATE users SET active=1 WHERE id=?", [ids[4]]);
  assert.equal((await adminUsersReport(opts)).metrics.locked, 0);
  console.log(
    "PASS Users analytics: >100 accounts, full aggregates, paginated stable sorting, Vietnam dates, first/repeat purchase ties, completion period and legacy fallback, role/status/group filters, lifetime spend excluding delivery, profile/history/refunds, validation and literal search.",
  );
} finally {
  for (const id of orders) {
    await exec("DELETE d FROM payment_request_details d WHERE d.order_id=?", [
      id,
    ]);
    await exec("DELETE FROM payment_exceptions WHERE order_id=?", [id]);
    await exec("DELETE FROM order_items WHERE order_id=?", [id]);
    await exec("DELETE FROM order_events WHERE order_id=?", [id]);
    await exec("DELETE FROM orders WHERE id=?", [id]);
  }
  await exec("DELETE FROM chefs WHERE id=?", [chef]);
  for (const id of ids) await exec("DELETE FROM users WHERE id=?", [id]);
  await pool().end();
}
