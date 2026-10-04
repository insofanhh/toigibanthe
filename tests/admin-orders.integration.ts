import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  adminOrderAnalytics,
  adminOrderDetail,
  saveOrderThresholds,
  clearOrderReports,
} from "../src/lib/admin-orders";
import { orderReportFilter } from "../src/lib/admin-orders-domain";
import { orderLedger } from "../src/lib/order-report-ledger";
import { exec, rows, pool, sqlDate } from "../src/lib/db";
import { serviceDate, type Actor } from "../src/lib/domain";
import { shiftDate } from "../src/lib/analytics-domain";
import { ensurePaymentRequestSchema } from "../src/lib/payment-request-store";
import { ensureSePaySchema } from "../src/lib/sepay-schema";
assert.ok(
  ["localhost", "127.0.0.1"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  ),
  "Local MySQL fixtures only",
);
const suffix = "orders-" + randomUUID(),
  today = serviceDate(),
  now = new Date(today + "T12:00:00+07:00"),
  buyer = randomUUID(),
  owners = [randomUUID(), randomUUID()],
  chefs = [randomUUID(), randomUUID()],
  orders: string[] = [],
  requestIDs: string[] = [];
const at = (day = 0, min = 0) =>
  sqlDate(new Date(now.getTime() + day * 86400000 + min * 60000));
const opts = { from: shiftDate(today, -6), to: today, q: suffix, fresh: "1" };
const report = (s: string, p: Record<string, string> = {}) =>
  adminOrderAnalytics(s, new URLSearchParams({ ...opts, ...p }), now);
const detail = (
  id: string,
  panel: string,
  p: Record<string, string> = {},
): Promise<any> =>
  adminOrderDetail(id, new URLSearchParams({ ...opts, panel, ...p }), now);
