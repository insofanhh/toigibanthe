import { randomUUID } from "node:crypto";
import { z } from "zod";
import { rows, exec, sqlDate, type DB } from "./db";
import { AppError } from "./http";
import { ensureAnalyticsSchema } from "./analytics-schema";
import { ensureSePaySchema } from "./sepay-schema";
import { ensurePaymentRequestSchema } from "./payment-request-store";
import { MEALS, serviceDate, type Actor } from "./domain";
import {
  ANALYTICS_EVENTS,
  analyticsFilter,
  dateBounds,
  previousFilter,
  regionCell,
  regionLabel,
  ratio,
  validDate,
  GOAL_METRICS,
  type AnalyticsFilter,
} from "./analytics-domain";

export const eventSchema = z.object({
  id: z.uuid(),
  sessionId: z.uuid(),
  event: z.enum(ANALYTICS_EVENTS).exclude(["order_created"]),
  productId: z.string().min(1).max(36).optional(),
  meal: z.enum(MEALS).optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  area: z.string().max(150).default(""),
  source: z.string().max(100).default(""),
  resultCount: z.number().int().min(0).max(100).optional(),
  occurredAt: z.iso.datetime().optional(),
});
// Telemetry must never make catalog, cart or checkout unavailable.
export async function recordAnalyticsEvent(input: unknown, user: Actor | null) {
  if (user?.role === "admin") return { ok: true };
  const b = eventSchema.parse(input);
  await ensureAnalyticsSchema();
  // Bounded per-session ingestion. UUID retries remain idempotent.
  const [{ count }] = await rows<{ count: number }>(
    "SELECT COUNT(*) count FROM analytics_events WHERE session_id=? AND created_at>DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 MINUTE)",
    [b.sessionId],
  );
  if (Number(count) >= 60)
    throw new AppError("Đã ghi nhận đủ sự kiện cho phiên này.", 429);
  let chefId: string | null = null;
  if (b.productId) {
    const [p] = await rows<{ chef_id: string }>(
      "SELECT chef_id FROM products WHERE id=?",
      [b.productId],
    );
    if (!p) throw new AppError("Món không tồn tại.", 404);
    chefId = p.chef_id;
  }
  await exec(
    "INSERT IGNORE INTO analytics_events (id,session_id,user_id,event_name,product_id,chef_id,meal_id,region,area,result_count,source,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      b.id,
      b.sessionId,
      user?.id || null,
      b.event,
      b.productId || null,
      chefId,
      b.meal || "",
      regionCell(b.lat, b.lng),
      b.area,
      b.resultCount ?? null,
      b.source,
      sqlDate(
        b.occurredAt && Math.abs(Date.parse(b.occurredAt) - Date.now()) < 600000
          ? new Date(b.occurredAt)
          : new Date(),
      ),
    ],
  );
  return { ok: true };
}
export async function analyticsLive(db: DB, entityId: string) {
  for (const a of await rows<{ id: string }>(
    'SELECT id FROM users WHERE role="admin" AND active=TRUE',
    [],
    db,
  ))
    await exec(
      "INSERT INTO realtime_outbox VALUES (?,?,?,?,NULL)",
      [
        randomUUID(),
        a.id,
        JSON.stringify({ type: "admin-analytics", entityId }),
        sqlDate(),
      ],
      db,
    );
}

