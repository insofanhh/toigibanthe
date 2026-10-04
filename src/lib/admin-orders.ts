import { z } from "zod";
import { rows, exec, transaction, sqlDate } from "./db";
import { AppError } from "./http";
import {
  ACTIVE_ORDER_STATUSES,
  ORDER_LABELS,
  ORDER_NEXT,
  type Actor,
} from "./domain";
import {
  dateBounds,
  previousFilter,
  shiftDate,
  metricDelta,
  regionLabel,
} from "./analytics-domain";
import {
  orderReportFilter,
  orderAlerts,
  orderAge,
  ORDER_REPORT_PANELS,
  type OrderReportFilter,
  type OrderReportRow,
} from "./admin-orders-domain";
import {
  orderLedger,
  orderMasterScope,
  orderRegionSQL,
} from "./order-report-ledger";
import { ensureSePaySchema } from "./sepay-schema";
import { ensurePaymentRequestSchema } from "./payment-request-store";
import { ensureOrderReportIndexes } from "./order-report-schema";
import { analyticsLive, slaSchema } from "./analytics";
import { audit } from "./manage";
type R = OrderReportRow;
export const orderThresholdSchema = z.object({
  acceptedMinutes: z.number().int().min(1).max(1440).default(15),
  preparingMinutes: z.number().int().min(1).max(1440).default(45),
  deliveringMinutes: z.number().int().min(1).max(1440).default(60),
  deliveredMinutes: z.number().int().min(1).max(2880).default(120),
  expiryGraceMinutes: z.number().int().min(0).max(60).default(5),
});
const numeric = new Set(
  "subtotal discount delivery_fee total item_gross item_quantity dish_count legacy_completed request_count refund_open refund_review open_requests bank_received transaction_count valid_transactions extra_transactions invalid_transactions late_accept long_stage money_issue late_money expiry_pending refund_overdue data_issue attention priority age_minutes active quantity unit_price amount count placed paid completed gmv cancelled rejected expired current previous_placed previous_paid previous_completed previous_gmv previous_cancelled previous_expired overdue oldest_minutes max_minutes servings buyers chefs delivery voucher paid_value auto_count manual_count unknown_count valid_amount invalid_amount unmatched_amount valid_count invalid_count unmatched_count mismatched_dates weekday hour samples missing excluded median p90 accept_samples accept_median accept_p90 incomplete legacy source_missing chef_missing net_value claimed_amount bank_amount automatic minutes".split(
    " ",
  ),
);
function numbers(r: R) {
  for (const [key, v] of Object.entries(r))
    if (v !== null && numeric.has(key)) r[key] = Number(v);
  return r;
}
const cache = new Map<string, { at: number; value: Promise<any> }>();
export function clearOrderReports() {
  cache.clear();
}
function parse(p: URLSearchParams, now: Date) {
  try {
    return orderReportFilter(p, now);
  } catch (e) {
    throw new AppError((e as Error).message);
  }
}
function interval(f: Pick<OrderReportFilter, "from" | "to">) {
  const b = dateBounds(f.from, f.to);
  return [`'${sqlDate(b.start)}'`, `'${sqlDate(b.end)}'`];
}
function during(col: string, f: Pick<OrderReportFilter, "from" | "to">) {
  const [a, b] = interval(f);
  return `(${col}>=${a} AND ${col}<${b})`;
}
const ACTIVE =
  "('PLACED','PAID','ACCEPTED','PREPARING','DELIVERING','DELIVERED')";
