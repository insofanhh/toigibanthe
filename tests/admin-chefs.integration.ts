import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  adminChefAnalytics,
  adminChefDetailReport,
  chefThresholdSchema,
  saveChefThresholds,
} from "../src/lib/admin-chefs";
import {
  chefFilter,
  chefState,
  type ChefRow,
} from "../src/lib/admin-chefs-domain";
import { exec, rows, pool, sqlDate } from "../src/lib/db";
import { serviceDate } from "../src/lib/domain";
import { shiftDate } from "../src/lib/analytics-domain";
import { ensurePaymentRequestSchema } from "../src/lib/payment-request-store";

assert.ok(
  ["localhost", "127.0.0.1"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  ),
  "Fixtures require local MySQL",
);
const suffix = "chefs-" + randomUUID(),
  today = serviceDate(),
  now = new Date(today + "T12:00:00+07:00");
const chefs = Array.from({ length: 110 }, () => randomUUID()),
  owners = chefs.map(() => randomUUID()),
  buyer = randomUUID();
const orders: string[] = [],
  products: string[] = [],
  sessions: string[] = [];
const at = (day: number, minutes = 0) =>
  sqlDate(new Date(now.getTime() + day * 86400000 + minutes * 60000));
const options = {
  from: shiftDate(today, -6),
  to: today,
  q: suffix,
  fresh: "1",
};
const report = (
  section: string,
  patch: Record<string, string> = {},
  time = now,
): Promise<any> =>
  adminChefAnalytics(
    section,
    new URLSearchParams({ ...options, ...patch }),
    time,
  );
const detail = (
  i: number,
  panel: string,
  patch: Record<string, string> = {},
): Promise<any> =>
  adminChefDetailReport(
    chefs[i],
    new URLSearchParams({ ...options, panel, ...patch }),
    now,
  );
