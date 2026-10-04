import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  adminProductAnalytics,
  adminProductDetail,
  productThresholdSchema,
  saveProductThresholds,
  clearProductReports,
} from "../src/lib/admin-products";
import { productFilter, productAlerts } from "../src/lib/admin-products-domain";
import { exec, rows, pool, sqlDate } from "../src/lib/db";
import { serviceDate } from "../src/lib/domain";
import { shiftDate } from "../src/lib/analytics-domain";
import { ensureAnalyticsSchema } from "../src/lib/analytics-schema";
import { ensurePaymentRequestSchema } from "../src/lib/payment-request-store";
import { saveProduct } from "../src/lib/manage";

assert.ok(
  ["localhost", "127.0.0.1"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  ),
  "Fixtures require local MySQL",
);
const suffix = "products-" + randomUUID(),
  today = serviceDate(),
  now = new Date(today + "T12:00:00+07:00");
const chefs = Array.from({ length: 4 }, () => randomUUID()),
  owners = chefs.map(() => randomUUID()),
  buyer = randomUUID();
const products: string[] = Array.from({ length: 110 }, () => randomUUID()),
  orphan = randomUUID(),
  orders: string[] = [],
  sessions: string[] = [];
const at = (d: number, minutes = 0) =>
  sqlDate(new Date(now.getTime() + d * 86400000 + minutes * 60000));
const opts = { from: shiftDate(today, -13), to: today, q: suffix, fresh: "1" };
const report = (
  s: string,
  p: Record<string, string> = {},
  time = now,
): Promise<any> =>
  adminProductAnalytics(s, new URLSearchParams({ ...opts, ...p }), time);
const detail = (
  id: string,
  panel: string,
  p: Record<string, string> = {},
): Promise<any> =>
  adminProductDetail(id, new URLSearchParams({ ...opts, panel, ...p }), now);
const productChef = (i: number) =>
  i === 5 ? 1 : i === 6 ? 2 : i === 7 ? 3 : 0;