async function settings() {
  await ensureSePaySchema();
  await ensurePaymentRequestSchema(false);
  await ensureOrderReportIndexes();
  const a = await rows<R>(
    "SELECT id,value FROM platform_settings WHERE id IN ('order_analytics_thresholds','analytics_sla')",
  );
  const value = (id: string) => {
    const v = a.find((x) => x.id === id)?.value;
    return typeof v === "string" ? JSON.parse(v) : v;
  };
  return {
    thresholds: orderThresholdSchema.parse(
      value("order_analytics_thresholds") || {},
    ),
    sla: slaSchema.parse(
      value("analytics_sla") || {
        acceptMinutes: 10,
        profileHours: 48,
        refundHours: 24,
      },
    ),
  };
}
async function context(f: OrderReportFilter, now: Date, id?: string) {
  const config = await settings(),
    ledger = orderLedger(f, id),
    t = config.thresholds,
    sla = config.sla,
    when = `'${sqlDate(now)}'`,
    age = `TIMESTAMPDIFF(SECOND,l.stage_at,${when})/60`;
  const flags = `${ledger.sql}, flagged AS (SELECT l.*,
 CASE WHEN l.status IN ${ACTIVE} AND l.stage_at<=${when} THEN ${age} END age_minutes,
 l.status='PAID' AND l.stage_at IS NOT NULL AND ${age}>${sla.acceptMinutes} late_accept,
 l.status IN ('ACCEPTED','PREPARING','DELIVERING','DELIVERED') AND l.stage_at IS NOT NULL AND ${age}>CASE l.status WHEN 'ACCEPTED' THEN ${t.acceptedMinutes} WHEN 'PREPARING' THEN ${t.preparingMinutes} WHEN 'DELIVERING' THEN ${t.deliveringMinutes} ELSE ${t.deliveredMinutes} END long_stage,
 l.payment_status IN ('PARTIAL','PAYMENT_REVIEW','REFUND_PENDING') OR l.invalid_transactions>0 AND l.open_requests>0 money_issue,
 l.extra_transactions>0 AND l.open_requests>0 late_money,
 l.status='PLACED' AND l.expires_at<DATE_SUB(${when},INTERVAL ${t.expiryGraceMinutes} MINUTE) expiry_pending,
 l.oldest_request_at<DATE_SUB(${when},INTERVAL ${sla.refundHours} HOUR) refund_overdue,
 (l.status IN ${ACTIVE} AND (l.stage_at IS NULL OR l.stage_at>${when})) OR l.chef_name IS NULL OR l.item_quantity=0 OR l.item_gross<>l.subtotal OR l.total<>l.subtotal-l.discount+l.delivery_fee OR l.subtotal<l.discount OR l.paid_at<l.created_at OR l.accepted_at<l.paid_at OR l.preparing_at<l.accepted_at OR l.delivering_at<l.preparing_at OR l.delivered_at<l.delivering_at OR l.completed_at<l.delivered_at OR l.status NOT IN ('PLACED','PAID','ACCEPTED','PREPARING','DELIVERING','DELIVERED','COMPLETED','CANCELLED','REJECTED','EXPIRED') data_issue
 FROM ledger l), reported AS (SELECT f.*,COALESCE(late_accept,0) OR COALESCE(long_stage,0) OR COALESCE(money_issue,0) OR COALESCE(late_money,0) OR open_requests>0 OR COALESCE(expiry_pending,0) OR COALESCE(refund_overdue,0) OR COALESCE(data_issue,0) attention,
 CASE WHEN refund_overdue OR late_money THEN 0 WHEN late_accept OR money_issue THEN 1 WHEN long_stage OR open_requests>0 OR expiry_pending THEN 2 ELSE 3 END priority FROM flagged f)`;
  return { ...ledger, sql: flags, ...config, f, now };
}
type Context = Awaited<ReturnType<typeof context>>;
async function query(ctx: Context, tail: string, values: unknown[] = []) {
  return (await rows<R>(ctx.sql + " " + tail, [...ctx.values, ...values])).map(
    numbers,
  );
}
function fields() {
  return `r.id,r.code,r.chef_id,r.chef_name,r.customer_name,r.recipient,r.meal_id,r.region,r.status,r.payment_status,r.payment_source,r.created_at,r.paid_at,r.accepted_at,r.preparing_at,r.delivering_at,r.delivered_at,r.completed_at,r.stage_at,r.age_minutes,r.expires_at,r.subtotal,r.discount,r.delivery_fee,r.total,r.dish_image,r.dish_names,r.item_quantity,r.dish_count,r.item_gross,r.bank_received,r.valid_transactions,r.transaction_count,r.invalid_transactions,r.extra_transactions,r.request_count,r.open_requests,r.refund_open,r.refund_review,r.oldest_request_at,r.cancel_actor,r.cancel_note,r.late_accept,r.long_stage,r.money_issue,r.late_money,r.expiry_pending,r.refund_overdue,r.data_issue,r.attention,r.priority,r.legacy_completed,r.distance_km,r.route_distance_km`;
}
function row(r: R, now: Date) {
  r.alerts = orderAlerts(r);
  r.age_minutes = orderAge(r, now);
  return r;
}
async function paginate(
  ctx: Context,
  sql: string,
  sort: string,
  page = ctx.f.page,
  values: unknown[] = [],
) {
  const [count] = await query(
      ctx,
      `SELECT COUNT(*) total FROM (${sql}) records`,
      values,
    ),
    total = Number(count.total),
    pages = Math.max(1, Math.ceil(total / 20)),
    n = Math.min(page, pages),
    items = await query(ctx, sql + ` ORDER BY ${sort} LIMIT 20 OFFSET ?`, [
      ...values,
      (n - 1) * 20,
    ]);
  return { items, total, pages, page: n, pageSize: 20 };
}
function listConditions(f: OrderReportFilter) {
  const clauses = [
      f.scope === "period"
        ? during(
            "r." +
              {
                created: "created_at",
                paid: "paid_at",
                completed: "completed_at",
              }[f.dateBy],
            f,
          )
        : "1=1",
    ],
    values: unknown[] = [];
  if (f.status !== "all") {
    clauses.push("r.status=?");
    values.push(f.status);
  }
  if (f.payment !== "all") {
    clauses.push("r.payment_status=?");
    values.push(f.payment);
  }
  if (f.source !== "all") {
    clauses.push("r.payment_source=?");
    values.push(f.source);
  }
  if (f.actor !== "all") {
    clauses.push(
      "r.status IN ('CANCELLED','REJECTED','EXPIRED') AND r.cancel_actor=?",
    );
    values.push(f.actor);
  }
  const group = {
    all: "1=1",
    active: `r.status IN ${ACTIVE}`,
    attention: "r.attention",
    cancelled: "r.status IN ('CANCELLED','REJECTED')",
    money: "r.money_issue OR r.late_money OR r.invalid_transactions>0",
    requests: "r.open_requests>0",
    paid: "r.paid_at IS NOT NULL",
    unknown:
      "r.status NOT IN ('PLACED','PAID','ACCEPTED','PREPARING','DELIVERING','DELIVERED','COMPLETED','CANCELLED','REJECTED','EXPIRED')",
  }[f.group];
  clauses.push("(" + group + ")");
  return { sql: clauses.join(" AND "), values };
}
export async function saveOrderThresholds(user: Actor, input: unknown) {
  if (user.role !== "admin")
    throw new AppError("Không có quyền quản trị.", 403);
  const b = orderThresholdSchema.parse(input);
  await transaction(async (db) => {
    await exec(
      "INSERT INTO platform_settings VALUES ('order_analytics_thresholds',?) ON DUPLICATE KEY UPDATE value=VALUES(value)",
      [JSON.stringify(b)],
      db,
    );
    await audit(db, user, "order.analytics.thresholds", null, b);
    await analyticsLive(db, user.id);
  });
  clearOrderReports();
  return { ok: true };
}
export async function adminOrderAnalytics(
  section: string,
  params: URLSearchParams,
  now = new Date(),
): Promise<any> {
  if (
    ![
      "summary",
      "trends",
      "operations",
      "list",
      "performance",
      "payments",
    ].includes(section)
  )
    throw new AppError("Báo cáo đơn không hợp lệ.", 404);
  const f = parse(params, now),
    key = JSON.stringify([
      section,
      f,
      params.get("v"),
      params.get("chefPage"),
      params.get("regionPage"),
    ]),
    old = cache.get(key),
    cached = ["trends", "performance"].includes(section);
  if (cached && !params.has("fresh") && old && Date.now() - old.at < 20000)
    return old.value;
  const value = report(section, f, params, now);
  if (cached) {
    if (cache.size >= 12) cache.clear();
    cache.set(key, { at: Date.now(), value });
  }
  try {
    return await value;
  } catch (e) {
    if (cache.get(key)?.value === value) cache.delete(key);
    throw e;
  }
}
async function report(
  section: string,
  f: OrderReportFilter,
  params: URLSearchParams,
  now: Date,
) {
  const ctx = await context(f, now),
    prev = previousFilter(f),
    cr = during("r.created_at", f),
    co = during("r.completed_at", f),
    pa = during("r.paid_at", f);
  if (section === "list") {
    const where = listConditions(f),
      sort = {
        newest: `r.${f.dateBy === "created" ? "created_at" : f.dateBy === "paid" ? "paid_at" : "completed_at"} DESC,r.id`,
        oldest: `r.${f.dateBy === "created" ? "created_at" : f.dateBy === "paid" ? "paid_at" : "completed_at"} ASC,r.id`,
        waiting: "r.age_minutes DESC,r.id",
        amount: "r.subtotal-r.discount DESC,r.id",
        priority: "r.priority,r.age_minutes DESC,r.id",
      }[f.sort],
      page = await paginate(
        ctx,
        `SELECT ${fields()} FROM reported r WHERE ${where.sql}`,
        sort,
        f.page,
        where.values,
      );
    return {
      ...page,
      orders: page.items.map((r) => row(r, now)),
      scope: f.scope,
      dateBy: f.dateBy,
      updatedAt: now.toISOString(),
    };
  }
  if (section === "summary") {
    const agg = (range: Pick<OrderReportFilter, "from" | "to">, prefix = "") =>
      [
        `SUM(${during("r.created_at", range)}) ${prefix}placed`,
        `SUM(${during("r.paid_at", range)}) ${prefix}paid`,
        `SUM(${during("r.completed_at", range)}) ${prefix}completed`,
        `SUM(CASE WHEN ${during("r.completed_at", range)} THEN r.subtotal-r.discount ELSE 0 END) ${prefix}gmv`,
        `SUM(${during("r.created_at", range)} AND r.status IN ('CANCELLED','REJECTED')) ${prefix}cancelled`,
        `SUM(${during("r.created_at", range)} AND r.status='EXPIRED') ${prefix}expired`,
      ].join(",");
    const [r] = await query(
      ctx,
      `SELECT ${agg(f)},${agg(prev, "previous_")},SUM(r.status IN ${ACTIVE}) current,SUM(r.attention) attention,SUM(${cr} AND r.status='REJECTED') rejected,SUM(${co} AND r.legacy_completed) legacy,SUM(${pa} AND r.payment_source='unknown') source_missing,SUM(r.chef_name IS NULL) chef_missing FROM reported r`,
    );
    const metrics = Object.fromEntries(
        [
          "placed",
          "paid",
          "completed",
          "gmv",
          "cancelled",
          "expired",
          "current",
          "attention",
        ].map((k) => [k, Number(r[k] || 0)]),
      ),
      previous = Object.fromEntries(
        ["placed", "paid", "completed", "gmv", "cancelled", "expired"].map(
          (k) => [k, Number(r["previous_" + k] || 0)],
        ),
      );
    const chefs = await rows<R>(
      "SELECT DISTINCT o.chef_id id,COALESCE(c.name,'Bếp không còn hồ sơ') name FROM orders o LEFT JOIN chefs c ON c.id=o.chef_id ORDER BY name,o.chef_id",
    );
    // Selector options are global so an active filter cannot remove its alternatives.
    const regionOptions = await rows<R>(
      `SELECT DISTINCT ${orderRegionSQL()} region FROM orders o ORDER BY region`,
    );
    return {
      metrics,
      previous,
      delta: Object.fromEntries(
        Object.keys(previous).map((k) => [
          k,
          metricDelta(metrics[k], previous[k]),
        ]),
      ),
      rejected: Number(r.rejected || 0),
      quality: {
        legacy: Number(r.legacy || 0),
        sourceMissing: Number(r.source_missing || 0),
        chefMissing: Number(r.chef_missing || 0),
      },
      regions: regionOptions.map((r) => ({
        id: r.region,
        label: r.region === "unknown" ? "Chưa xác định" : regionLabel(r.region),
      })),
      chefs,
      thresholds: ctx.thresholds,
      sla: ctx.sla,
      updatedAt: now.toISOString(),
    };
  }
  if (section === "operations") {
    const [stages, page] = await Promise.all([
      query(
        ctx,
        `SELECT r.status,COUNT(*) count,SUM(r.attention) attention,SUM(r.late_accept OR r.long_stage) overdue,MAX(r.age_minutes) oldest_minutes,SUM(r.age_minutes IS NULL) missing FROM reported r WHERE r.status IN ${ACTIVE} GROUP BY r.status`,
      ),
      paginate(
        ctx,
        `SELECT ${fields()} FROM reported r WHERE r.attention`,
        "r.priority,r.age_minutes DESC,r.id",
      ),
    ]);
    return {
      ...page,
      alerts: page.items.map((r) => row(r, now)),
      stages,
      updatedAt: now.toISOString(),
    };
  }
  if (section === "trends") {
    const from = interval(prev)[0],
      to = interval(f)[1],
      daily = await query(
        ctx,
        `SELECT DATE(DATE_ADD(r.created_at,INTERVAL 7 HOUR)) day,COUNT(*) placed,0 completed,0 gmv FROM reported r WHERE r.created_at>=${from} AND r.created_at<${to} GROUP BY day UNION ALL SELECT DATE(DATE_ADD(r.completed_at,INTERVAL 7 HOUR)) day,0 placed,COUNT(*) completed,SUM(r.subtotal-r.discount) gmv FROM reported r WHERE r.completed_at>=${from} AND r.completed_at<${to} GROUP BY day`,
      ),
      map = new Map<string, R>();
    for (const r of daily) {
      const d = String(r.day).slice(0, 10),
        old = map.get(d) || { placed: 0, completed: 0, gmv: 0 };
      for (const k of ["placed", "completed", "gmv"])
        old[k] += Number(r[k] || 0);
      map.set(d, old);
    }
    const days = [];
    for (
      let day = f.from, old = prev.from;
      day <= f.to;
      day = shiftDate(day, 1), old = shiftDate(old, 1)
    ) {
      const a = map.get(day),
        b = map.get(old);
      days.push({
        day,
        previous_day: old,
        placed: a?.placed || 0,
        completed: a?.completed || 0,
        gmv: a?.gmv || 0,
        previous_placed: b?.placed || 0,
        previous_completed: b?.completed || 0,
        previous_gmv: b?.gmv || 0,
      });
    }
    const outcomes = await query(
      ctx,
      `SELECT CASE WHEN r.status IN ${ACTIVE} THEN 'ACTIVE' WHEN r.status IN ('COMPLETED','CANCELLED','REJECTED','EXPIRED') THEN r.status ELSE 'UNKNOWN' END status,COUNT(*) count FROM reported r WHERE ${cr} GROUP BY CASE WHEN r.status IN ${ACTIVE} THEN 'ACTIVE' WHEN r.status IN ('COMPLETED','CANCELLED','REJECTED','EXPIRED') THEN r.status ELSE 'UNKNOWN' END`,
    );
    return { days, outcomes, updatedAt: now.toISOString() };
  }
  if (section === "performance") return performance(ctx, params);
  return payments(ctx);
}
function extraPage(params: URLSearchParams, key: string) {
  const v = params.get(key) || "1";
  if (!/^[1-9]\d{0,6}$/.test(v))
    throw new AppError("Trang báo cáo không hợp lệ.");
  return Number(v);
}
function durationCandidates(ctx: Context, onlyChef = false) {
  const f = ctx.f,
    stages = [
      ["payment", "r.created_at", "r.paid_at", "1"],
      ["accept", "r.paid_at", "r.accepted_at", "r.payment_source='auto'"],
      ["prepare", "r.accepted_at", "r.preparing_at", "1"],
      ["dispatch", "r.preparing_at", "r.delivering_at", "1"],
      ["delivery", "r.delivering_at", "r.delivered_at", "1"],
      ["confirm", "r.delivered_at", "r.completed_at", "1"],
    ] as const;
  return stages
    .filter((s) => !onlyChef || s[0] === "accept")
    .map(
      ([key, start, end, eligible]) =>
        `SELECT '${key}' kind,r.chef_id,${eligible} eligible,${start} IS NOT NULL AND ${end}>=${start} AND ${start}>=r.created_at ${key === "confirm" ? "AND NOT r.legacy_completed" : ""} valid,TIMESTAMPDIFF(SECOND,${start},${end})/60 minutes FROM reported r WHERE ${during(end, f)}`,
    )
    .join(" UNION ALL ");
}
async function durations(ctx: Context, chefIds?: string[]) {
  const byChef = !!chefIds,
    group = byChef ? "kind,chef_id" : "kind",
    filter = byChef
      ? `WHERE c.chef_id IN (${chefIds!.length ? chefIds!.map(() => "?").join(",") : "NULL"})`
      : "";
  return query(
    ctx,
    `, candidates AS (${durationCandidates(ctx, byChef)}), counted AS (SELECT ${group},SUM(eligible AND valid) samples,SUM(eligible AND NOT COALESCE(valid,0)) missing,SUM(NOT eligible) excluded FROM candidates GROUP BY ${group}), ranked AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY ${group} ORDER BY minutes) rn,COUNT(*) OVER(PARTITION BY ${group}) n FROM candidates WHERE eligible AND valid), duration_stats AS (SELECT ${group},AVG(CASE WHEN rn IN (FLOOR((n+1)/2),FLOOR((n+2)/2)) THEN minutes END) median,CASE WHEN MAX(n)>=20 THEN MAX(CASE WHEN rn=CEIL(n*0.9) THEN minutes END) END p90 FROM ranked GROUP BY ${group}) SELECT c.*,s.median,s.p90 FROM counted c LEFT JOIN duration_stats s ON s.kind=c.kind ${byChef ? "AND s.chef_id=c.chef_id" : ""} ${filter}`,
    chefIds || [],
  );
}
async function performance(ctx: Context, params: URLSearchParams) {
  const f = ctx.f,
    cr = during("r.created_at", f),
    co = during("r.completed_at", f),
    relevant = `${cr} OR ${co} OR r.status IN ${ACTIVE} OR r.open_requests>0`,
    counts = `SUM(${cr}) placed,SUM(${cr} AND r.status='COMPLETED') completed,SUM(${cr} AND r.status='CANCELLED') cancelled,SUM(${cr} AND r.status='REJECTED') rejected,SUM(${cr} AND r.status='EXPIRED') expired,SUM(${cr} AND r.status IN ${ACTIVE}) incomplete,SUM(r.status IN ${ACTIVE}) current,SUM(r.late_accept) overdue,SUM(r.open_requests>0) requests,SUM(CASE WHEN ${co} THEN r.subtotal-r.discount ELSE 0 END) gmv`;
  const [heatmap, latencies, chefs, regions, cancellations, secondary] =
    await Promise.all([
      query(
        ctx,
        `SELECT WEEKDAY(DATE_ADD(r.created_at,INTERVAL 7 HOUR)) weekday,HOUR(DATE_ADD(r.created_at,INTERVAL 7 HOUR)) hour,COUNT(*) count FROM reported r WHERE ${cr} GROUP BY weekday,hour`,
      ),
      durations(ctx),
      paginate(
        ctx,
        `SELECT r.chef_id,COALESCE(r.chef_name,'Bếp thiếu hồ sơ') chef_name,${counts} FROM reported r WHERE ${relevant} GROUP BY r.chef_id,r.chef_name`,
        "placed DESC,r.chef_id",
        extraPage(params, "chefPage"),
      ),
      paginate(
        ctx,
        `SELECT r.region,r.meal_id,${counts},AVG(r.distance_km) distance_km,AVG(r.route_distance_km) route_distance_km FROM reported r WHERE ${relevant} GROUP BY r.region,r.meal_id`,
        "placed DESC,r.region,r.meal_id",
        extraPage(params, "regionPage"),
      ),
      query(
        ctx,
        `SELECT r.status,r.cancel_actor,COUNT(*) count,SUM(r.paid_at IS NOT NULL) paid FROM reported r WHERE ${cr} AND r.status IN ('CANCELLED','REJECTED','EXPIRED') GROUP BY r.status,r.cancel_actor`,
      ),
      query(
        ctx,
        `SELECT COUNT(DISTINCT CASE WHEN ${cr} THEN r.user_id END) buyers,COUNT(DISTINCT CASE WHEN ${cr} THEN r.chef_id END) chefs,SUM(CASE WHEN ${co} THEN r.item_quantity ELSE 0 END) servings,SUM(CASE WHEN ${co} THEN r.delivery_fee ELSE 0 END) delivery,SUM(CASE WHEN ${co} THEN r.discount ELSE 0 END) voucher,SUM(${co}) completed,SUM(CASE WHEN ${co} THEN r.subtotal-r.discount ELSE 0 END) gmv FROM reported r`,
      ),
    ]);
  const byChef = await durations(
    ctx,
    chefs.items.map((c) => c.chef_id),
  );
  return {
    heatmap,
    durations: latencies,
    chefs: {
      ...chefs,
      items: chefs.items.map((c) => ({
        ...c,
        latency: byChef.find((s) => s.chef_id === c.chef_id) || {
          samples: 0,
          median: null,
          p90: null,
        },
      })),
    },
    regions: {
      ...regions,
      items: regions.items.map((c) => ({
        ...c,
        label: c.region === "unknown" ? "Chưa xác định" : regionLabel(c.region),
      })),
    },
    cancellations,
    secondary: secondary[0],
    minSamples: 20,
    updatedAt: ctx.now.toISOString(),
  };
}
const validTx =
  "t.result IN ('PARTIAL','PAID','OVERPAID','LATE','EXTRA_PAYMENT') AND t.chef_id=o.chef_id AND t.bank_bin=o.bank_bin AND t.account_number=o.account_no AND COALESCE(d.sub_account,'')=''";
