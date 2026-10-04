import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import {
  adminAnalytics,
  mutateAnalytics,
  recordAnalyticsEvent,
} from "../src/lib/analytics";
import { ensureAnalyticsSchema } from "../src/lib/analytics-schema";
import { exec, rows, pool, sqlDate } from "../src/lib/db";
import { serviceDate, type Actor } from "../src/lib/domain";
import { shiftDate, regionCell } from "../src/lib/analytics-domain";
const dbURL = new URL(process.env.DATABASE_URL!);
assert.ok(
  ["127.0.0.1", "localhost"].includes(dbURL.hostname),
  "Integration fixtures only allowed on local database",
);
const ids = {
  chef: randomUUID(),
  owner: randomUUID(),
  admin: randomUUID(),
  a: randomUUID(),
  b: randomUUID(),
  c: randomUUID(),
  product: randomUUID(),
  voucher: randomUUID(),
  session: randomUUID(),
};
const orderIds: string[] = [],
  events: string[] = [],
  today = serviceDate(),
  lat = 19.14,
  lng = 103.12,
  region = regionCell(lat, lng),
  suffix = randomBytes(4).toString("hex");
const actor: Actor = {
  id: ids.admin,
  name: "Analytics test",
  email: "analytics@test",
  role: "admin",
  active: 1,
  phone: "",
};
const opts = new URLSearchParams({
  from: shiftDate(today, -59),
  to: today,
  region,
  meal: "lunch",
  fresh: "1",
});
const at = (day: number, hour = 12, minute = 1) =>
  sqlDate(
    new Date(
      `${shiftDate(today, day)}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+07:00`,
    ),
  );