async function audit(
  i: number,
  action: string,
  day: number,
  body: unknown = {},
) {
  await exec("INSERT INTO audit_logs VALUES (?,?,?,?,?,?)", [
    randomUUID(),
    owners[i],
    action,
    chefs[i],
    JSON.stringify(body),
    at(day),
  ]);
}
async function order(
  i: number,
  status: string,
  created: number,
  paid: number | null,
  finished: number | null = null,
  minutes: number | null = null,
  actor = owners[i],
  legacy = false,
) {
  const id = randomUUID();
  orders.push(id);
  await exec(
    `INSERT INTO orders (id,code,user_id,chef_id,meal_id,status,payment_status,subtotal,discount,delivery_fee,total,recipient,phone,address,lat,lng,chef_lat,chef_lng,distance_km,bank_bin,bank_name,account_no,account_name,transfer_content,idempotency_key,expires_at,payment_confirmed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      id.slice(0, 20),
      buyer,
      chefs[i],
      "lunch",
      status,
      paid === null ? "PENDING" : "PAID_AUTO",
      100000,
      10000,
      15000,
      105000,
      "Fixture",
      "0901234567",
      "Test",
      10,
      106,
      10,
      106,
      0,
      "970436",
      "Test",
      "0001234567",
      "TEST CHEF",
      id.slice(0, 20),
      id,
      at(1),
      paid === null ? null : at(paid),
      at(created),
      at(finished ?? 0),
    ],
  );
  await exec("INSERT INTO order_items VALUES (?,?,?,?,?,?,?,?)", [
    randomUUID(),
    id,
    randomUUID(),
    products[0] || randomUUID(),
    "Cơm kiểm tra",
    "/icon.svg",
    50000,
    2,
  ]);
  const event = async (s: string, day: number, min = 0, who = actor) =>
    exec("INSERT INTO order_events VALUES (?,?,?,?,?,?)", [
      randomUUID(),
      id,
      who,
      s,
      "Fixture",
      at(day, min),
    ]);
  if (paid !== null) await event("PAID", paid);
  if (minutes !== null && paid !== null) await event("ACCEPTED", paid, minutes);
  if (!legacy && finished !== null) await event("COMPLETED", finished);
  if (["REJECTED", "CANCELLED"].includes(status)) await event(status, created);
  return id;
}
async function menu(
  i: number,
  opts: {
    stock?: number;
    active?: boolean;
    enabled?: boolean;
    cutoff?: string;
    day?: string;
    meal?: string;
    open?: boolean;
  } = {},
) {
  const product = randomUUID(),
    session = randomUUID();
  products.push(product);
  sessions.push(session);
  await exec(
    "INSERT INTO products (id,chef_id,name,description,price,image_url,active,created_at) VALUES (?,?,?,?,?,?,?,?)",
    [
      product,
      chefs[i],
      "Món " + i,
      "Test",
      50000,
      "/icon.svg",
      opts.active ?? true,
      at(-1),
    ],
  );
  await exec("INSERT INTO kitchen_sessions VALUES (?,?,?,?,?)", [
    session,
    chefs[i],
    opts.day || today,
    opts.open ?? true,
    at(0),
  ]);
  await exec("INSERT INTO daily_menu VALUES (?,?,?,?,?,?,?,?,?)", [
    randomUUID(),
    session,
    product,
    opts.meal || "lunch",
    opts.cutoff || at(0, 60),
    opts.stock ?? 5,
    null,
    null,
    opts.enabled ?? true,
  ]);
}
try {
  await ensurePaymentRequestSchema();
  await exec(
    "INSERT INTO users (id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)",
    [
      buyer,
      suffix + " buyer",
      suffix + "@local.test",
      "invalid-fixture",
      "user",
      at(-50),
    ],
  );
  for (let i = 0; i < chefs.length; i++) {
    const status =
      i === 101
        ? "rejected"
        : i === 102
          ? "needs_changes"
          : i === 103
            ? "suspended"
            : i >= 100
              ? "pending"
              : "approved";
    await exec(
      "INSERT INTO users (id,name,email,password_hash,role,active,created_at) VALUES (?,?,?,?,?,?,?)",
      [
        owners[i],
        suffix + " " + i,
        i + "-" + suffix + "@local.test",
        "invalid-fixture",
        "chef",
        i === 5 ? 0 : 1,
        at(-50),
      ],
    );
    await exec(
      "INSERT INTO chefs (id,user_id,name,bio,address,area,lat,lng,status,bank_bin,bank_name,account_no,account_name,rating,rating_count,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        chefs[i],
        owners[i],
        suffix + " " + i,
        "Test",
        "Test",
        "Local",
        i === 99 ? 0 : 10,
        i === 99 ? 0 : 106,
        status,
        "970436",
        "Test",
        i === 6 ? "bad" : "0001234567",
        "TEST CHEF",
        i === 0 ? 3 : 0,
        i === 0 ? 5 : 0,
        at(-50),
      ],
    );
  }
  await audit(0, "chef.status", -40, { status: "approved" });
  await audit(0, "chef.status", -2, { status: "approved" }); // Reapproval does not reset first approval.
  await audit(1, "chef.status", -9, { status: "approved" });
  await audit(2, "chef.status", -1, { status: "approved" });
  await audit(4, "chef.status", -8, { status: "approved" });
  await audit(100, "chef.application", 0, { resubmitted: true }); // A resubmission is not stale despite old creation date.
  await menu(0);
  await menu(5);
  await menu(6);
  await menu(7, { stock: 0 });
  await menu(8, { active: false });
  await menu(9, { enabled: false });
  await menu(10, { cutoff: at(0, -1) });
  const emptySession = randomUUID();
  sessions.push(emptySession);
  await exec("INSERT INTO kitchen_sessions VALUES (?,?,?,?,?)", [
    emptySession,
    chefs[11],
    today,
    true,
    at(0),
  ]);
  await menu(12, {
    day: shiftDate(today, -1),
    meal: "late",
    cutoff: sqlDate(new Date(today + "T02:00:00+07:00")),
  });
  await order(0, "COMPLETED", -40, -39, -20, 5);
  await order(1, "COMPLETED", -30, -1, -1, 5); // Created outside period; paid and completed inside.
  await order(4, "COMPLETED", -50, -49, -48, 5); // Paid before first recorded approval: unknown activation.
  const completed = await order(0, "COMPLETED", -2, -2, -1, 2);
  const completed2 = await order(0, "COMPLETED", -2, -2, -1, 6);
  await order(0, "COMPLETED", -2, -2, -1, 10);
  await order(0, "COMPLETED", -2, -2, -1, null, owners[0], true);
  await order(0, "REJECTED", -2, -2, null, null);
  await order(0, "CANCELLED", -2, -2, null, null, buyer);
  await order(0, "REJECTED", -2, -2, null, null, owners[1]);
  const late = await order(0, "PAID", -20, -20);
  const reviewOrder = await order(0, "CANCELLED", -20, -20, null, null, buyer);
  for (const [id, rating] of [
    [completed, 5],
    [completed2, 1],
  ] as const)
    await exec("INSERT INTO reviews VALUES (?,?,?,?,?,?,?)", [
      randomUUID(),
      id,
      buyer,
      chefs[0],
      rating,
      "Review fixture",
      at(-1),
    ]);
  const request = randomUUID(),
    review = randomUUID();
  for (const [id, oid, status] of [
    [request, late, "OPEN"],
    [review, reviewOrder, "REVIEW"],
  ]) {
    await exec("INSERT INTO payment_exceptions VALUES (?,?,?,?,?,?,?,?)", [
      id,
      oid,
      buyer,
      "REFUND",
      105000,
      "Test",
      status,
      at(-20),
    ]);
    await exec(
      "INSERT INTO payment_request_details (exception_id,order_id,contact_phone,submitted_at,reviewed_at) VALUES (?,?,?,?,?)",
      [
        id,
        oid,
        "0901234567",
        id === review ? at(0, -5) : null,
        id === request ? at(0, -5) : null,
      ],
    );
  }
  await exec("INSERT INTO payment_exceptions VALUES (?,?,?,?,?,?,?,?)", [
    randomUUID(),
    late,
    buyer,
    "REFUND",
    105000,
    "Duplicate legacy",
    "OPEN",
    at(-19),
  ]);

  const summary = await report("summary"),
    list = await report("list");
  assert.equal(summary.metrics.total, 110);
  assert.equal(list.total, 110);
  assert.equal(list.pages, 6);
  assert.equal(list.chefs.length, 20);
  assert.equal(summary.metrics.pending, 7);
  assert.equal(summary.metrics.approved, 100);
  assert.equal(summary.metrics.sales, 2);
  assert.equal(summary.metrics.ready, 1);
  const seen = new Set();
  for (let page = 1; page <= 6; page++)
    for (const c of (await report("list", { page: String(page) })).chefs) {
      assert.ok(!seen.has(c.id));
      seen.add(c.id);
      assert.ok(!("password_hash" in c));
    }
  assert.equal(seen.size, 110);
  assert.equal((await report("list", { page: "9999" })).page, 6);
  assert.equal((await report("list", { q: suffix + "%" })).total, 0);
  assert.equal((await report("list", { q: "' OR 1=1 --" })).total, 0);
  assert.equal((await report("list", { region: "unknown" })).total, 1);
  for (const [key, n] of Object.entries(summary.metrics)) {
    const patch: Record<string, string> =
      key === "total"
        ? {}
        : ["pending", "approved", "suspended"].includes(key)
          ? { status: key }
          : { group: key };
    assert.equal((await report("list", patch)).total, n, "KPI scope " + key);
  }
  const all = (await report("summary", { from: shiftDate(today, -60) }))
    .activation;
  assert.equal(all.eligible, 2);
  assert.equal(all.activated, 1);
  assert.equal(all.waiting, 1);
  assert.ok(all.unknown >= 1);
  const c = (await detail(0, "overview")).chef;
  assert.equal(c.completed, 4);
  assert.equal(c.gmv, 360000);
  assert.equal(c.delivery, 60000);
  assert.equal(c.accept_median, 6);
  assert.equal(c.accept_samples, 3);
  assert.equal(c.chef_rejected, 1);
  assert.equal(c.paid_outcomes, 4);
  assert.equal(c.refund_open, 1);
  assert.equal(c.refund_review, 1);
  assert.equal(c.refund_overdue, 0);
  assert.equal(c.oldest_refund_open_at, at(0, -5));
  assert.equal(c.oldest_refund_review_at, at(0, -5));
  assert.equal(c.late_orders, 1);
  assert.equal(c.approved_at, at(-40));
  assert.equal((await detail(0, "overview")).legacyCompletions, 1);
  const ready = new Set(
    (await report("list", { group: "ready" })).chefs.map((c: any) => c.id),
  );
  assert.deepEqual(ready, new Set([chefs[0]]));
  assert.equal(
    (await detail(11, "overview")).chef.operation,
    "Đã bật · Chưa có món hợp lệ",
  );
  assert.equal(
    (await detail(5, "overview")).chef.operation,
    "Tài khoản chủ bị khóa",
  );
  assert.equal(
    (await detail(6, "overview")).chef.operation,
    "Chưa cấu hình ngân hàng",
  );
  const midnight = new Date(today + "T00:30:00+07:00");
  const night = (
    await report("list", { meal: "late", group: "ready" }, midnight)
  ).chefs;
  assert.ok(
    night.some((c: any) => c.id === chefs[12]),
    "Previous service date late meal remains orderable",
  );
  assert.ok(
    !(await detail(100, "overview")).chef.alerts.some(
      (a: any) => a.key === "profile",
    ),
  );
  assert.ok(
    (await detail(104, "overview")).chef.alerts.some(
      (a: any) => a.key === "profile",
    ),
  );
  assert.ok(c.alerts.some((a: any) => a.key === "rating"));
  const trend = await report("trends", { from: shiftDate(today, -60) });
  assert.equal(
    trend.days.reduce((n: number, d: any) => n + d.submitted, 0),
    110,
  );
  assert.equal(
    trend.days.reduce((n: number, d: any) => n + d.approved, 0),
    4,
  );
  assert.equal(
    trend.days.reduce((n: number, d: any) => n + d.resubmitted, 0),
    1,
  );
  assert.equal(trend.topOrders[0].id, chefs[0]);
  const active = await detail(0, "orders", { focus: "active" });
  assert.equal(active.total, 1);
  assert.equal(active.items[0].id, late);
  const orderList = await detail(0, "orders");
  assert.ok(orderList.items.some((o: any) => o.user_cancelled));
  assert.ok(orderList.items.some((o: any) => o.other_cancelled));
  const customers = await detail(0, "customers", { reviewSort: "highest" });
  assert.equal(customers.items[0].rating, 5);
  assert.equal(Number(customers.buyers.returning_buyers), 1);
  assert.match(customers.items[0].dishes, /Cơm kiểm tra/);
  assert.equal(
    (await detail(0, "customers", { reviewSort: "lowest" })).items[0].rating,
    1,
  );
  assert.equal((await detail(0, "payments")).total, 2);
  assert.equal(
    (await detail(0, "payments", { payment: "REVIEW" })).items[0].id,
    review,
  );
  assert.equal(
    (await detail(0, "menu", { kind: "products" })).items[0].id,
    products[0],
  );
  const profile = await detail(0, "profile");
  assert.equal(profile.history.length, 2);
  assert.ok(!("key_hash" in profile.sepay));
  for (let i = 0; i < 22; i++) {
    const id = randomUUID();
    products.push(id);
    await exec(
      "INSERT INTO products (id,chef_id,name,description,price,image_url,created_at) VALUES (?,?,?,?,?,?,?)",
      [id, chefs[0], "Fixture " + i, "Test", 10000, "/icon.svg", at(0)],
    );
  }
  assert.equal(
    (await detail(0, "menu", { kind: "products", page: "2" })).items.length,
    3,
  );
  await exec(
    "UPDATE order_events SET created_at=? WHERE order_id=? AND status='ACCEPTED'",
    [at(-2, 4), completed],
  );
  assert.equal((await detail(0, "overview")).chef.accept_median, 6);
  const extra = await order(0, "COMPLETED", -2, -2, -1, 8); // Even median of 4,6,8,10.
  assert.equal((await detail(0, "overview")).chef.accept_median, 7);
  await exec(
    "UPDATE payment_request_details SET submitted_at=? WHERE exception_id=?",
    [at(-3), review],
  );
  assert.equal((await detail(0, "overview")).chef.refund_overdue, 1);
  const state = chefState(
    { ...c, rating_count: 4, paid_outcomes: 30, chef_rejected: 4 } as ChefRow,
    now,
    true,
    summary.sla,
    summary.thresholds,
  );
  assert.ok(!state.alerts.some((a) => a.key === "rating"));
  assert.ok(state.alerts.some((a) => a.key === "rejection"));
  for (const patch of [
    { page: "0" },
    { status: "toString" },
    { group: "__proto__" },
    { sort: "constructor" },
    { from: "2026-02-30" },
    { view: "bad" },
  ] as Record<string, string>[])
    await assert.rejects(() => report("list", patch));
  for (const [panel, patch] of [
    ["menu", { kind: "bad" }],
    ["customers", { reviewSort: "bad" }],
    ["payments", { payment: "bad" }],
    ["orders", { focus: "bad" }],
  ] as [string, Record<string, string>][])
    await assert.rejects(() => detail(0, panel, patch));
  assert.throws(() =>
    chefFilter(new URLSearchParams({ q: "x".repeat(101) }), now),
  );
  assert.equal(chefThresholdSchema.safeParse({ minReviews: 0 }).success, false);
  await assert.rejects(() =>
    saveChefThresholds({ id: buyer, role: "user", name: "Test" } as any, {}),
  );
  console.log(
    "PASS Chefs analytics: 110 profiles, full counts/stable paging, literal search, readiness/cutoff/overnight, resubmission age, approval cohort, completion period/GMV/delivery, odd/even acceptance median, actor attribution, duplicate refunds/stage age, review samples/sorting, six details, validation/private fields.",
  );
} finally {
  for (const id of orders) {
    for (const table of [
      "reviews",
      "payment_request_details",
      "payment_exceptions",
      "order_items",
      "order_events",
    ])
      await exec(`DELETE FROM ${table} WHERE order_id=?`, [id]);
    await exec("DELETE FROM orders WHERE id=?", [id]);
  }
  for (const id of sessions) {
    await exec("DELETE FROM daily_menu WHERE session_id=?", [id]);
    await exec("DELETE FROM kitchen_sessions WHERE id=?", [id]);
  }
  for (const id of products)
    await exec("DELETE FROM products WHERE id=?", [id]);
  for (const id of chefs) {
    await exec("DELETE FROM audit_logs WHERE entity_id=?", [id]);
    await exec("DELETE FROM chefs WHERE id=?", [id]);
  }
  for (const id of [...owners, buyer])
    await exec("DELETE FROM users WHERE id=?", [id]);
  await pool().end();
}