const originalThreshold = (
  await rows<any>(
    "SELECT value FROM platform_settings WHERE id='product_analytics_thresholds'",
  )
)[0];
let changedThreshold = false;
async function menu(
  i: number,
  day = 0,
  meal = "lunch",
  stock = 5,
  enabled = true,
  cutoff = at(day, 60),
) {
  const ci = productChef(i),
    date = shiftDate(today, day);
  let session = (
    await rows<{ id: string }>(
      "SELECT id FROM kitchen_sessions WHERE chef_id=? AND service_date=?",
      [chefs[ci], date],
    )
  )[0]?.id;
  if (!session) {
    session = randomUUID();
    sessions.push(session);
    await exec("INSERT INTO kitchen_sessions VALUES (?,?,?,?,?)", [
      session,
      chefs[ci],
      date,
      ci !== 1,
      at(day),
    ]);
  }
  await exec("INSERT INTO daily_menu VALUES (?,?,?,?,?,?,?,?,?)", [
    randomUUID(),
    session,
    products[i],
    meal,
    cutoff,
    stock,
    null,
    null,
    enabled,
  ]);
}
async function order(
  lines: [string, number, number][],
  completed: number,
  created = completed - 1,
  discount = 0,
  legacy = false,
  meal = "lunch",
) {
  const id = randomUUID();
  orders.push(id);
  const subtotal = lines.reduce((n, l) => n + l[1] * l[2], 0);
  await exec(
    `INSERT INTO orders (id,code,user_id,chef_id,meal_id,status,payment_status,subtotal,discount,delivery_fee,total,recipient,phone,address,lat,lng,chef_lat,chef_lng,distance_km,bank_bin,bank_name,account_no,account_name,transfer_content,idempotency_key,expires_at,payment_confirmed_at,created_at,updated_at) VALUES (?,?,?,?,?,'COMPLETED','PAID_AUTO',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      id.slice(0, 20),
      buyer,
      chefs[0],
      meal,
      subtotal,
      discount,
      15000,
      subtotal - discount + 15000,
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
      at(created),
      at(created),
      at(completed),
    ],
  );
  for (const [pid, price, qty] of lines)
    await exec("INSERT INTO order_items VALUES (?,?,?,?,?,?,?,?)", [
      randomUUID(),
      id,
      randomUUID(),
      pid,
      suffix + " snapshot",
      "/icon.svg",
      price,
      qty,
    ]);
  if (!legacy)
    await exec("INSERT INTO order_events VALUES (?,?,?,?,?,?)", [
      randomUUID(),
      id,
      owners[0],
      "COMPLETED",
      "Fixture",
      at(completed),
    ]);
  return id;
}
try {
  await ensureAnalyticsSchema();
  await ensurePaymentRequestSchema();
  for (const [i, id] of [...owners, buyer].entries())
    await exec(
      "INSERT INTO users (id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)",
      [
        id,
        suffix + " " + i,
        i + suffix + "@local.test",
        "invalid-fixture",
        i === 4 ? "user" : "chef",
        at(-50),
      ],
    );
  for (let i = 0; i < 4; i++)
    await exec(
      "INSERT INTO chefs (id,user_id,name,bio,address,area,lat,lng,status,bank_bin,bank_name,account_no,account_name,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        chefs[i],
        owners[i],
        suffix + " " + i,
        "Test",
        "Test",
        "Local",
        i === 3 ? 0 : 10,
        i === 3 ? 0 : 106,
        i === 2 ? "rejected" : "approved",
        "970436",
        "Test",
        i === 3 ? "bad" : "0001234567",
        "TEST CHEF",
        at(-50),
      ],
    );
  for (let i = 0; i < 110; i++)
    await exec(
      "INSERT INTO products (id,chef_id,name,description,ingredients,price,image_url,active,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [
        products[i],
        chefs[productChef(i)],
        i === 0 ? "12345" : "Cơm giống tên",
        "Mô tả đầy đủ",
        "Gạo",
        90000,
        i === 9 ? "" : "https://images.unsplash.com/fixture",
        i !== 2,
        at(i === 109 ? -20 : -1),
      ],
    );
  await menu(0);
  await menu(0, 0, "dinner", 3);
  await menu(1, 0, "lunch", 0);
  await menu(2);
  await menu(3, 0, "lunch", 5, false);
  await menu(4, 0, "lunch", 5, true, at(0, -1));
  await menu(5);
  await menu(6);
  await menu(7);
  await menu(8, -8);
  await menu(8, -7);
  await menu(8, -6);
  await menu(
    0,
    -1,
    "late",
    4,
    true,
    sqlDate(new Date(today + "T02:00:00+07:00")),
  );
  const old = await order([[products[0], 20000, 1]], -14);
  const a = await order(
    [
      [products[0], 33333, 1],
      [products[0], 33333, 1],
      [products[1], 33334, 1],
    ],
    -1,
    -20,
    1,
  );
  const b = await order([[products[0], 50000, 1]], 0, -2, 10000, true);
  await order([[orphan, 7000, 2]], -1);
  for (const [id, rating] of [
    [a, 5],
    [b, 1],
  ] as const)
    await exec("INSERT INTO reviews VALUES (?,?,?,?,?,?,?)", [
      randomUUID(),
      id,
      buyer,
      chefs[0],
      rating,
      "Review fixture",
      at(0),
    ]);
  for (const [oid, status, phase] of [
    [a, "OPEN", at(0, -5)],
    [b, "REVIEW", at(-3)],
  ] as const) {
    const id = randomUUID();
    await exec("INSERT INTO payment_exceptions VALUES (?,?,?,?,?,?,?,?)", [
      id,
      oid,
      buyer,
      "REFUND",
      50000,
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
        status === "REVIEW" ? phase : null,
        status === "OPEN" ? phase : null,
      ],
    );
  }
  await exec("INSERT INTO payment_exceptions VALUES (?,?,?,?,?,?,?,?)", [
    randomUUID(),
    a,
    buyer,
    "REFUND",
    50000,
    "Duplicate legacy",
    "OPEN",
    at(-19),
  ]);
  const s1 = randomUUID(),
    s2 = randomUUID();
  for (const [session, event] of [
    [s1, "dish_view"],
    [s1, "dish_view"],
    [s2, "dish_view"],
    [s2, "cart_add"],
  ])
    await exec(
      "INSERT INTO analytics_events (id,session_id,user_id,event_name,product_id,chef_id,meal_id,created_at) VALUES (?,?,?,?,?,?,?,?)",
      [
        randomUUID(),
        session,
        buyer,
        event,
        products[0],
        chefs[0],
        "lunch",
        at(-1),
      ],
    );
  await exec(
    "INSERT INTO analytics_order_context (order_id,session_id,created_at) VALUES (?,?,?)",
    [a, s2, at(-20)],
  );
  await exec("INSERT INTO favorites VALUES (?,?,?)", [
    buyer,
    products[0],
    at(0),
  ]);

  const sum = await report("summary");
  assert.equal(sum.metrics.total, 110);
  assert.equal(sum.metrics.active, 109);
  assert.equal(sum.metrics.ready, 1);
  assert.equal(sum.metrics.sold, 3);
  assert.equal(sum.metrics.servings, 6);
  assert.equal(sum.metrics.gmv, 153999);
  assert.equal(sum.metrics.new, 109);
  assert.equal(sum.previous.new, 1);
  assert.equal(sum.previous.gmv, 20000);
  assert.equal(sum.missingProducts, 1);
  assert.equal(
    sum.trackingCoverage.tracked,
    0,
    "Created outside period is not coverage cohort",
  );
  assert.equal(
    (await report("summary", { status: "hidden", group: "new", page: "3" }))
      .metrics.gmv,
    sum.metrics.gmv,
  );
  assert.equal(
    (await report("summary", { meal: "dinner" })).metrics.total,
    110,
  );
  const seen = new Set();
  for (let page = 1; page <= 6; page++)
    for (const p of (await report("list", { page: String(page) })).products) {
      assert.ok(!seen.has(p.id));
      seen.add(p.id);
      assert.ok(!("password_hash" in p));
      assert.ok(!("account_no" in p));
      assert.ok(!("key_hash" in p));
    }
  assert.equal(seen.size, 110);
  assert.equal((await report("list", { page: "9999" })).page, 6);
  assert.equal((await report("list", { q: suffix + "%" })).total, 0);
  assert.equal((await report("list", { q: "' OR 1=1 --" })).total, 0);
  assert.equal((await report("list", { region: "unknown" })).total, 1);
  for (const [key, patch] of Object.entries({
    total: {},
    active: { status: "active" },
    ready: { group: "ready" },
    sold: { group: "sales" },
    new: { group: "new" },
    attention: { group: "attention" },
  }))
    assert.equal(
      (await report("list", patch as Record<string, string>)).total,
      sum.metrics[key],
      key,
    );
  const p = (await detail(products[0], "overview")).product;
  assert.equal(p.name, "12345");
  assert.equal(p.servings, 3);
  assert.equal(p.gmv, 106665);
  assert.equal(p.orders, 2);
  assert.equal(p.buyers, 1);
  assert.equal(p.available_stock, 8);
  assert.equal(p.review_count, 2);
  assert.equal(p.period_rating, 3);
  assert.equal(p.views, 2);
  assert.equal(p.adds, 1);
  assert.equal(p.favorites, 1);
  assert.equal(p.refund_open, 1);
  assert.equal(p.refund_review, 1);
  assert.equal(p.refund_overdue, 1);
  assert.equal(p.oldest_refund_open_at, at(0, -5));
  const buyers = (await detail(products[0], "overview")).buyers;
  assert.equal(buyers.first_buyers, 0);
  assert.equal(buyers.repeat_buyers, 1);
  assert.equal((await detail(products[1], "overview")).product.gmv, 33334);
  assert.equal(
    (await report("summary", { q: "12345" })).metrics.gmv,
    106665,
    "Filter does not reallocate voucher",
  );
  const reasons = new Map<number, string>([
    [1, "Không còn suất khả dụng"],
    [2, "Món đã ẩn"],
    [3, "Phiên bán đã tắt"],
    [4, "Bữa đã hết giờ"],
    [5, "Bếp chưa mở"],
    [6, "Bếp chưa hoạt động"],
    [7, "Chưa cấu hình ngân hàng"],
  ]);
  for (const [i, reason] of reasons)
    assert.equal(
      (await detail(products[i], "overview")).product.operation,
      reason,
    );
  assert.ok(
    (await detail(products[8], "overview")).product.alerts.some(
      (a: any) => a.key === "no_sales",
    ),
  );
  assert.ok(
    !p.alerts.some((a: any) => a.key === "rating"),
    "Small sample has no rating alarm",
  );
  assert.ok(
    productAlerts(p, now, {
      lowRating: 3.5,
      minReviews: 2,
      minMenuDays: 3,
      minAgeDays: 7,
    }).some((a) => a.key === "rating"),
  );
  const midnight = new Date(today + "T01:00:00+07:00");
  assert.equal(
    (await report("list", { group: "ready", meal: "late" }, midnight)).total,
    1,
  );
  await exec("UPDATE users SET active=0 WHERE id=?", [owners[0]]);
  assert.equal((await report("summary")).metrics.ready, 0);
  await exec("UPDATE users SET active=1 WHERE id=?", [owners[0]]);
  const trends = await report("trends");
  assert.equal(
    trends.days.reduce((n: number, d: any) => n + d.gmv, 0),
    sum.metrics.gmv,
  );
  assert.equal(trends.quality.legacyOrders, 1);
  assert.equal(trends.quality.allocationWarnings, 0);
  assert.equal(trends.tops.servings.length, 3);
  const supply = await report("supply");
  assert.equal(
    supply.cells.reduce((n: number, c: any) => n + c.stock, 0),
    8,
  );
  assert.equal(
    supply.heatmap.reduce((n: number, h: any) => n + h.servings, 0),
    6,
  );
  assert.equal(
    supply.cells.find(
      (c: any) => c.meal_id === "lunch" && c.region === "500:5300",
    ).products,
    1,
  );
  const period = (await detail(products[0], "orders")).items;
  assert.equal(period.length, 1);
  assert.equal(period[0].id, b);
  const completed = await detail(products[0], "orders", {
    dateBy: "completed",
  });
  assert.equal(completed.total, 2);
  assert.equal(completed.items.find((o: any) => o.id === a).quantity, 2);
  assert.equal(
    (await detail(products[0], "orders", { focus: "issues", from: today }))
      .total,
    2,
    "Open issues survive date filters",
  );
  const highest = await detail(products[0], "reviews", {
    reviewSort: "highest",
  });
  assert.equal(highest.total, 2);
  assert.equal(highest.items[0].rating, 5);
  assert.ok(highest.items[0].dishes);
  assert.ok(highest.items[0].user_name);
  assert.equal(
    (await detail(products[0], "reviews", { reviewSort: "lowest" })).items[0]
      .rating,
    1,
  );
  assert.equal((await detail(orphan, "overview")).product.missing, 1);
  assert.equal((await report("list", { group: "legacy" })).total, 1);
  for (let d = -40; d <= -18; d++) await menu(0, d);
  const historyMenu = await detail(products[0], "menu", {
    from: shiftDate(today, -45),
    page: "2",
  });
  assert.ok(historyMenu.total > 20);
  assert.ok(historyMenu.items.length > 0);
  for (let i = 0; i < 21; i++)
    await order([[products[0], 10000, 1]], -50, -51, 0, false);
  assert.ok(
    (
      await detail(products[0], "orders", {
        from: shiftDate(today, -60),
        dateBy: "completed",
        page: "2",
      })
    ).items.length > 0,
  );
  const actor = { id: owners[0], role: "chef", name: "Fixture" } as any,
    input = {
      name: suffix + " saved",
      description: "Mô tả món kiểm tra",
      price: 50000,
      imageUrl: "https://images.unsplash.com/fixture",
      active: true,
    };
  const saved = await saveProduct(actor, input);
  products.push(saved.id!);
  await saveProduct(actor, { ...input, price: 60000, active: false }, saved.id);
  const history = await detail(saved.id!, "history");
  assert.deepEqual(
    new Set(history.items.map((h: any) => h.action)),
    new Set(["product.created", "product.updated"]),
  );
  assert.ok(
    (
      await rows<any>(
        "SELECT id FROM realtime_outbox WHERE JSON_UNQUOTE(JSON_EXTRACT(payload,'$.entityId'))=?",
        [saved.id],
      )
    ).length > 0,
  );
  for (const patch of [
    { page: "0" },
    { group: "__proto__" },
    { status: "toString" },
    { sort: "constructor" },
    { view: "bad" },
    { from: "2026-02-30" },
  ] as Record<string, string>[])
    await assert.rejects(() => report("list", patch));
  for (const [panel, patch] of [
    ["orders", { dateBy: "bad" }],
    ["orders", { focus: "bad" }],
    ["reviews", { reviewSort: "bad" }],
    ["constructor", {}],
  ] as [string, Record<string, string>][])
    await assert.rejects(() => detail(products[0], panel, patch));
  assert.throws(() =>
    productFilter(new URLSearchParams({ q: "x".repeat(101) }), now),
  );
  assert.equal(
    productThresholdSchema.safeParse({ minReviews: 0 }).success,
    false,
  );
  await assert.rejects(() =>
    saveProductThresholds(
      { id: buyer, role: "user", name: "Fixture" } as any,
      {},
    ),
  );
  await assert.rejects(() => report("operations", { category: "bad" }));
  const contentAlerts = await report("operations", { category: "content" });
  assert.ok(contentAlerts.alerts.every((a: any) => a.category === "content"));
  changedThreshold = true;
  await saveProductThresholds(
    { id: buyer, role: "admin", name: "Fixture" } as any,
    { lowRating: 3.5, minReviews: 2, minMenuDays: 3, minAgeDays: 7 },
  );
  assert.equal((await report("summary")).thresholds.minReviews, 2);
  assert.ok(
    (
      await rows<any>(
        "SELECT id FROM audit_logs WHERE actor_id=? AND action='product.analytics.thresholds'",
        [buyer],
      )
    ).length === 1,
  );
  console.log(
    "PASS Products: 110 items/full stable pages, numeric/literal names, voucher integer allocation before filters, duplicate lines/menu/reviews, historical prices/completion dates/fallback/orphans, readiness/overnight, stage-aged canonical refunds, supply/heatmap, independent sessions/favorites, repeat buyers, five details, audit/outbox, validation.",
  );
} finally {
  if (changedThreshold) {
    if (originalThreshold)
      await exec(
        "UPDATE platform_settings SET value=? WHERE id='product_analytics_thresholds'",
        [
          typeof originalThreshold.value === "string"
            ? originalThreshold.value
            : JSON.stringify(originalThreshold.value),
        ],
      );
    else
      await exec(
        "DELETE FROM platform_settings WHERE id='product_analytics_thresholds'",
      );
  }
  await exec("DELETE FROM audit_logs WHERE actor_id=?", [buyer]);
  await exec(
    "DELETE r FROM outbox_receipts r JOIN realtime_outbox o ON o.id=r.event_id WHERE JSON_UNQUOTE(JSON_EXTRACT(o.payload,'$.entityId'))=?",
    [buyer],
  );
  await exec(
    "DELETE FROM realtime_outbox WHERE JSON_UNQUOTE(JSON_EXTRACT(payload,'$.entityId'))=?",
    [buyer],
  );
  for (const id of orders) {
    for (const table of [
      "reviews",
      "payment_request_details",
      "payment_exceptions",
      "order_items",
      "order_events",
      "analytics_order_context",
    ])
      await exec(`DELETE FROM ${table} WHERE order_id=?`, [id]);
    await exec("DELETE FROM orders WHERE id=?", [id]);
  }
  for (const id of sessions) {
    await exec("DELETE FROM daily_menu WHERE session_id=?", [id]);
    await exec("DELETE FROM kitchen_sessions WHERE id=?", [id]);
  }
  for (const id of products) {
    await exec("DELETE FROM favorites WHERE product_id=?", [id]);
    await exec("DELETE FROM analytics_events WHERE product_id=?", [id]);
    await exec("DELETE FROM audit_logs WHERE entity_id=?", [id]);
    await exec(
      "DELETE r FROM outbox_receipts r JOIN realtime_outbox o ON o.id=r.event_id WHERE JSON_UNQUOTE(JSON_EXTRACT(o.payload,'$.entityId'))=?",
      [id],
    );
    await exec(
      "DELETE FROM realtime_outbox WHERE JSON_UNQUOTE(JSON_EXTRACT(payload,'$.entityId'))=?",
      [id],
    );
    await exec("DELETE FROM products WHERE id=?", [id]);
  }
  for (const id of chefs) await exec("DELETE FROM chefs WHERE id=?", [id]);
  for (const id of [...owners, buyer])
    await exec("DELETE FROM users WHERE id=?", [id]);
  clearProductReports();
  await pool().end();
}