const original = (
  await rows<any>(
    "SELECT value FROM platform_settings WHERE id='order_analytics_thresholds'",
  )
)[0];
let changed = false;
async function event(
  id: string,
  status: string,
  day = 0,
  min = 0,
  note = "fixture",
  actor = owners[0],
) {
  await exec("INSERT INTO order_events VALUES (?,?,?,?,?,?)", [
    randomUUID(),
    id,
    actor,
    status,
    note,
    at(day, min),
  ]);
}
async function order(
  status = "COMPLETED",
  day = -1,
  ci = 0,
  payment = "PAID_AUTO",
  paidDay: number | null = day,
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
      chefs[ci],
      "lunch",
      status,
      payment,
      60000,
      10000,
      15000,
      65000,
      suffix,
      "0901234567",
      "fixture",
      10,
      106,
      10,
      106,
      0,
      "970436",
      "Test",
      "0001234567",
      "TEST",
      id.slice(0, 20),
      id,
      at(day, 30),
      paidDay == null ? null : at(paidDay, 5),
      at(day),
      at(day, 80),
    ],
  );
  await exec("INSERT INTO order_items VALUES (?,?,?,?,?,?,?,?)", [
    randomUUID(),
    id,
    randomUUID(),
    "snapshot-a",
    "Món cũ",
    "/icon.svg",
    20000,
    2,
  ]);
  await exec("INSERT INTO order_items VALUES (?,?,?,?,?,?,?,?)", [
    randomUUID(),
    id,
    randomUUID(),
    "snapshot-b",
    "Canh",
    "/icon.svg",
    20000,
    1,
  ]);
  await event(id, "PLACED", day, 0);
  if (paidDay != null && payment === "PAID_AUTO")
    await event(id, "PAID", paidDay, 5, "SePay xác nhận đủ tiền");
  if (
    !legacy &&
    ["COMPLETED", "ACCEPTED", "PREPARING", "DELIVERING", "DELIVERED"].includes(
      status,
    )
  ) {
    for (const [s, m] of [
      ["ACCEPTED", 10],
      ["PREPARING", 20],
      ["DELIVERING", 35],
      ["DELIVERED", 60],
      ["COMPLETED", 80],
    ] as const) {
      await event(id, s, day, m);
      if (s === status) break;
    }
  }
  if (["CANCELLED", "REJECTED", "EXPIRED"].includes(status))
    await event(
      id,
      status,
      day,
      15,
      "fixture",
      status === "CANCELLED" ? buyer : owners[ci],
    );
  return id;
}
async function tx(
  id: string | null,
  result: string,
  amount: number,
  day = -1,
  account = "0001234567",
  receivedDay = day,
) {
  const tid = randomUUID();
  await exec("INSERT INTO sepay_transactions VALUES (?,?,?,?,?,?,?,?,?,?,?)", [
    chefs[0],
    tid,
    id,
    "970436",
    account,
    amount,
    at(day),
    suffix,
    tid,
    result,
    at(receivedDay),
  ]);
  return tid;
}
async function request(
  id: string,
  status: string,
  actor = buyer,
  canonical = false,
  reviewedDay: number | null = null,
) {
  const rid = randomUUID();
  requestIDs.push(rid);
  await exec("INSERT INTO payment_exceptions VALUES (?,?,?,?,?,?,?,?)", [
    rid,
    id,
    actor,
    "REFUND",
    65000,
    suffix,
    status,
    at(-20),
  ]);
  if (canonical)
    await exec(
      "INSERT INTO payment_request_details (exception_id,order_id,contact_phone,submitted_at,reviewed_at) VALUES (?,?,?,?,?)",
      [
        rid,
        id,
        "0901234567",
        status === "REVIEW" ? at(-1) : null,
        reviewedDay == null ? null : at(reviewedDay),
      ],
    );
  return rid;
}
try {
  await ensureSePaySchema();
  await ensurePaymentRequestSchema(false);
  for (const [i, id] of [...owners, buyer].entries())
    await exec(
      "INSERT INTO users (id,name,email,password_hash,role,phone,created_at) VALUES (?,?,?,?,?,?,?)",
      [
        id,
        suffix + i,
        suffix + i + "@local.test",
        "fixture",
        i === 2 ? "user" : "chef",
        "0901234567",
        at(-100),
      ],
    );
  for (let i = 0; i < 2; i++)
    await exec(
      "INSERT INTO chefs (id,user_id,name,bio,address,area,lat,lng,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [
        chefs[i],
        owners[i],
        suffix + i,
        "fixture",
        "fixture",
        "local",
        10,
        106,
        i === 1 ? "rejected" : "approved",
        at(-100),
      ],
    );
  for (let i = 0; i < 105; i++) await order("COMPLETED", -1);
  const cancelled = await order("CANCELLED", -2, 0, "REFUND_PENDING", -2),
    expired = await order("EXPIRED", -2, 0, "EXPIRED", null),
    backlog = await order("PLACED", -30, 1, "PENDING", null),
    paidOld = await order("PAID", -30, 0, "PAID_AUTO", -30),
    manual = await order("COMPLETED", -1, 0, "PAID_MANUAL", -1),
    legacy = await order("COMPLETED", -1, 0, "PAID_AUTO", -1, true),
    prior = await order("COMPLETED", -8);
  await event(backlog, "PAYMENT_REPORTED", 0, -1);
  const before = (
    await rows<any>("SELECT status,updated_at FROM orders WHERE id=?", [
      backlog,
    ])
  )[0];
  const m = await report("summary");
  assert.equal(m.metrics.placed, 109);
  assert.equal(m.metrics.completed, 107);
  assert.equal(m.metrics.gmv, 107 * 50000);
  assert.equal(m.metrics.current, 2);
  assert.equal(m.metrics.cancelled, 1);
  assert.equal(m.metrics.expired, 1);
  assert.equal(m.previous.placed, 1);
  assert.equal(m.quality.legacy, 1);
  const pages = [];
  for (let page = 1; page <= 6; page++) {
    const d = await report("list", { page: String(page) });
    assert.equal(d.total, 109);
    pages.push(...d.orders.map((o: any) => o.id));
  }
  assert.equal(new Set(pages).size, 109);
  const filtered = await report("list", {
    chef: chefs[1],
    scope: "current",
    group: "active",
  });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.orders[0].id, backlog);
  assert.ok(filtered.orders[0].alerts.some((a: any) => a.key === "expiry"));
  assert.equal(Math.round(filtered.orders[0].age_minutes), 30 * 1440);
  assert.equal(
    (await report("summary", { status: "EXPIRED", group: "cancelled" })).metrics
      .gmv,
    m.metrics.gmv,
    "List filters cannot alter KPI",
  );
  assert.equal(
    (await report("list", { q: suffix + "%" })).total,
    0,
    "Literal percent",
  );
  assert.equal(
    (await report("list", { q: suffix + "_" })).total,
    0,
    "Literal underscore",
  );
  assert.equal(
    (await report("list", { dateBy: "paid" })).total,
    108,
    "Cancelled paid order remains in paid history",
  );
  assert.equal(
    (await report("list", { dateBy: "completed", status: "COMPLETED" })).total,
    107,
  );
  const t = await report("trends");
  assert.equal(
    t.days.reduce((n: number, r: any) => n + r.placed, 0),
    m.metrics.placed,
  );
  assert.equal(
    t.days.reduce((n: number, r: any) => n + r.gmv, 0),
    m.metrics.gmv,
  );
  assert.equal(
    t.outcomes.reduce((n: number, r: any) => n + r.count, 0),
    109,
  );
  const a = orders[0];
  await event(a, "COMPLETED", -1, 90); // Adjacent duplicate state must not change completed time.
  assert.equal((await detail(a, "overview")).order.completed_at, at(-1, 80));
  await tx(a, "PARTIAL", 20000);
  await tx(a, "PAID", 45000);
  await tx(a, "EXTRA_PAYMENT", 7000);
  await tx(a, "ACCOUNT_MISMATCH", 3000);
  await tx(a, "PAID", 999, -1, "different");
  await tx(null, "UNMATCHED", 1500);
  await tx(a, "LATE", 1700, -8, "0001234567", -1);
  const rid = await request(a, "OPEN", buyer, true, 0);
  await request(a, "OPEN", buyer, false);
  await request(a, "OPEN", owners[0], false);
  const reviewed = await request(cancelled, "REVIEW", buyer, true);
  const o = (await detail(a, "overview")).order;
  assert.equal(o.bank_received, 73700);
  assert.equal(o.valid_transactions, 4);
  assert.equal(o.invalid_transactions, 2);
  assert.equal(o.item_gross, 60000);
  assert.equal(o.item_quantity, 3);
  assert.equal(
    o.open_requests,
    2,
    "canonical customer plus system, exclude duplicate legacy request",
  );
  assert.ok(o.alerts.some((x: any) => x.key === "late_money"));
  const dp = await detail(a, "payments");
  assert.equal(dp.requests.length, 2);
  assert.equal(dp.transactions.total, 6);
  assert.equal(
    dp.requests.find((r: any) => r.id === rid).contact_phone,
    "0901234567",
  );
  const po = await report("payments", { txGroup: "valid" });
  assert.equal(po.totals.valid_amount, 72000);
  assert.equal(po.total, 3);
  assert.equal(po.confirmed.count, 108);
  assert.equal(po.confirmed.paid_value, 108 * 65000);
  assert.equal(Number(po.requests.orders),2);
  assert.equal(po.requests.count,3);
  assert.equal(po.requests.claimed_amount,195000);
  const webhook = await report("payments", {
    txDate: "received",
    txGroup: "valid",
  });
  assert.equal(webhook.totals.valid_amount, 73700);
  assert.equal(webhook.totals.mismatched_dates, 1);
  const bad = await report("payments", { txGroup: "invalid" });
  assert.equal(bad.totals.invalid_amount, 3999);
  const unmatched = await report("payments", {
    txGroup: "unmatched",
    meal: "breakfast",
    region: "unknown",
  });
  assert.equal(unmatched.total, 1);
  assert.equal(unmatched.totals.unmatched_amount, 1500);
  assert.equal(unmatched.scopeIgnored, true);
  const operations = await report("operations");
  assert.ok(operations.alerts.some((r: any) => r.id === backlog));
  assert.ok(operations.alerts.some((r: any) => r.id === paidOld));
  const reviewOrder = operations.alerts.find((r: any) => r.id === cancelled);
  assert.equal(reviewOrder.oldest_request_at, at(-1));
  const refund = await detail(manual, "overview");
  assert.equal(refund.order.payment_source, "manual");
  await exec("INSERT INTO audit_logs VALUES (?,?,?,?,?,?)", [
    randomUUID(),
    owners[0],
    "order.payment.manual",
    manual,
    "{}",
    at(-1, 10),
  ]);
  await exec("UPDATE orders SET payment_status='REFUNDED_MANUAL' WHERE id=?", [
    manual,
  ]);
  assert.equal(
    (await detail(manual, "overview")).order.payment_source,
    "manual",
  );
  const perf = await report("performance");
  const accept = perf.durations.find((r: any) => r.kind === "accept");
  assert.equal(accept.samples, 105);
  assert.equal(accept.median, 5);
  assert.equal(accept.p90, 5);
  assert.equal(accept.excluded, 1);
  assert.equal(perf.secondary.gmv, m.metrics.gmv);
  assert.equal(perf.secondary.servings, 321);
  assert.equal(perf.secondary.delivery, 107 * 15000);
  assert.equal(perf.secondary.voucher, 107 * 10000);
  // 19/20 samples: P90 gate and nearest-rank, plus missing/negative stages.
  const small = await report("performance", { q: "", chef: chefs[1] });
  assert.ok(small.durations.every((r: any) => r.p90 === null));
  for (let i = 0; i < 19; i++) await order("ACCEPTED", -2, 1);
  const p19 = await report("performance", { chef: chefs[1] });
  assert.equal(p19.durations.find((r: any) => r.kind === "accept").p90, null);
  await order("ACCEPTED", -2, 1);
  const p20 = await report("performance", { chef: chefs[1] });
  assert.equal(p20.durations.find((r: any) => r.kind === "accept").p90, 5);
  const broken = await order("PREPARING", -2, 1);
  await exec(
    "UPDATE order_events SET created_at=? WHERE order_id=? AND status='PREPARING'",
    [at(-2, 1), broken],
  );
  const pb = await report("performance", { chef: chefs[1] });
  assert.equal(pb.durations.find((r: any) => r.kind === "prepare").missing, 1);
  for (let i = 0; i < 25; i++) await event(a, "PAYMENT_REPORTED", -1, 100 + i);
  const timeline = await detail(a, "timeline");
  assert.ok(timeline.total > 20);
  assert.equal(timeline.items.length, 20);
  assert.equal(
    (await detail(a, "timeline", { stage: "PAYMENT_REPORTED", page: "2" }))
      .items.length,
    5,
  );
  assert.equal((await detail(a, "delivery")).reviews.length, 0);
  await exec(
    "UPDATE chefs SET status='suspended',name='Changed chef' WHERE id=?",
    [chefs[0]],
  );
  assert.equal((await report("summary")).metrics.gmv, m.metrics.gmv);
  const beforeAfter = (
    await rows<any>("SELECT status,updated_at FROM orders WHERE id=?", [
      backlog,
    ])
  )[0];
  assert.deepEqual(
    beforeAfter,
    before,
    "Report GET must not expire or update orders",
  );
  assert.equal(
    (
      await rows<any>(
        "SELECT COUNT(*) n FROM payment_request_details WHERE order_id=?",
        [a],
      )
    )[0].n,
    1,
    "Report cannot backfill duplicate requests",
  );
  for (const p of [
    { sort: "toString" },
    { from: "2026-02-30" },
    { page: "0" },
    { status: "invalid" },
    { txGroup: "bad" },
    { q: "a".repeat(101) },
  ])
    assert.throws(() =>
      orderReportFilter(
        new URLSearchParams(
          Object.entries(p).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        ),
        now,
      ),
    );
  await assert.rejects(() =>
    saveOrderThresholds({ id: buyer, role: "user" } as Actor, {}),
  );
  await assert.rejects(() =>
    saveOrderThresholds({ id: buyer, role: "admin" } as Actor, {
      acceptedMinutes: 0,
    }),
  );
  changed = true;
  await saveOrderThresholds({ id: buyer, role: "admin" } as Actor, {
    acceptedMinutes: 20,
  });
  assert.equal((await report("summary")).thresholds.acceptedMinutes, 20);
  assert.equal(
    (
      await rows<any>(
        "SELECT COUNT(*) n FROM audit_logs WHERE actor_id=? AND action='order.analytics.thresholds'",
        [buyer],
      )
    )[0].n,
    1,
  );
  const explain = await rows<any>(
    "EXPLAIN SELECT id FROM orders WHERE chef_id=? AND created_at>=? ORDER BY created_at,id LIMIT 20",
    [chefs[0], at(-6)],
  );
  assert.ok(
    explain.some((r) =>
      String(r.possible_keys).includes("report_orders_chef_created"),
    ),
  );
  const ledger = orderLedger(orderReportFilter(new URLSearchParams(opts), now));
  assert.ok(
    (
      await rows<any>(
        "EXPLAIN " + ledger.sql + " SELECT id FROM ledger",
        ledger.values,
      )
    ).length > 0,
  );
  console.log(
    "PASS Orders: >100/full SQL paging, literal filters, old backlog/read-only expiry, financial cohorts/voucher/fee, unique multi-line/events/receipts, snapshot invalid account, bank/webhook dates, canonical request age, manual source, durations/P90 19/20/invalid pairs, details/pages, settings/audit, indexes and EXPLAIN.",
  );
} finally {
  if (changed) {
    if (original)
      await exec(
        "UPDATE platform_settings SET value=? WHERE id='order_analytics_thresholds'",
        [
          typeof original.value === "string"
            ? original.value
            : JSON.stringify(original.value),
        ],
      );
    else
      await exec(
        "DELETE FROM platform_settings WHERE id='order_analytics_thresholds'",
      );
  }
  for (const id of [buyer, ...owners, ...chefs, ...orders, ...requestIDs]) {
    await exec(
      "DELETE r FROM outbox_receipts r JOIN realtime_outbox o ON o.id=r.event_id WHERE JSON_UNQUOTE(JSON_EXTRACT(o.payload,'$.entityId'))=?",
      [id],
    );
    await exec(
      "DELETE FROM realtime_outbox WHERE JSON_UNQUOTE(JSON_EXTRACT(payload,'$.entityId'))=?",
      [id],
    );
    await exec("DELETE FROM audit_logs WHERE actor_id=? OR entity_id=?", [
      id,
      id,
    ]);
  }
  await exec("DELETE FROM sepay_transactions WHERE chef_id IN (?,?)", chefs);
  for (const id of orders) {
    for (const table of [
      "order_items",
      "order_events",
      "payment_request_details",
      "payment_exceptions",
      "sepay_order_settings",
      "reviews",
    ])
      await exec(`DELETE FROM ${table} WHERE order_id=?`, [id]);
    await exec("DELETE FROM orders WHERE id=?", [id]);
  }
  for (const id of chefs) await exec("DELETE FROM chefs WHERE id=?", [id]);
  for (const id of [...owners, buyer])
    await exec("DELETE FROM users WHERE id=?", [id]);
  clearOrderReports();
  await pool().end();
}