async function payments(ctx: Context) {
  const f = ctx.f,
    scope = orderMasterScope(f),
    date = f.txDate === "bank" ? "t.transaction_date" : "t.created_at",
    where: string[] = [during(date, f)],
    values: unknown[] = [];
  if (f.txGroup === "unmatched") {
    where.push("o.id IS NULL");
    if (f.chef) {
      where.push("t.chef_id=?");
      values.push(f.chef);
    }
  } else {
    where.push("o.id IS NOT NULL", scope.sql);
    values.push(...scope.values);
    if (f.txGroup === "valid") where.push(validTx);
    if (f.txGroup === "invalid")
      where.push("NOT COALESCE((" + validTx + "),0)");
    if (f.txGroup === "extra")
      where.push("t.result IN ('LATE','EXTRA_PAYMENT')");
  }
  if (f.txQ) {
    where.push(
      "LOCATE(LOWER(?),LOWER(CONCAT_WS(' ',t.transaction_id,t.content,t.reference_code)))>0",
    );
    values.push(f.txQ);
  }
  const from = `FROM sepay_transactions t LEFT JOIN orders o ON o.id=t.order_id LEFT JOIN chefs c ON c.id=o.chef_id LEFT JOIN users u ON u.id=o.user_id LEFT JOIN chefs tc ON tc.id=t.chef_id LEFT JOIN sepay_transaction_details d ON d.chef_id=t.chef_id AND d.transaction_id=t.transaction_id WHERE ${where.join(" AND ")}`;
  const [totals, confirmed, tx, requests] = await Promise.all([
    rows<R>(
      `SELECT COUNT(*) count,SUM(CASE WHEN ${validTx} THEN t.amount ELSE 0 END) valid_amount,SUM(CASE WHEN o.id IS NULL THEN t.amount ELSE 0 END) unmatched_amount,SUM(CASE WHEN o.id IS NOT NULL AND NOT COALESCE((${validTx}),0) THEN t.amount ELSE 0 END) invalid_amount,SUM(DATE(DATE_ADD(t.transaction_date,INTERVAL 7 HOUR))<>DATE(DATE_ADD(t.created_at,INTERVAL 7 HOUR))) mismatched_dates ${from}`,
      values,
    ),
    query(
      ctx,
      `SELECT COUNT(*) count,COALESCE(SUM(r.total),0) paid_value,SUM(r.payment_source='auto') auto_count,SUM(r.payment_source='manual') manual_count,SUM(r.payment_source='unknown') unknown_count FROM reported r WHERE ${during("r.paid_at", f)}`,
    ),
    paginate(
      ctx,
      `SELECT t.transaction_id,t.chef_id,COALESCE(tc.name,'Bếp thiếu hồ sơ') chef_name,t.order_id,o.code,t.amount,t.result,t.transaction_date,t.created_at,t.content,t.reference_code,d.failure_reason,CONCAT('••••',RIGHT(t.account_number,4)) account_mask,${validTx} valid_receipt ${from}`,
      "t.transaction_date DESC,t.chef_id,t.transaction_id",
      f.page,
      values,
    ),
    query(
      ctx,
      "SELECT COUNT(DISTINCT order_id) orders,COUNT(*) count,COALESCE(SUM(amount),0) claimed_amount FROM request_rows WHERE status IN ('OPEN','REVIEW')",
    ),
  ]);
  return {
    ...tx,
    transactions: tx.items,
    totals: numbers(totals[0]),
    confirmed: confirmed[0],
    requests: requests[0],
    txGroup: f.txGroup,
    txDate: f.txDate,
    scopeIgnored: f.txGroup === "unmatched" && !!(f.meal || f.region || f.q),
    updatedAt: ctx.now.toISOString(),
  };
}
export async function adminOrderDetail(
  id: string,
  params: URLSearchParams,
  now = new Date(),
) {
  const f = parse(params, now),
    panel = params.get("panel") || "overview";
  if (!Object.hasOwn(ORDER_REPORT_PANELS, panel))
    throw new AppError("Mục chi tiết đơn không hợp lệ.");
  const ctx = await context(
      { ...f, q: "", chef: "", region: "", meal: "" },
      now,
      id,
    ),
    [r] = await query(
      ctx,
      `SELECT ${fields()},r.user_id,r.phone,r.address,r.lat,r.lng,r.chef_lat,r.chef_lng,r.route_duration_seconds,r.route_polyline,r.bank_bin,r.bank_name,r.account_no,r.account_name,r.transfer_content,r.note,r.payment_reported,r.cancellation_reason,COALESCE(ps.automatic,0) automatic FROM reported r LEFT JOIN sepay_order_settings ps ON ps.order_id=r.id`,
    );
  if (!r) throw new AppError("Không tìm thấy đơn.", 404);
  const order = row(r, now),
    actions: string[] = [];
  if (
    (r.status === "PAID" && r.payment_status === "PAID_AUTO") ||
    (r.status === "PLACED" &&
      !r.automatic &&
      Date.parse(r.expires_at.replace(" ", "T") + "Z") > now.getTime())
  )
    actions.push("ACCEPTED");
  else if (["ACCEPTED", "PREPARING", "DELIVERING"].includes(r.status))
    actions.push(ORDER_NEXT[r.status]);
  if (r.status === "DELIVERED") actions.push("COMPLETED");
  if (["PLACED", "PAID", "ACCEPTED"].includes(r.status))
    actions.push("CANCELLED");
  if (panel === "overview") {
    const [items, contacts] = await Promise.all([
      rows<R>(
        "SELECT id,product_id,name,image_url,unit_price,quantity FROM order_items WHERE order_id=? ORDER BY id",
        [id],
      ),
      rows<R>(
        "SELECT u.phone chef_phone FROM chefs c LEFT JOIN users u ON u.id=c.user_id WHERE c.id=?",
        [r.chef_id],
      ),
    ]);
    return {
      order,
      items: items.map(numbers),
      contacts: contacts[0] || {},
      actions,
      thresholds: ctx.thresholds,
      sla: ctx.sla,
    };
  }
  if (panel === "timeline") {
    const where = f.stage === "all" ? "" : " AND e.status=?",
      values = f.stage === "all" ? [id] : [id, f.stage];
    const page = await paginate(
      ctx,
      `SELECT e.id,e.status,e.note,e.created_at,e.actor_id,COALESCE(u.name,'Chưa xác định') actor_name,CASE WHEN e.status='EXPIRED' THEN 'system' WHEN u.role='admin' THEN 'admin' WHEN e.actor_id=? THEN 'customer' WHEN e.actor_id=? THEN 'chef' ELSE 'unknown' END actor_role FROM order_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.order_id=?${where}`,
      "e.created_at DESC,e.id DESC",
      f.page,
      [
        r.user_id,
        (await rows<R>("SELECT user_id FROM chefs WHERE id=?", [r.chef_id]))[0]
          ?.user_id || "",
        ...values,
      ],
    );
    return { order, ...page, stage: f.stage, actions };
  }
  if (panel === "payments") {
    const [tx, requests] = await Promise.all([
      paginate(
        ctx,
        `SELECT t.transaction_id,t.chef_id,t.order_id,t.amount,t.result,t.transaction_date,t.created_at,t.content,t.reference_code,d.failure_reason,CONCAT('••••',RIGHT(t.account_number,4)) account_mask FROM sepay_transactions t LEFT JOIN sepay_transaction_details d ON d.chef_id=t.chef_id AND d.transaction_id=t.transaction_id WHERE t.order_id=?`,
        "t.transaction_date DESC,t.chef_id,t.transaction_id",
        f.page,
        [id],
      ),
      rows<R>(
        `SELECT e.id,e.kind,e.amount,e.status,e.note,e.created_at,d.contact_phone,d.resolution_note,d.resolution_type,d.evidence_asset_id,d.submitted_at,d.review_note,d.reviewed_at,a.original_name evidence_name,CASE WHEN d.exception_id IS NOT NULL THEN 'customer' ELSE 'system' END origin FROM payment_exceptions e JOIN orders o ON o.id=e.order_id LEFT JOIN payment_request_details d ON d.exception_id=e.id LEFT JOIN assets a ON a.id=d.evidence_asset_id WHERE e.order_id=? AND (e.actor_id<>o.user_id OR d.exception_id IS NOT NULL) ORDER BY CASE WHEN e.status='REVIEW' THEN 0 WHEN e.status='OPEN' THEN 1 ELSE 2 END,e.created_at DESC,e.id`,
        [id],
      ),
    ]);
    return {
      order,
      transactions: tx,
      requests: requests.map(numbers),
      actions,
    };
  }
  const reviews = await rows<R>(
    "SELECT r.id,r.rating,r.body,r.created_at,u.name user_name FROM reviews r LEFT JOIN users u ON u.id=r.user_id WHERE r.order_id=? AND r.user_id=? AND r.chef_id=? ORDER BY r.created_at DESC,r.id",
    [id, r.user_id, r.chef_id],
  );
  return { order, reviews, actions };
}