// Completion time comes from immutable events; updated_at is only a fallback for legacy imports.
const base = `WITH event_times AS (
 SELECT order_id,MIN(CASE WHEN status='COMPLETED' THEN created_at END) finished_at,
 MIN(CASE WHEN status='ACCEPTED' THEN created_at END) accepted_at,MAX(created_at) state_at FROM order_events GROUP BY order_id
), all_orders AS (
 SELECT o.*,c.name chef_name,c.area chef_area,c.status chef_status,
 CASE WHEN o.status='COMPLETED' THEN COALESCE(e.finished_at,o.updated_at) END completed_at,
 e.accepted_at,COALESCE(e.state_at,o.created_at) state_at,
 CONCAT(ROUND(o.lat*50),':',ROUND(o.lng*50)) region
 FROM orders o JOIN chefs c ON c.id=o.chef_id LEFT JOIN event_times e ON e.order_id=o.id
), first_orders AS (SELECT user_id,MIN(completed_at) first_at FROM all_orders WHERE status='COMPLETED' GROUP BY user_id)`;
function segment(f: AnalyticsFilter, alias = "o") {
  return {
    sql: `${f.region ? ` AND ${alias}.region=?` : ""}${f.meal ? ` AND ${alias}.meal_id=?` : ""}`,
    values: [...(f.region ? [f.region] : []), ...(f.meal ? [f.meal] : [])],
  };
}
function bounds(f: AnalyticsFilter) {
  const b = dateBounds(f.from, f.to);
  return [sqlDate(b.start), sqlDate(b.end)];
}
function selected(
  f: AnalyticsFilter,
  time: "created_at" | "completed_at" = "created_at",
  alias = "o",
) {
  const s = segment(f, alias);
  return {
    sql: `${alias}.${time}>=? AND ${alias}.${time}<?${s.sql}`,
    values: [...bounds(f), ...s.values],
  };
}
function numbers<T extends Record<string, unknown>>(r: T, keys: string[]) {
  const out = { ...r };
  for (const k of keys) (out as Record<string, unknown>)[k] = Number(r[k] || 0);
  return out;
}
async function metrics(f: AnalyticsFilter) {
  const cr = selected(f),
    co = selected(f, "completed_at");
  const [created, completed, retention] = await Promise.all([
    rows<Record<string, unknown>>(
      base +
        ` SELECT COUNT(*) placed,SUM(o.status IN ('CANCELLED','REJECTED')) cancelled,SUM(o.status='EXPIRED') expired,SUM(o.status='COMPLETED') cohort_completed,SUM(o.status IN ('PLACED','PAID','ACCEPTED','PREPARING','DELIVERING','DELIVERED')) unresolved FROM all_orders o WHERE ${cr.sql}`,
      cr.values,
    ),
    rows<Record<string, unknown>>(
      base +
        ` SELECT COUNT(*) completed,COALESCE(SUM(o.subtotal-o.discount),0) gmv,COALESCE(SUM(o.delivery_fee),0) delivery,COUNT(DISTINCT o.user_id) buyers,COUNT(DISTINCT o.chef_id) sellers,COUNT(DISTINCT CASE WHEN f.first_at=o.completed_at THEN o.user_id END) new_buyers,SUM(o.completed_at>f.first_at) repeat_orders FROM all_orders o JOIN first_orders f ON f.user_id=o.user_id WHERE ${co.sql}`,
      co.values,
    ),
    rows<{ eligible: number; returned: number }>(
      base +
        ` SELECT COUNT(DISTINCT o.user_id) eligible,COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM all_orders n WHERE n.user_id=o.user_id AND n.completed_at>f.first_at AND n.completed_at<=DATE_ADD(f.first_at,INTERVAL 30 DAY)) THEN o.user_id END) returned FROM all_orders o JOIN first_orders f ON f.user_id=o.user_id AND o.completed_at=f.first_at WHERE ${co.sql} AND f.first_at<=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 30 DAY)`,
      co.values,
    ),
  ]);
  const c = numbers(created[0], [
      "placed",
      "cancelled",
      "expired",
      "cohort_completed",
      "unresolved",
    ]),
    d = numbers(completed[0], [
      "completed",
      "gmv",
      "delivery",
      "buyers",
      "sellers",
      "new_buyers",
      "repeat_orders",
    ]);
  return {
    placed: Number(c.placed),
    cancelled: Number(c.cancelled),
    expired: Number(c.expired),
    cohort_completed: Number(c.cohort_completed),
    unresolved: Number(c.unresolved),
    completed: Number(d.completed),
    gmv: Number(d.gmv),
    delivery: Number(d.delivery),
    buyers: Number(d.buyers),
    sellers: Number(d.sellers),
    new_buyers: Number(d.new_buyers),
    repeat_orders: Number(d.repeat_orders),
    aov: Number(d.completed) ? Number(d.gmv) / Number(d.completed) : 0,
    cancelRate: ratio(Number(c.cancelled), Number(c.placed)),
    completionRate: ratio(Number(c.cohort_completed), Number(c.placed)),
    repeat30: ratio(
      Number(retention[0].returned),
      Number(retention[0].eligible),
    ),
    repeatEligible: Number(retention[0].eligible),
    repeatReturned: Number(retention[0].returned),
  };
}
async function summary(f: AnalyticsFilter) {
  await ensureSePaySchema();
  const [current, previous, totals, regions, legacy] = await Promise.all([
    metrics(f),
    metrics(previousFilter(f)),
    rows(
      `SELECT (SELECT COUNT(*) FROM users) users,(SELECT COUNT(*) FROM chefs) chefs,(SELECT COUNT(*) FROM products) products`,
    ),
    rows<{ region: string; area: string }>(`SELECT region,MAX(area) area FROM (
      SELECT CONCAT(ROUND(lat*50),':',ROUND(lng*50)) region,'' area FROM orders
      UNION ALL SELECT region,area FROM analytics_events WHERE region<>''
      UNION ALL SELECT CONCAT(ROUND(lat*50),':',ROUND(lng*50)),area FROM chefs
    ) x GROUP BY region ORDER BY region`),
    rows(
      base +
        ` SELECT COUNT(*) count FROM all_orders o WHERE o.status='COMPLETED' AND NOT EXISTS(SELECT 1 FROM order_events e WHERE e.order_id=o.id AND e.status='COMPLETED')`,
    ),
  ]);
  const confirmed = segment(f);
  const [payments] = await rows(
    base +
      ` SELECT COUNT(*) confirmed,SUM(o.total) amount,
    SUM(EXISTS(SELECT 1 FROM order_events e WHERE e.order_id=o.id AND e.status='PAID' AND e.note LIKE 'SePay%')) automatic
    FROM all_orders o WHERE o.payment_confirmed_at>=? AND o.payment_confirmed_at<?${confirmed.sql}`,
    [...bounds(f), ...confirmed.values],
  );
  return {
    current,
    previous,
    totals: totals[0],
    regions: regions.map((r) => ({
      id: r.region,
      label: r.area
        ? `${r.area} · ${regionLabel(r.region)}`
        : regionLabel(r.region),
    })),
    legacyCompletions: Number(legacy[0].count),
    payments,
    filter: f,
    previousFilter: previousFilter(f),
    updatedAt: new Date().toISOString(),
  };
}
async function trends(f: AnalyticsFilter) {
  const cr = selected(f),
    co = selected(f, "completed_at");
  const [placed, completed, meals, weekdays, statuses] = await Promise.all([
    rows(
      base +
        ` SELECT DATE(DATE_ADD(o.created_at,INTERVAL 7 HOUR)) day,COUNT(*) placed FROM all_orders o WHERE ${cr.sql} GROUP BY day ORDER BY day`,
      cr.values,
    ),
    rows(
      base +
        ` SELECT DATE(DATE_ADD(o.completed_at,INTERVAL 7 HOUR)) day,COUNT(*) completed,SUM(o.subtotal-o.discount) gmv,COUNT(DISTINCT CASE WHEN fo.first_at=o.completed_at THEN o.user_id END) new_buyers,COUNT(DISTINCT CASE WHEN fo.first_at<o.completed_at THEN o.user_id END) returning_buyers FROM all_orders o JOIN first_orders fo ON fo.user_id=o.user_id WHERE ${co.sql} GROUP BY day ORDER BY day`,
      co.values,
    ),
    rows(
      base +
        ` SELECT o.meal_id,COUNT(*) placed,SUM(o.status='COMPLETED') completed,COUNT(DISTINCT o.chef_id) chefs FROM all_orders o WHERE ${cr.sql} GROUP BY o.meal_id`,
      cr.values,
    ),
    rows(
      base +
        ` SELECT WEEKDAY(DATE_ADD(o.created_at,INTERVAL 7 HOUR)) weekday,o.meal_id,COUNT(*) placed FROM all_orders o WHERE ${cr.sql} GROUP BY weekday,o.meal_id`,
      cr.values,
    ),
    rows(
      base +
        ` SELECT o.status,COUNT(*) count FROM all_orders o WHERE ${cr.sql} GROUP BY o.status`,
      cr.values,
    ),
  ]);
  return { placed, completed, meals, weekdays, statuses };
}
function availableMenus(f: AnalyticsFilter) {
  const values: unknown[] = [],
    conditions = [
      "c.status='approved'",
      "u.active=TRUE",
      "p.active=TRUE",
      "k.is_open=TRUE",
      "m.enabled=TRUE",
      "m.stock>0",
      "m.cutoff_at>UTC_TIMESTAMP(3)",
      "(k.service_date=? OR (k.service_date=DATE_SUB(?,INTERVAL 1 DAY) AND ms.day_offset=1))",
    ];
  values.push(serviceDate(), serviceDate());
  if (f.meal) {
    conditions.push("m.meal_id=?");
    values.push(f.meal);
  }
  if (f.region) {
    const [lat, lng] = f.region.split(":").map((n) => Number(n) / 50);
    conditions.push(
      "6371*ACOS(LEAST(1,GREATEST(-1,COS(RADIANS(?))*COS(RADIANS(c.lat))*COS(RADIANS(c.lng)-RADIANS(?))+SIN(RADIANS(?))*SIN(RADIANS(c.lat)))))<=c.radius_km",
    );
    values.push(lat, lng, lat);
  }
  return {
    sql: `FROM daily_menu m JOIN kitchen_sessions k ON k.id=m.session_id JOIN products p ON p.id=m.product_id JOIN chefs c ON c.id=p.chef_id JOIN users u ON u.id=c.user_id JOIN meal_settings ms ON ms.id=m.meal_id WHERE ${conditions.join(" AND ")}`,
    values,
  };
}
async function operations(f: AnalyticsFilter) {
  await ensureSePaySchema();
  await ensurePaymentRequestSchema();
  const s = segment(f),
    availability = availableMenus(f);
  const [setting] = await rows<{ value: unknown }>(
    "SELECT value FROM platform_settings WHERE id='analytics_sla'",
  );
  const sla = setting
    ? slaSchema.parse(
        typeof setting.value === "string"
          ? JSON.parse(setting.value)
          : setting.value,
      )
    : { acceptMinutes: 10, profileHours: 48, refundHours: 24 };
  const conditions = `o.status='PAID' AND o.state_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ? MINUTE)${s.sql}`;
  const [supply, live, lateCount, late, refunds, pending, unmatched, recent] =
    await Promise.all([
      rows(
        `SELECT COUNT(DISTINCT c.id) open_chefs,COUNT(DISTINCT p.id) dishes,SUM(m.stock) servings ${availability.sql}`,
        availability.values,
      ),
      rows(
        base +
          ` SELECT COUNT(*) active,SUM(o.status='PAID') paid,SUM(o.status='PLACED') waiting_payment,SUM(o.payment_status='REFUND_PENDING') refund_pending FROM all_orders o WHERE o.status IN ('PLACED','PAID','ACCEPTED','PREPARING','DELIVERING','DELIVERED')${s.sql}`,
        s.values,
      ),
      rows(
        base + ` SELECT COUNT(*) count FROM all_orders o WHERE ${conditions}`,
        [sla.acceptMinutes, ...s.values],
      ),
      rows(
        base +
          ` SELECT o.id,o.code,o.chef_name,o.status,o.payment_status,o.total,o.state_at,TIMESTAMPDIFF(MINUTE,o.state_at,UTC_TIMESTAMP(3)) waiting_minutes FROM all_orders o WHERE ${conditions} ORDER BY o.state_at LIMIT 30`,
        [sla.acceptMinutes, ...s.values],
      ),
      rows(
        base +
          ` SELECT e.status,COUNT(*) count,SUM(e.amount) amount,SUM(CASE WHEN (CASE WHEN e.status='REVIEW' THEN COALESCE(d.submitted_at,e.created_at) ELSE COALESCE(d.reviewed_at,e.created_at) END)<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ? HOUR) THEN 1 ELSE 0 END) overdue FROM payment_exceptions e JOIN all_orders o ON o.id=e.order_id LEFT JOIN payment_request_details d ON d.exception_id=e.id WHERE e.status IN ('OPEN','REVIEW') AND (e.actor_id<>o.user_id OR d.exception_id IS NOT NULL)${s.sql} GROUP BY e.status`,
        [sla.refundHours, ...s.values],
      ),
      rows(
        "SELECT COUNT(*) count,SUM(COALESCE((SELECT MAX(a.created_at) FROM audit_logs a WHERE a.entity_id=c.id AND a.action='chef.application'),c.created_at)<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ? HOUR)) overdue FROM chefs c WHERE c.status='pending'",
        [sla.profileHours],
      ),
      rows(
        base +
          ` SELECT COUNT(*) count FROM sepay_transactions t LEFT JOIN all_orders o ON o.id=t.order_id WHERE t.result IN ('UNMATCHED','ACCOUNT_MISMATCH','OVERPAID','PARTIAL','PAYMENT_REVIEW') AND t.created_at>=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 7 DAY)${f.region ? " AND o.region=?" : ""}${f.meal ? " AND o.meal_id=?" : ""}`,
        s.values,
      ),
      rows(
        base +
          ` SELECT o.id,o.code,o.chef_name,o.status,o.payment_status,o.total,o.created_at,(SELECT SUM(quantity) FROM order_items WHERE order_id=o.id) servings FROM all_orders o WHERE 1=1${s.sql} ORDER BY o.created_at DESC LIMIT 8`,
        s.values,
      ),
    ]);
  const payments = await rows(
    base +
      ` SELECT e.id,e.order_id,o.code,o.chef_name,e.kind,e.status,e.amount,e.created_at,d.submitted_at,d.evidence_asset_id FROM payment_exceptions e JOIN all_orders o ON o.id=e.order_id LEFT JOIN payment_request_details d ON d.exception_id=e.id WHERE e.status IN ('OPEN','REVIEW') AND (e.actor_id<>o.user_id OR d.exception_id IS NOT NULL)${s.sql} ORDER BY CASE WHEN e.status='REVIEW' THEN 0 ELSE 1 END,e.created_at LIMIT 20`,
    s.values,
  );
  const transactions = await rows(
    `SELECT t.transaction_id,t.chef_id,c.name chef_name,t.order_id,t.result,t.amount,t.created_at,d.failure_reason FROM sepay_transactions t JOIN chefs c ON c.id=t.chef_id LEFT JOIN sepay_transaction_details d ON d.chef_id=t.chef_id AND d.transaction_id=t.transaction_id ${f.region || f.meal ? "JOIN orders o ON o.id=t.order_id" : ""} WHERE t.result IN ('UNMATCHED','ACCOUNT_MISMATCH','OVERPAID','PARTIAL','PAYMENT_REVIEW') AND t.created_at>=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 7 DAY)${f.region ? " AND CONCAT(ROUND(o.lat*50),':',ROUND(o.lng*50))=?" : ""}${f.meal ? " AND o.meal_id=?" : ""} ORDER BY t.created_at DESC LIMIT 20`,
    s.values,
  );
  return {
    supply: supply[0],
    live: live[0],
    overduePaid: Number(lateCount[0].count),
    late,
    refunds,
    pending: pending[0],
    unmatched: Number(unmatched[0].count),
    payments,
    transactions,
    recent,
    sla,
    updatedAt: new Date().toISOString(),
  };
}
async function performance(f: AnalyticsFilter) {
  const cr = selected(f),
    co = selected(f, "completed_at");
  const [chefs, products, regions] = await Promise.all([
    rows(
      base +
        `, chef_counts AS (SELECT o.chef_id,COUNT(*) placed,SUM(o.status IN ('CANCELLED','REJECTED')) cancelled,AVG(CASE WHEN o.accepted_at>=o.payment_confirmed_at THEN TIMESTAMPDIFF(SECOND,o.payment_confirmed_at,o.accepted_at)/60 END) accept_minutes FROM all_orders o WHERE ${cr.sql} GROUP BY o.chef_id), chef_sales AS (SELECT o.chef_id,COUNT(*) completed,SUM(o.subtotal-o.discount) gmv FROM all_orders o WHERE ${co.sql} GROUP BY o.chef_id)
    SELECT c.id,c.name,c.area,c.status,COALESCE(n.placed,0) placed,COALESCE(n.cancelled,0) cancelled,n.accept_minutes,COALESCE(d.completed,0) completed,COALESCE(d.gmv,0) gmv,c.rating,c.rating_count,
    (SELECT COUNT(DISTINCT k.service_date) FROM kitchen_sessions k WHERE k.chef_id=c.id AND k.service_date>=? AND k.service_date<=? AND EXISTS(SELECT 1 FROM daily_menu m WHERE m.session_id=k.id${f.meal ? " AND m.meal_id=?" : ""})) menu_days,
    (SELECT COUNT(*) FROM payment_exceptions e JOIN orders x ON x.id=e.order_id WHERE x.chef_id=c.id AND e.status IN ('OPEN','REVIEW')) requests,
    (SELECT MAX(k.service_date) FROM kitchen_sessions k WHERE k.chef_id=c.id AND EXISTS(SELECT 1 FROM daily_menu m WHERE m.session_id=k.id)) last_menu,
    (SELECT MIN(a.created_at) FROM audit_logs a WHERE a.action='chef.status' AND a.entity_id=c.id AND JSON_UNQUOTE(JSON_EXTRACT(a.detail,'$.status'))='approved') approved_at,
    (SELECT MIN(x.created_at) FROM orders x WHERE x.chef_id=c.id) first_order_at
    FROM chefs c LEFT JOIN chef_counts n ON n.chef_id=c.id LEFT JOIN chef_sales d ON d.chef_id=c.id
    WHERE ${f.region ? "n.chef_id IS NOT NULL OR d.chef_id IS NOT NULL" : "1=1"} ORDER BY gmv DESC,completed DESC,c.id`,
      [...cr.values, ...co.values, f.from, f.to, ...(f.meal ? [f.meal] : [])],
    ),
    rows(
      base +
        ` SELECT oi.product_id id,MAX(oi.name) name,MAX(oi.image_url) image_url,MAX(o.chef_name) chef_name,COUNT(DISTINCT o.id) orders,SUM(oi.quantity) servings,
    SUM(oi.unit_price*oi.quantity*(CASE WHEN o.subtotal>0 THEN (o.subtotal-o.discount)/o.subtotal ELSE 0 END)) gmv,
    (SELECT p.rating FROM products p WHERE p.id=oi.product_id) rating,(SELECT p.rating_count FROM products p WHERE p.id=oi.product_id) rating_count
    FROM order_items oi JOIN all_orders o ON o.id=oi.order_id WHERE ${co.sql} GROUP BY oi.product_id ORDER BY servings DESC,oi.product_id LIMIT 30`,
      co.values,
    ),
    rows(
      base +
        ` SELECT o.region,COUNT(*) placed,SUM(o.status='COMPLETED') completed,COUNT(DISTINCT o.user_id) buyers,COUNT(DISTINCT o.chef_id) chefs,AVG(o.distance_km) distance,SUM(o.status IN ('CANCELLED','REJECTED')) cancelled FROM all_orders o WHERE ${cr.sql} GROUP BY o.region ORDER BY placed DESC`,
      cr.values,
    ),
  ]);
  return {
    chefs,
    products,
    regions: regions.map((r) => ({
      ...r,
      label: regionLabel(String(r.region)),
    })),
  };
}
async function growth(f: AnalyticsFilter) {
  const co = selected(f, "completed_at"),
    e = selected(f, "created_at", "e"),
    s = segment(f);
  const [
    events,
    productViews,
    demand,
    vouchers,
    campaigns,
    cohorts,
    sources,
    costs,
  ] = await Promise.all([
    rows(
      `SELECT e.event_name,COUNT(*) events,COUNT(DISTINCT e.session_id) sessions FROM analytics_events e WHERE ${e.sql} GROUP BY e.event_name`,
      e.values,
    ),
    rows(
      `SELECT e.product_id,COUNT(DISTINCT CASE WHEN e.event_name='dish_view' THEN e.session_id END) views,COUNT(DISTINCT CASE WHEN e.event_name='cart_add' THEN e.session_id END) adds FROM analytics_events e WHERE ${e.sql} AND e.product_id IS NOT NULL GROUP BY e.product_id`,
      e.values,
    ),
    rows(
      `SELECT e.region,MAX(e.area) area,COUNT(DISTINCT e.session_id) sessions,COUNT(DISTINCT CASE WHEN e.result_count=0 THEN e.session_id END) empty_sessions FROM analytics_events e WHERE ${e.sql} AND e.event_name='catalog' AND e.region<>'' GROUP BY e.region ORDER BY empty_sessions DESC,sessions DESC LIMIT 30`,
      e.values,
    ),
    rows(
      base +
        ` SELECT v.id,v.code,v.title,COUNT(*) completed,COUNT(DISTINCT CASE WHEN fo.first_at=o.completed_at THEN o.user_id END) new_buyers,
        COUNT(DISTINCT CASE WHEN fo.first_at=o.completed_at AND fo.first_at<=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 30 DAY) THEN o.user_id END) eligible,
        COUNT(DISTINCT CASE WHEN fo.first_at=o.completed_at AND fo.first_at<=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 30 DAY) AND EXISTS(SELECT 1 FROM all_orders n WHERE n.user_id=o.user_id AND n.completed_at>fo.first_at AND n.completed_at<=DATE_ADD(fo.first_at,INTERVAL 30 DAY)) THEN o.user_id END) returned,
        SUM(o.subtotal-o.discount) gmv,SUM(o.discount) discount,'chef' funding FROM all_orders o JOIN vouchers v ON v.id=o.voucher_id JOIN first_orders fo ON fo.user_id=o.user_id WHERE ${co.sql} GROUP BY v.id,v.code,v.title ORDER BY completed DESC`,
      co.values,
    ),
    rows(
      base +
        ` SELECT x.campaign_id id,MAX(x.campaign_name) name,COUNT(*) completed,COUNT(DISTINCT CASE WHEN fo.first_at=o.completed_at THEN o.user_id END) new_buyers,
        COUNT(DISTINCT CASE WHEN fo.first_at=o.completed_at AND fo.first_at<=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 30 DAY) THEN o.user_id END) eligible,
        COUNT(DISTINCT CASE WHEN fo.first_at=o.completed_at AND fo.first_at<=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 30 DAY) AND EXISTS(SELECT 1 FROM all_orders n WHERE n.user_id=o.user_id AND n.completed_at>fo.first_at AND n.completed_at<=DATE_ADD(fo.first_at,INTERVAL 30 DAY)) THEN o.user_id END) returned,
        SUM(o.subtotal-o.discount) gmv,SUM(x.sale_discount) discount,MAX(x.funding) funding FROM analytics_order_context x JOIN all_orders o ON o.id=x.order_id JOIN first_orders fo ON fo.user_id=o.user_id WHERE ${co.sql} AND x.campaign_id IS NOT NULL GROUP BY x.campaign_id ORDER BY completed DESC`,
      co.values,
    ),
    rows(
      base +
        ` SELECT DATE_FORMAT(DATE_ADD(fo.first_at,INTERVAL 7 HOUR),'%Y-%m') month,COUNT(DISTINCT o.user_id) buyers,
    COUNT(DISTINCT CASE WHEN fo.first_at<=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 30 DAY) THEN o.user_id END) eligible,
    COUNT(DISTINCT CASE WHEN fo.first_at<=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 30 DAY) AND EXISTS(SELECT 1 FROM all_orders n WHERE n.user_id=o.user_id AND n.completed_at>fo.first_at AND n.completed_at<=DATE_ADD(fo.first_at,INTERVAL 30 DAY)) THEN o.user_id END) returned
    FROM all_orders o JOIN first_orders fo ON fo.user_id=o.user_id AND fo.first_at=o.completed_at WHERE ${co.sql} GROUP BY month ORDER BY month`,
      co.values,
    ),
    rows(
      base +
        ` SELECT COALESCE(NULLIF(x.source,''),'Không xác định') source,COUNT(*) completed,COUNT(DISTINCT CASE WHEN fo.first_at=o.completed_at THEN o.user_id END) new_buyers,SUM(o.subtotal-o.discount) gmv FROM all_orders o JOIN first_orders fo ON fo.user_id=o.user_id LEFT JOIN analytics_order_context x ON x.order_id=o.id WHERE ${co.sql} GROUP BY source ORDER BY completed DESC`,
      co.values,
    ),
    rows(
      `SELECT * FROM growth_costs WHERE spent_on>=? AND spent_on<=?${f.region ? " AND region=?" : ""}${f.meal ? " AND meal_id=?" : ""} ORDER BY spent_on DESC,created_at DESC`,
      [f.from, f.to, ...s.values],
    ),
  ]);
  // Session funnels use ordered events in the same tracked session, not unrelated event totals.
  const funnel = await rows(
    `WITH scoped AS (SELECT e.* FROM analytics_events e WHERE ${e.sql}),
    catalogs AS (SELECT session_id,MIN(CASE WHEN event_name='catalog' AND result_count>0 THEN created_at END) catalog_at FROM scoped GROUP BY session_id),
    viewed AS (SELECT s.*,(SELECT MIN(e.created_at) FROM scoped e WHERE e.session_id=s.session_id AND e.event_name='dish_view' AND e.created_at>=s.catalog_at) view_at FROM catalogs s),
    carted AS (SELECT s.*,(SELECT MIN(e.created_at) FROM scoped e WHERE e.session_id=s.session_id AND e.event_name='cart_add' AND e.created_at>=s.catalog_at) cart_at FROM viewed s),
    session_steps AS (SELECT s.*,(SELECT MIN(e.created_at) FROM scoped e WHERE e.session_id=s.session_id AND e.event_name='checkout' AND e.created_at>=s.cart_at) checkout_at FROM carted s),
    matched AS (SELECT s.*,MIN(o.created_at) order_at,MAX(o.payment_confirmed_at IS NOT NULL) paid,MAX(o.status='COMPLETED') completed
    FROM session_steps s LEFT JOIN analytics_order_context x ON x.session_id=s.session_id LEFT JOIN orders o ON o.id=x.order_id AND o.created_at>=s.checkout_at AND o.created_at>=? AND o.created_at<?${f.region ? " AND CONCAT(ROUND(o.lat*50),':',ROUND(o.lng*50))=?" : ""}${f.meal ? " AND o.meal_id=?" : ""} GROUP BY s.session_id,s.catalog_at,s.view_at,s.cart_at,s.checkout_at)
    SELECT COUNT(*) tracked,SUM(catalog_at IS NOT NULL) catalog,
    SUM(view_at>=catalog_at) viewed,SUM(cart_at>=catalog_at) cart,
    SUM(cart_at>=catalog_at AND checkout_at>=cart_at) checkout,
    SUM(cart_at>=catalog_at AND checkout_at>=cart_at AND order_at>=checkout_at) ordered,
    SUM(cart_at>=catalog_at AND checkout_at>=cart_at AND order_at>=checkout_at AND paid=1) paid,
    SUM(cart_at>=catalog_at AND checkout_at>=cart_at AND order_at>=checkout_at AND completed=1) completed FROM matched`,
    [...e.values, ...bounds(f), ...s.values],
  );
  const available = availableMenus({ ...f, region: "" });
  const kitchens = await rows<{
    lat: number;
    lng: number;
    radius_km: number;
    id: string;
  }>(
    `SELECT DISTINCT c.id,c.lat,c.lng,c.radius_km ${available.sql}`,
    available.values,
  );
  const { haversine } = await import("./domain");
  const coverage = demand.map((r) => {
    const [lat, lng] = String(r.region)
      .split(":")
      .map((n) => Number(n) / 50);
    return {
      ...r,
      label: r.area || regionLabel(String(r.region)),
      serving_chefs: kitchens.filter(
        (c) =>
          haversine({ lat, lng }, { lat: Number(c.lat), lng: Number(c.lng) }) <=
          Number(c.radius_km),
      ).length,
    };
  });
  const [tracking] = await rows(
    "SELECT MIN(created_at) started_at FROM analytics_events",
  );
  return {
    events,
    productViews,
    demand: coverage,
    vouchers,
    campaigns,
    cohorts,
    sources,
    costs,
    funnel: funnel[0],
    trackingStartedAt: tracking.started_at,
  };
}