async function order(
  user: string,
  status: string,
  day: number,
  subtotal = 100000,
  discount = 0,
  finishedDay = day,
  meal = "lunch",
  orderLat = lat,
) {
  const id = randomUUID(),
    code = randomBytes(6).toString("hex");
  orderIds.push(id);
  await exec(
    "INSERT INTO orders (id,code,user_id,chef_id,meal_id,status,payment_status,subtotal,discount,delivery_fee,total,recipient,phone,address,lat,lng,chef_lat,chef_lng,distance_km,bank_bin,bank_name,account_no,account_name,transfer_content,idempotency_key,expires_at,created_at,updated_at,payment_confirmed_at,voucher_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      id,
      code,
      user,
      ids.chef,
      meal,
      status,
      status === "COMPLETED" ? "PAID_AUTO" : "PENDING",
      subtotal,
      discount,
      10000,
      subtotal - discount + 10000,
      "Test",
      "0901234567",
      "Analytics local fixture",
      orderLat,
      lng,
      lat,
      lng,
      1,
      "970436",
      "Test",
      "0000000000",
      "LOCAL TEST",
      code,
      randomUUID(),
      at(day, 13),
      at(day),
      sqlDate(),
      status === "COMPLETED" ? at(day, 12, 2) : null,
      discount ? ids.voucher : null,
    ],
  );
  await exec("INSERT INTO order_items VALUES (?,?,?,?,?,?,?,?)", [
    randomUUID(),
    id,
    randomUUID(),
    ids.product,
    "Analytics dish",
    "/icon.svg",
    subtotal / 2,
    2,
  ]);
  await exec("INSERT INTO order_events VALUES (?,?,?,?,?,?)", [
    randomUUID(),
    id,
    ids.owner,
    status,
    "Fixture",
    at(status === "COMPLETED" ? finishedDay : day, 13),
  ]);
  return id;
}
async function event(
  name: string,
  day: number,
  hour: number,
  minute: number,
  result?: number,
) {
  const id = randomUUID();
  events.push(id);
  await exec(
    "INSERT INTO analytics_events (id,session_id,user_id,event_name,product_id,meal_id,region,result_count,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    [
      id,
      ids.session,
      ids.b,
      name,
      name === "dish_view" || name === "cart_add" ? ids.product : null,
      "lunch",
      region,
      result ?? null,
      at(day, hour, minute),
    ],
  );
}
try {
  await ensureAnalyticsSchema();
  const [existing] = await rows<{ count: number }>(
    "SELECT COUNT(*) count FROM orders WHERE CONCAT(ROUND(lat*50),':',ROUND(lng*50))=?",
    [region],
  );
  assert.equal(
    Number(existing.count),
    0,
    "Fixture region must have no existing orders",
  );
  for (const key of ["owner", "admin", "a", "b", "c"] as const)
    await exec(
      "INSERT INTO users (id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)",
      [
        ids[key],
        "Analytics " + key,
        `analytics-${key}-${suffix}@local.test`,
        "invalid-fixture-hash",
        key === "admin" ? "admin" : key === "owner" ? "chef" : "user",
        sqlDate(),
      ],
    );
  await exec(
    "INSERT INTO chefs (id,user_id,name,bio,address,area,lat,lng,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [
      ids.chef,
      ids.owner,
      "Analytics kitchen " + suffix,
      "Fixture",
      "Local test only",
      "Analytics region",
      lat,
      lng,
      "approved",
      sqlDate(),
    ],
  );
  await exec(
    "INSERT INTO products (id,chef_id,name,description,price,image_url,created_at) VALUES (?,?,?,?,?,?,?)",
    [
      ids.product,
      ids.chef,
      "Analytics dish",
      "Fixture",
      50000,
      "/icon.svg",
      sqlDate(),
    ],
  );
  await exec("INSERT INTO vouchers VALUES (?,?,?,?,?,?,?,?,?,?)", [
    ids.voucher,
    "ANA" + suffix,
    "Fixture",
    ids.chef,
    10000,
    0,
    100,
    0,
    sqlDate(),
    true,
  ]);
  await order(ids.a, "COMPLETED", -46, 100000, 10000, -40);
  const repeatOrder = await order(ids.a, "COMPLETED", -26, 60000, 0, -25);
  const linked = await order(ids.b, "COMPLETED", -1, 50000, 5000, -1);
  await order(ids.c, "COMPLETED", -70, 40000, 0, -1);
  for (let i = 0; i < 110; i++) await order(ids.b, "CANCELLED", -2);
  const late = await order(ids.b, "PAID", -1);
  await exec("UPDATE orders SET payment_confirmed_at=? WHERE id=?", [
    at(-1),
    late,
  ]);
  await order(ids.b, "COMPLETED", -1, 900000, 0, -1, "breakfast");
  await order(ids.b, "COMPLETED", -1, 900000, 0, -1, "lunch", 20.14);
  await exec("INSERT INTO analytics_order_context VALUES (?,?,?,?,?,?,?,?)", [
    linked,
    ids.session,
    "facebook",
    null,
    null,
    0,
    "chef",
    at(-1),
  ]);
  await event("catalog", -1, 11, 50, 0);
  await event("dish_view", -1, 11, 51);
  await event("cart_add", -1, 11, 52);
  await event("catalog", -1, 11, 55, 3);
  await event("dish_view", -1, 11, 56);
  await event("cart_add", -1, 11, 57);
  await event("checkout", -1, 11, 58);
  const directSession = randomUUID();
  await exec("INSERT INTO analytics_order_context VALUES (?,?,?,?,?,?,?,?)", [
    repeatOrder,
    directSession,
    "",
    null,
    null,
    0,
    "chef",
    at(-26),
  ]);
  for (const [eventName, minute] of [
    ["catalog", 55],
    ["cart_add", 57],
    ["checkout", 58],
  ] as const) {
    const id = randomUUID();
    events.push(id);
    await exec(
      "INSERT INTO analytics_events (id,session_id,user_id,event_name,product_id,meal_id,region,result_count,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [
        id,
        directSession,
        ids.a,
        eventName,
        eventName === "cart_add" ? ids.product : null,
        "lunch",
        region,
        eventName === "catalog" ? 2 : null,
        at(-26, 11, minute),
      ],
    );
  }
  const summary: any = await adminAnalytics("summary", opts);
  assert.equal(summary.current.placed, 114);
  assert.equal(summary.current.completed, 4);
  assert.equal(summary.current.gmv, 235000);
  assert.equal(summary.current.delivery, 40000);
  assert.equal(summary.current.buyers, 3);
  assert.equal(summary.current.new_buyers, 3);
  assert.equal(summary.current.repeatEligible, 1);
  assert.equal(summary.current.repeat30, 100);
  assert.equal(summary.current.cancelled, 110);
  assert.equal(summary.current.unresolved, 1);
  const trends: any = await adminAnalytics("trends", opts);
  assert.equal(
    trends.completed.reduce((n: number, r: any) => n + Number(r.gmv), 0),
    235000,
  );
  const perf: any = await adminAnalytics("performance", opts);
  assert.equal(Number(perf.products[0].servings), 8);
  assert.equal(Number(perf.products[0].gmv), 235000);
  assert.equal(Number(perf.chefs[0].completed), 4);
  const growth: any = await adminAnalytics("growth", opts);
  assert.equal(Number(growth.funnel.ordered), 2);
  assert.equal(Number(growth.funnel.completed), 2);
  assert.equal(Number(growth.funnel.viewed), 1);
  assert.equal(Number(growth.funnel.cart), 2);
  assert.equal(Number(growth.demand[0].sessions), 2);
  assert.equal(Number(growth.demand[0].empty_sessions), 1);
  assert.equal(
    Number(
      growth.vouchers.reduce((n: number, r: any) => n + Number(r.discount), 0),
    ),
    15000,
  );
  const ops: any = await adminAnalytics("operations", opts);
  assert.ok(ops.late.some((r: any) => r.id === late));
  await mutateAnalytics(actor, "goals", {
    title: "Analytics fixture goal",
    metric: "completed",
    baseline: 0,
    target: 10,
    from: opts.get("from"),
    to: today,
    region,
    meal: "lunch",
  });
  const goals: any = await adminAnalytics("goals", opts);
  assert.equal(
    goals.goals.find((r: any) => r.created_by === ids.admin).current,
    4,
  );
  await mutateAnalytics(actor, "costs", {
    title: "Analytics fixture cost",
    kind: "marketing",
    amount: 15000,
    spentOn: today,
    source: "facebook",
    region,
    meal: "lunch",
  });
  const withCost: any = await adminAnalytics("growth", opts);
  assert.equal(
    withCost.costs.filter((r: any) => r.created_by === ids.admin).length,
    1,
  );
  await assert.rejects(() =>
    mutateAnalytics(actor, "goals", {
      title: "Invalid",
      metric: "cancelRate",
      baseline: 5,
      target: 10,
      from: today,
      to: today,
      region,
      meal: "lunch",
    }),
  );
  const telemetry = {
    id: randomUUID(),
    sessionId: ids.session,
    event: "catalog",
    lat,
    lng,
    meal: "lunch",
    resultCount: 3,
  };
  events.push(telemetry.id);
  await recordAnalyticsEvent(telemetry, null);
  await recordAnalyticsEvent(telemetry, null);
  const [once] = await rows<{ count: number }>(
    "SELECT COUNT(*) count FROM analytics_events WHERE id=?",
    [telemetry.id],
  );
  assert.equal(Number(once.count), 1);
  await assert.rejects(() => adminAnalytics("toString", opts));
  console.log(
    "PASS analytics: >100 orders, Vietnam dates, independent creation/completion periods, geographic/meal filters, GMV without delivery, voucher allocation, mature 30-day retention, ordered-session funnel retries, alerts, goals/costs validation and idempotent tracking.",
  );
} finally {
  for (const id of orderIds) {
    for (const table of [
      "order_items",
      "order_events",
      "analytics_order_context",
      "analytics_events",
    ])
      await exec(`DELETE FROM ${table} WHERE order_id=?`, [id]);
    await exec("DELETE FROM orders WHERE id=?", [id]);
  }
  await exec("DELETE FROM analytics_events WHERE session_id=?", [ids.session]);
  for (const id of events)
    await exec("DELETE FROM analytics_events WHERE id=?", [id]);
  for (const table of ["admin_goals", "growth_costs"])
    await exec(`DELETE FROM ${table} WHERE created_by=?`, [ids.admin]);
  await exec("DELETE FROM audit_logs WHERE actor_id=?", [ids.admin]);
  await exec("DELETE FROM vouchers WHERE id=?", [ids.voucher]);
  await exec("DELETE FROM products WHERE id=?", [ids.product]);
  await exec("DELETE FROM chefs WHERE id=?", [ids.chef]);
  for (const key of ["owner", "admin", "a", "b", "c"] as const)
    await exec("DELETE FROM users WHERE id=?", [ids[key]]);
  await pool().end();
}