export const slaSchema = z.object({
  acceptMinutes: z.number().int().min(1).max(240),
  profileHours: z.number().int().min(1).max(720),
  refundHours: z.number().int().min(1).max(720),
});
const goalSchema = z.object({
  title: z.string().trim().min(2).max(150),
  metric: z.enum(
    Object.keys(GOAL_METRICS) as [
      keyof typeof GOAL_METRICS,
      ...(keyof typeof GOAL_METRICS)[],
    ],
  ),
  baseline: z.number().finite().min(0),
  target: z.number().finite().min(0),
  from: z.string(),
  to: z.string(),
  region: z.string().default(""),
  meal: z.string().default(""),
});
const costSchema = z.object({
  title: z.string().trim().min(2).max(150),
  kind: z.enum(["marketing", "platform", "promotion"]),
  amount: z.number().int().min(1).max(1e12),
  spentOn: z.string(),
  source: z.string().trim().max(100).default(""),
  region: z.string().default(""),
  meal: z.string().default(""),
});
function goalFilter(from: string, to: string, region: string, meal: string) {
  const now = new Date(
    Math.max(Date.now(), Date.parse(to + "T12:00:00+07:00")),
  );
  try {
    return analyticsFilter(
      new URLSearchParams({ from, to, region, meal }),
      now,
    );
  } catch (e) {
    throw new AppError((e as Error).message);
  }
}
async function goals() {
  const list = await rows<{
    id: string;
    title: string;
    metric: keyof typeof GOAL_METRICS;
    baseline: number;
    target: number;
    from_date: string;
    to_date: string;
    region: string;
    meal_id: string;
  }>(
    "SELECT * FROM admin_goals ORDER BY to_date DESC,created_at DESC LIMIT 50",
  );
  const result = [];
  // Bounded sequential queries share cached reports across equal goal windows.
  const memo = new Map<string, Awaited<ReturnType<typeof metrics>>>();
  for (const g of list) {
    const f = {
      from: g.from_date,
      to: g.to_date,
      region: g.region,
      meal: g.meal_id,
    };
    const key = JSON.stringify(f);
    let m = memo.get(key);
    if (!m) {
      m = await metrics(f);
      memo.set(key, m);
    }
    result.push({ ...g, current: m[g.metric] });
  }
  return { goals: result };
}
export async function mutateAnalytics(
  user: Actor,
  action: string,
  input: unknown,
  id?: string,
) {
  if (user.role !== "admin")
    throw new AppError("Không có quyền quản trị.", 403);
  await ensureAnalyticsSchema();
  if (action === "sla") {
    const b = slaSchema.parse(input);
    await exec(
      "INSERT INTO platform_settings VALUES ('analytics_sla',?) ON DUPLICATE KEY UPDATE value=VALUES(value)",
      [JSON.stringify(b)],
    );
  } else if (action === "goals") {
    const b = goalSchema.parse(input);
    goalFilter(b.from, b.to, b.region, b.meal);
    if (b.baseline === b.target)
      throw new AppError("Mục tiêu cần khác mốc ban đầu.");
    if (
      ["repeat30", "cancelRate"].includes(b.metric) &&
      (b.baseline > 100 || b.target > 100)
    )
      throw new AppError("Tỷ lệ phải từ 0 đến 100%.");
    if (b.metric === "cancelRate" && b.target >= b.baseline)
      throw new AppError("Mục tiêu tỷ lệ hủy cần thấp hơn mốc ban đầu.");
    if (b.metric !== "cancelRate" && b.target <= b.baseline)
      throw new AppError("Mục tiêu cần cao hơn mốc ban đầu.");
    await exec("INSERT INTO admin_goals VALUES (?,?,?,?,?,?,?,?,?,?,?)", [
      randomUUID(),
      b.title,
      b.metric,
      b.baseline,
      b.target,
      b.from,
      b.to,
      b.region,
      b.meal,
      user.id,
      sqlDate(),
    ]);
  } else if (action === "costs") {
    const b = costSchema.parse(input);
    if (!validDate(b.spentOn) || b.spentOn > serviceDate())
      throw new AppError("Ngày chi phí không hợp lệ.");
    goalFilter(b.spentOn, b.spentOn, b.region, b.meal);
    await exec("INSERT INTO growth_costs VALUES (?,?,?,?,?,?,?,?,?,?)", [
      randomUUID(),
      b.title,
      b.kind,
      b.amount,
      b.spentOn,
      b.source,
      b.region,
      b.meal,
      user.id,
      sqlDate(),
    ]);
  } else if (action === "delete-goal" || action === "delete-cost") {
    if (!id || !z.uuid().safeParse(id).success)
      throw new AppError("Mã bản ghi không hợp lệ.");
    await exec(
      `DELETE FROM ${action === "delete-goal" ? "admin_goals" : "growth_costs"} WHERE id=?`,
      [id],
    );
  } else throw new AppError("Thao tác không hợp lệ.");
  await exec("INSERT INTO audit_logs VALUES (?,?,?,?,?,?)", [
    randomUUID(),
    user.id,
    "analytics." + action,
    id || null,
    JSON.stringify(input),
    sqlDate(),
  ]);
  cache.clear();
  return { ok: true };
}
const cache = new Map<
  string,
  { expires: number; data: unknown; refreshToken: string }
>();
const inflight = new Map<string, Promise<unknown>>();
export async function adminAnalytics(section: string, params: URLSearchParams) {
  let f: AnalyticsFilter;
  try {
    f = analyticsFilter(params);
  } catch (e) {
    throw new AppError((e as Error).message);
  }
  const handlers = { summary, trends, operations, performance, growth, goals };
  if (!Object.hasOwn(handlers, section))
    throw new AppError("Báo cáo không tồn tại.", 404);
  await ensureAnalyticsSchema();
  const key = section + JSON.stringify(f),
    refreshToken = params.get("fresh") || "";
  const hit = cache.get(key);
  const fresh =
    refreshToken === "1" ||
    (!!refreshToken && refreshToken !== hit?.refreshToken);
  if (!fresh && hit && hit.expires > Date.now()) return hit.data;
  if (!fresh && inflight.has(key)) return inflight.get(key);
  const promise = handlers[section as keyof typeof handlers](f)
    .then((data) => {
      if (cache.size > 100) cache.clear();
      cache.set(key, {
        expires: Date.now() + (section === "operations" ? 0 : 20000),
        data,
        refreshToken,
      });
      return data;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}
