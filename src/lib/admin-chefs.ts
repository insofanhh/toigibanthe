import { z } from "zod";
import { rows, exec, sqlDate, transaction } from "./db";
import { AppError } from "./http";
import { COMPLETED_AT_SQL } from "./order-report-ledger";
import {
  chefFilter,
  chefState,
  CHEF_DETAIL_TABS,
  type ChefFilter,
  type ChefRow,
} from "./admin-chefs-domain";
import { dateBounds, shiftDate, regionLabel, ratio } from "./analytics-domain";
import { serviceDate, cutoffAt, parseUTC, type Actor } from "./domain";
import { ensurePaymentRequestSchema } from "./payment-request-store";
import { ensureSePaySchema } from "./sepay-schema";
import { analyticsLive, slaSchema } from "./analytics";
import { audit } from "./manage";

export const chefThresholdSchema = z.object({
  activationDays: z.number().int().min(1).max(90).default(7),
  lowRating: z.number().min(1).max(5).default(3.5),
  minReviews: z.number().int().min(1).max(1000).default(5),
  rejectRate: z.number().min(0).max(100).default(10),
  minPaid: z.number().int().min(1).max(10000).default(30),
});
function parse(p: URLSearchParams, now: Date) {
  try {
    return chefFilter(p, now);
  } catch (e) {
    throw new AppError((e as Error).message);
  }
}
const ledger = `WITH event_times AS (SELECT e.order_id,
 MIN(CASE WHEN e.status='PAID' THEN e.created_at END) paid_at,MIN(CASE WHEN e.status='ACCEPTED' THEN e.created_at END) accepted_at,
 MIN(CASE WHEN e.status='COMPLETED' THEN e.created_at END) finished_at,
 MAX(e.status='REJECTED' AND e.actor_id=c.user_id) chef_rejected,
 MAX(e.status='CANCELLED' AND e.actor_id=o.user_id) user_cancelled,
 MAX(e.status IN ('CANCELLED','REJECTED') AND e.actor_id<>o.user_id AND e.actor_id<>c.user_id) other_cancelled
 FROM order_events e JOIN orders o ON o.id=e.order_id JOIN chefs c ON c.id=o.chef_id GROUP BY e.order_id),
 ledger AS (SELECT o.*,COALESCE(e.paid_at,o.payment_confirmed_at) paid_at,e.accepted_at,
 ${COMPLETED_AT_SQL} completed_at,
 e.finished_at IS NULL AND o.status='COMPLETED' legacy_completed,COALESCE(e.chef_rejected,0) chef_rejected,COALESCE(e.user_cancelled,0) user_cancelled,COALESCE(e.other_cancelled,0) other_cancelled
 FROM orders o LEFT JOIN event_times e ON e.order_id=o.id)`;
const cache = new Map<
  string,
  { at: number; value: Promise<Awaited<ReturnType<typeof loadFacts>>> }
>();
export function clearChefReports() {
  cache.clear();
}
async function config() {
  const data = await rows<{ id: string; value: unknown }>(
    "SELECT id,value FROM platform_settings WHERE id IN ('analytics_sla','chef_analytics_thresholds')",
  );
  const value = (id: string) => {
    const v = data.find((d) => d.id === id)?.value;
    return typeof v === "string" ? JSON.parse(v) : v;
  };
  return {
    sla: slaSchema.parse(
      value("analytics_sla") || {
        acceptMinutes: 10,
        profileHours: 48,
        refundHours: 24,
      },
    ),
    thresholds: chefThresholdSchema.parse(
      value("chef_analytics_thresholds") || {},
    ),
  };
}
function sqlScope(f: ChefFilter) {
  const sql = ["1=1"],
    values: unknown[] = [];
  if (f.region) {
    sql.push(
      f.region === "unknown"
        ? "(c.lat NOT BETWEEN -90 AND 90 OR c.lng NOT BETWEEN -180 AND 180 OR (c.lat=0 AND c.lng=0))"
        : "CONCAT(ROUND(c.lat*50),':',ROUND(c.lng*50))=?",
    );
    if (f.region !== "unknown") values.push(f.region);
  }
  if (f.q) {
    sql.push(
      "(c.name LIKE ? ESCAPE '=' OR u.name LIKE ? ESCAPE '=' OR u.email LIKE ? ESCAPE '=' OR u.phone LIKE ? ESCAPE '=')",
    );
    const term = "%" + f.q.replace(/[=%_]/g, "=$&") + "%";
    values.push(term, term, term, term);
  }
  return { sql: sql.join(" AND "), values };
}
function period(f: ChefFilter) {
  const b = dateBounds(f.from, f.to);
  return [sqlDate(b.start), sqlDate(b.end)];
}
function normalize(row: ChefRow) {
  for (const key of [
    "owner_active",
    "bank_ready",
    "radius_km",
    "completed",
    "gmv",
    "delivery",
    "placed",
    "active_orders",
    "paid_outcomes",
    "chef_rejected",
    "accept_samples",
    "products",
    "dishes",
    "servings",
    "is_open",
    "menu_days",
    "rating",
    "rating_count",
    "late_orders",
    "refund_open",
    "refund_review",
    "refund_amount",
    "refund_overdue",
  ] as const)
    row[key] = Number(row[key] || 0);
  row.accept_median =
    row.accept_median === null || row.accept_median === undefined
      ? null
      : Number(row.accept_median);
  return row;
}
async function loadFacts(f: ChefFilter, now: Date) {
  await Promise.all([ensurePaymentRequestSchema(), ensureSePaySchema()]);
  const { sla, thresholds } = await config(),
    [from, to] = period(f),
    today = serviceDate(now),
    yesterday = shiftDate(today, -1),
    s = sqlScope(f);
  const [accounts, orderStats, menus, refunds, medians, mealSettings] =
    await Promise.all([
      rows<ChefRow>(
        `SELECT c.id,c.user_id,c.name,c.area,c.address,c.bio,c.avatar_url,c.radius_km,c.status,c.rejection_reason,c.created_at,c.rating,c.rating_count,u.name owner_name,u.email,u.phone,u.active owner_active,c.bank_name,c.account_no,c.account_name,
      c.bank_bin REGEXP '^[0-9]{6}$' AND c.account_no REGEXP '^[0-9]{6,19}$' AND LENGTH(TRIM(c.account_name))>=5 bank_ready,
      CASE WHEN c.lat BETWEEN -90 AND 90 AND c.lng BETWEEN -180 AND 180 AND (c.lat<>0 OR c.lng<>0) THEN CONCAT(ROUND(c.lat*50),':',ROUND(c.lng*50)) ELSE 'unknown' END region,
      (SELECT MIN(a.created_at) FROM audit_logs a WHERE a.entity_id=c.id AND a.action='chef.status' AND JSON_UNQUOTE(JSON_EXTRACT(a.detail,'$.status'))='approved') approved_at,
      COALESCE((SELECT MAX(a.created_at) FROM audit_logs a WHERE a.entity_id=c.id AND a.action='chef.application'),c.created_at) submitted_at,
      (SELECT COUNT(*) FROM products p WHERE p.chef_id=c.id AND p.active=TRUE) products,
      EXISTS(SELECT 1 FROM kitchen_sessions k WHERE k.chef_id=c.id AND k.service_date=? AND k.is_open=TRUE) is_open
      FROM chefs c JOIN users u ON u.id=c.user_id WHERE ${s.sql}`,
        [today, ...s.values],
      ),
      rows<Record<string, any>>(
        ledger +
          ` SELECT chef_id,MIN(paid_at) first_paid_at,MIN(completed_at) first_completed_at,
      SUM(completed_at>=? AND completed_at<? AND (?='' OR meal_id=?)) completed,
      COALESCE(SUM(CASE WHEN completed_at>=? AND completed_at<? AND (?='' OR meal_id=?) THEN subtotal-discount ELSE 0 END),0) gmv,
      COALESCE(SUM(CASE WHEN completed_at>=? AND completed_at<? AND (?='' OR meal_id=?) THEN delivery_fee ELSE 0 END),0) delivery,
      SUM(created_at>=? AND created_at<? AND (?='' OR meal_id=?)) placed,
      SUM(status IN ('PLACED','PAID','ACCEPTED','PREPARING','DELIVERING','DELIVERED') AND (?='' OR meal_id=?)) active_orders,
      SUM(paid_at>=? AND paid_at<? AND (?='' OR meal_id=?) AND (accepted_at IS NOT NULL OR chef_rejected=1)) paid_outcomes,
      SUM(paid_at>=? AND paid_at<? AND (?='' OR meal_id=?) AND chef_rejected=1) chef_rejected,
      SUM(status='PAID' AND paid_at<DATE_SUB(?,INTERVAL ? MINUTE) AND (?='' OR meal_id=?)) late_orders,
      MIN(CASE WHEN status='PAID' AND (?='' OR meal_id=?) THEN paid_at END) oldest_paid_at
      FROM ledger GROUP BY chef_id`,
        [
          from,
          to,
          f.meal,
          f.meal,
          from,
          to,
          f.meal,
          f.meal,
          from,
          to,
          f.meal,
          f.meal,
          from,
          to,
          f.meal,
          f.meal,
          f.meal,
          f.meal,
          from,
          to,
          f.meal,
          f.meal,
          from,
          to,
          f.meal,
          f.meal,
          sqlDate(now),
          sla.acceptMinutes,
          f.meal,
          f.meal,
          f.meal,
          f.meal,
        ],
      ),
      rows<Record<string, any>>(
        `SELECT k.chef_id,
      COUNT(DISTINCT CASE WHEN k.is_open AND p.active AND m.enabled AND m.stock>0 AND m.cutoff_at>? AND (k.service_date=? OR (k.service_date=? AND ms.day_offset=1)) THEN m.product_id END) dishes,
      COALESCE(SUM(CASE WHEN k.is_open AND p.active AND m.enabled AND m.stock>0 AND m.cutoff_at>? AND (k.service_date=? OR (k.service_date=? AND ms.day_offset=1)) THEN m.stock ELSE 0 END),0) servings,
      MAX(k.is_open AND (k.service_date=? OR (k.service_date=? AND ms.day_offset=1 AND m.cutoff_at>?))) is_open,
      COUNT(DISTINCT CASE WHEN k.service_date>=? AND k.service_date<=? THEN k.service_date END) menu_days,
      MAX(CASE WHEN k.service_date<=? THEN k.service_date END) last_menu
      FROM kitchen_sessions k JOIN daily_menu m ON m.session_id=k.id JOIN products p ON p.id=m.product_id JOIN meal_settings ms ON ms.id=m.meal_id WHERE (?='' OR m.meal_id=?) GROUP BY k.chef_id`,
        [
          sqlDate(now),
          today,
          yesterday,
          sqlDate(now),
          today,
          yesterday,
          today,
          yesterday,
          sqlDate(now),
          f.from,
          f.to,
          today,
          f.meal,
          f.meal,
        ],
      ),
      rows<Record<string, any>>(
        `SELECT o.chef_id,SUM(e.status='OPEN') refund_open,SUM(e.status='REVIEW') refund_review,SUM(e.amount) refund_amount,
      MIN(CASE WHEN e.status='OPEN' THEN COALESCE(d.reviewed_at,e.created_at) END) oldest_refund_open_at,
      MIN(CASE WHEN e.status='REVIEW' THEN COALESCE(d.submitted_at,e.created_at) END) oldest_refund_review_at,
      SUM((CASE WHEN e.status='REVIEW' THEN COALESCE(d.submitted_at,e.created_at) ELSE COALESCE(d.reviewed_at,e.created_at) END)<DATE_SUB(?,INTERVAL ? HOUR)) refund_overdue
      FROM payment_exceptions e JOIN orders o ON o.id=e.order_id LEFT JOIN payment_request_details d ON d.exception_id=e.id WHERE e.status IN ('OPEN','REVIEW') AND (e.actor_id<>o.user_id OR d.exception_id IS NOT NULL) AND (?='' OR o.meal_id=?) GROUP BY o.chef_id`,
        [sqlDate(now), sla.refundHours, f.meal, f.meal],
      ),
      rows<Record<string, any>>(
        ledger +
          `, acceptance AS (SELECT chef_id,TIMESTAMPDIFF(SECOND,paid_at,accepted_at)/60 minutes FROM ledger WHERE paid_at>=? AND paid_at<? AND accepted_at>=paid_at AND (?='' OR meal_id=?)),ranked AS (SELECT *,ROW_NUMBER() OVER (PARTITION BY chef_id ORDER BY minutes) rn,COUNT(*) OVER (PARTITION BY chef_id) n FROM acceptance) SELECT chef_id,AVG(minutes) accept_median,MAX(n) accept_samples FROM ranked WHERE rn IN (FLOOR((n+1)/2),FLOOR((n+2)/2)) GROUP BY chef_id`,
        [from, to, f.meal, f.meal],
      ),
      rows<{ id: string; cutoff_time: string; day_offset: number }>(
        "SELECT id,cutoff_time,day_offset FROM meal_settings WHERE (?='' OR id=?)",
        [f.meal, f.meal],
      ),
    ]);
  const maps = [orderStats, menus, refunds, medians].map(
    (arr) => new Map(arr.map((r) => [r.chef_id, r])),
  );
  const mealOpen = mealSettings.some(
    (m) =>
      cutoffAt(today, m.cutoff_time, Number(m.day_offset)).getTime() >
      now.getTime(),
  );
  const data = accounts.map((c) => {
    const openToday = Number(c.is_open);
    const row = normalize(
      Object.assign(c, ...maps.map((m) => m.get(c.id) || {})),
    );
    row.is_open = Math.max(openToday, row.is_open);
    return chefState(row, now, mealOpen, sla, thresholds);
  });
  return { data, sla, thresholds, mealOpen, at: now.toISOString() };
}
async function facts(f: ChefFilter, now: Date, fresh = false, version = "") {
  const key = JSON.stringify([
      f.from,
      f.to,
      f.region,
      f.meal,
      f.q,
      serviceDate(now),
      version.slice(0, 80),
    ]),
    old = cache.get(key);
  if (!fresh && old && Date.now() - old.at < 20000) return old.value;
  const value = loadFacts(f, now);
  if (cache.size > 12) cache.clear();
  cache.set(key, { at: Date.now(), value });
  try {
    return await value;
  } catch (e) {
    if (cache.get(key)?.value === value) cache.delete(key);
    throw e;
  }
}
export async function saveChefThresholds(user: Actor, input: unknown) {
  if (user.role !== "admin")
    throw new AppError("Không có quyền quản trị.", 403);
  const b = chefThresholdSchema.parse(input);
  await transaction(async (db) => {
    await exec(
      "INSERT INTO platform_settings VALUES ('chef_analytics_thresholds',?) ON DUPLICATE KEY UPDATE value=VALUES(value)",
      [JSON.stringify(b)],
      db,
    );
    await audit(db, user, "chef.analytics.thresholds", null, b);
    await analyticsLive(db, user.id);
  });
  clearChefReports();
  return { ok: true };
}
export async function adminChefAnalytics(
  section: string,
  params: URLSearchParams,
  now = new Date(),
) {
  if (!["summary", "trends", "operations", "list"].includes(section))
    throw new AppError("Báo cáo bếp không hợp lệ.", 404);
  const f = parse(params, now),
    loaded = await facts(
      f,
      now,
      section === "operations" || !!params.get("fresh"),
      params.get("v") || "",
    ),
    a = loaded.data;
  if (section === "summary") {
    const b = dateBounds(f.from, f.to),
      newly = (c: ChefRow) =>
        !!c.approved_at &&
        parseUTC(c.approved_at) >= b.start &&
        parseUTC(c.approved_at) < b.end;
    const approved = a.filter((c) => newly(c)),
      validApproval = (c: ChefRow) =>
        !c.first_paid_at ||
        parseUTC(c.first_paid_at) >= parseUTC(c.approved_at!),
      known = approved.filter(validApproval),
      eligible = known.filter(
        (c) =>
          now.getTime() - parseUTC(c.approved_at!).getTime() >=
          loaded.thresholds.activationDays * 86400000,
      ),
      activated = eligible.filter(
        (c) =>
          c.first_paid_at &&
          parseUTC(c.first_paid_at) >= parseUTC(c.approved_at!) &&
          parseUTC(c.first_paid_at).getTime() <=
            parseUTC(c.approved_at!).getTime() +
              loaded.thresholds.activationDays * 86400000,
      );
    const allRegions = await rows<{ region: string; area: string }>(
      `SELECT CASE WHEN lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180 AND (lat<>0 OR lng<>0) THEN CONCAT(ROUND(lat*50),':',ROUND(lng*50)) ELSE 'unknown' END region,MAX(area) area FROM chefs GROUP BY region ORDER BY region`,
    );
    return {
      metrics: {
        total: a.length,
        pending: a.filter((c) => c.status === "pending").length,
        approved: a.filter((c) => c.status === "approved").length,
        ready: a.filter((c) => c.ready).length,
        sales: a.filter((c) => c.completed > 0).length,
        new: approved.length,
        suspended: a.filter((c) => c.status === "suspended").length,
        attention: a.filter((c) => c.alerts.length).length,
      },
      statusCounts: Object.fromEntries(
        ["pending", "approved", "needs_changes", "rejected", "suspended"].map(
          (s) => [s, a.filter((c) => c.status === s).length],
        ),
      ),
      activation: {
        eligible: eligible.length,
        activated: activated.length,
        rate: ratio(activated.length, eligible.length),
        waiting: known.length - eligible.length,
        unknown: a.filter(
          (c) =>
            (["approved", "suspended"].includes(c.status) && !c.approved_at) ||
            (!!c.approved_at && !validApproval(c)),
        ).length,
        days: loaded.thresholds.activationDays,
      },
      regions: allRegions.map((r) => ({
        id: r.region,
        label:
          r.region === "unknown"
            ? "Chưa xác định"
            : (r.area ? r.area + " · " : "") + regionLabel(r.region),
      })),
      sla: loaded.sla,
      thresholds: loaded.thresholds,
      updatedAt: loaded.at,
    };
  }
  if (section === "operations")
    return {
      alerts: a
        .flatMap((c) =>
          c.alerts.map((alert) => ({
            ...alert,
            chefId: c.id,
            chefName: c.name,
            ownerPhone: c.phone,
            oldestPaidAt: c.oldest_paid_at,
            refundOverdue: c.refund_overdue,
            waitingSince:
              alert.key === "profile"
                ? c.submitted_at
                : alert.key === "late"
                  ? c.oldest_paid_at
                  : alert.key === "refund_open"
                    ? c.oldest_refund_open_at
                    : alert.key === "refund_review"
                      ? c.oldest_refund_review_at
                      : alert.key === "activation"
                        ? c.approved_at
                        : null,
          })),
        )
        .sort(
          (x, y) => x.priority - y.priority || x.chefId.localeCompare(y.chefId),
        )
        .slice(0, 30),
      total: a.reduce((n, c) => n + c.alerts.length, 0),
      chefs: a.filter((c) => c.alerts.length).length,
      updatedAt: loaded.at,
    };
  if (section === "trends") {
    const p = period(f),
      s = sqlScope(f),
      trend = await rows<{
        day: string;
        submitted: number;
        approved: number;
        resubmitted: number;
      }>(
        `WITH first_approval AS (SELECT entity_id,MIN(created_at) approved_at FROM audit_logs WHERE action='chef.status' AND JSON_UNQUOTE(JSON_EXTRACT(detail,'$.status'))='approved' GROUP BY entity_id) SELECT day,SUM(submitted) submitted,SUM(approved) approved,SUM(resubmitted) resubmitted FROM (
      SELECT DATE(DATE_ADD(c.created_at,INTERVAL 7 HOUR)) day,COUNT(*) submitted,0 approved,0 resubmitted FROM chefs c JOIN users u ON u.id=c.user_id WHERE ${s.sql} AND c.created_at>=? AND c.created_at<? GROUP BY day UNION ALL
      SELECT DATE(DATE_ADD(a.approved_at,INTERVAL 7 HOUR)) day,0 submitted,COUNT(*) approved,0 resubmitted FROM chefs c JOIN users u ON u.id=c.user_id JOIN first_approval a ON a.entity_id=c.id WHERE ${s.sql} AND a.approved_at>=? AND a.approved_at<? GROUP BY day UNION ALL
      SELECT DATE(DATE_ADD(a.created_at,INTERVAL 7 HOUR)) day,0 submitted,0 approved,COUNT(*) resubmitted FROM chefs c JOIN users u ON u.id=c.user_id JOIN audit_logs a ON a.entity_id=c.id AND a.action='chef.application' AND JSON_UNQUOTE(JSON_EXTRACT(a.detail,'$.resubmitted'))='true' WHERE ${s.sql} AND a.created_at>=? AND a.created_at<? GROUP BY day) d GROUP BY day ORDER BY day`,
        [...s.values, ...p, ...s.values, ...p, ...s.values, ...p],
      );
    const m = new Map(trend.map((d) => [String(d.day).slice(0, 10), d])),
      days = [];
    for (let day = f.from; day <= f.to; day = shiftDate(day, 1))
      days.push({
        day,
        submitted: Number(m.get(day)?.submitted || 0),
        approved: Number(m.get(day)?.approved || 0),
        resubmitted: Number(m.get(day)?.resubmitted || 0),
      });
    const tops = a
      .filter((c) => c.completed > 0)
      .map((c) => ({
        id: c.id,
        name: c.name,
        completed: c.completed,
        gmv: c.gmv,
      }));
    return {
      days,
      topOrders: [...tops]
        .sort((x, y) => y.completed - x.completed || x.id.localeCompare(y.id))
        .slice(0, 10),
      topSales: [...tops]
        .sort((x, y) => y.gmv - x.gmv || x.id.localeCompare(y.id))
        .slice(0, 10),
    };
  }
  let list = a.filter((c) =>
    f.status === "all"
      ? f.view !== "approvals" || c.status === "pending"
      : c.status === f.status,
  );
  const b = dateBounds(f.from, f.to);
  list = list.filter(
    (c) =>
      f.group === "all" ||
      (f.group === "ready" && c.ready) ||
      (f.group === "closed" && c.status === "approved" && !c.ready) ||
      (f.group === "sales" && c.completed > 0) ||
      (f.group === "new" &&
        !!c.approved_at &&
        parseUTC(c.approved_at) >= b.start &&
        parseUTC(c.approved_at) < b.end) ||
      (f.group === "attention" && c.alerts.length > 0),
  );
  const num = (c: ChefRow) =>
    f.sort === "gmv"
      ? c.gmv
      : f.sort === "completed"
        ? c.completed
        : f.sort === "rating"
          ? c.rating
          : f.sort === "attention"
            ? c.alerts.length
            : f.sort === "approved" && c.approved_at
              ? parseUTC(c.approved_at).getTime()
              : f.sort === "approved"
                ? 0
                : parseUTC(c.created_at).getTime();
  list.sort((x, y) => num(y) - num(x) || x.id.localeCompare(y.id));
  const total = list.length,
    pages = Math.max(1, Math.ceil(total / 20)),
    page = Math.min(f.page, pages);
  return {
    chefs: list.slice((page - 1) * 20, page * 20),
    total,
    pages,
    page,
    pageSize: 20,
  };
}
export async function adminChefDetailReport(
  id: string,
  params: URLSearchParams,
  now = new Date(),
) {
  const f = parse(params, now),
    tab = params.get("panel") || "overview";
  if (!Object.hasOwn(CHEF_DETAIL_TABS, tab))
    throw new AppError("Mục chi tiết bếp không hợp lệ.");
  const data = await facts(
      { ...f, q: "", region: "" },
      now,
      !!params.get("fresh"),
      params.get("v") || "",
    ),
    chef = data.data.find((c) => c.id === id);
  if (!chef) throw new AppError("Không tìm thấy bếp.", 404);
  const p = period(f),
    mealSql = f.meal ? " AND o.meal_id=?" : "",
    mealValues = f.meal ? [f.meal] : [],
    pageSize = 20;
  const paginate = async (sql: string, values: unknown[], sort: string) => {
    const [{ total: raw }] = await rows<{ total: number }>(
      `SELECT COUNT(*) total FROM (${sql}) detail`,
      values,
    );
    const total = Number(raw),
      pages = Math.max(1, Math.ceil(total / pageSize)),
      page = Math.min(f.page, pages);
    const items = await rows<Record<string, any>>(
      sql + ` ORDER BY ${sort} LIMIT ? OFFSET ?`,
      [...values, pageSize, (page - 1) * pageSize],
    );
    return { items, total, page, pages };
  };
  if (tab === "profile") {
    const [assets, history, sepay] = await Promise.all([
      rows(
        "SELECT id,original_name,content_type,created_at FROM assets WHERE user_id=? AND kind='document' ORDER BY created_at DESC",
        [chef.user_id],
      ),
      rows(
        "SELECT a.id,a.action,a.detail,a.created_at,u.name actor_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE a.entity_id=? AND a.action IN ('chef.status','chef.application') ORDER BY a.created_at DESC,a.id DESC LIMIT 100",
        [id],
      ),
      rows(
        "SELECT enabled,key_hash IS NOT NULL configured,last_received_at FROM sepay_integrations WHERE chef_id=?",
        [id],
      ),
    ]);
    return {
      chef,
      assets,
      history: history.map((h) => ({
        ...h,
        detail: typeof h.detail === "string" ? JSON.parse(h.detail) : h.detail,
      })),
      sepay: sepay[0] || { enabled: 0, configured: 0, last_received_at: null },
    };
  }
  if (tab === "menu") {
    const kind = params.get("kind") || "menu";
    if (!["menu", "products"].includes(kind))
      throw new AppError("Danh sách món không hợp lệ.");
    if (kind === "products")
      return {
        chef,
        ...(await paginate(
          "SELECT p.id,p.name,p.price,p.image_url,p.active,p.rating,p.rating_count FROM products p WHERE p.chef_id=?",
          [id],
          "p.active DESC,p.name,p.id",
        )),
        kind,
      };
    return {
      chef,
      ...(await paginate(
        `SELECT m.id,m.meal_id,m.stock,m.enabled,m.cutoff_at,p.id product_id,p.name,p.image_url,p.active,p.price,k.service_date,k.is_open FROM daily_menu m JOIN kitchen_sessions k ON k.id=m.session_id JOIN products p ON p.id=m.product_id WHERE k.chef_id=? AND k.service_date>=? AND k.service_date<=?${f.meal ? " AND m.meal_id=?" : ""}`,
        [id, f.from, f.to, ...mealValues],
        "k.service_date DESC,m.cutoff_at DESC,m.id",
      )),
      kind,
    };
  }
  if (tab === "orders") {
    const focus = params.get("focus") || "";
    if (focus && !["late", "active"].includes(focus))
      throw new AppError("Bộ lọc đơn không hợp lệ.");
    const condition =
      focus === "late"
        ? "o.status='PAID' AND o.paid_at<DATE_SUB(?,INTERVAL ? MINUTE)"
        : focus === "active"
          ? "o.status IN ('PLACED','PAID','ACCEPTED','PREPARING','DELIVERING','DELIVERED')"
          : "o.created_at>=? AND o.created_at<?";
    const values = [
      id,
      ...(focus === "late"
        ? [sqlDate(now), data.sla.acceptMinutes]
        : focus === "active"
          ? []
          : p),
      ...mealValues,
    ];
    const where = `o.chef_id=? AND ${condition}${mealSql}`;
    const [{ total: raw }] = await rows<{ total: number }>(
        ledger + ` SELECT COUNT(*) total FROM ledger o WHERE ${where}`,
        values,
      ),
      total = Number(raw),
      pages = Math.max(1, Math.ceil(total / 20)),
      page = Math.min(f.page, pages);
    const [items, counts] = await Promise.all([
      rows(
        ledger +
          ` SELECT o.id,o.code,o.status,o.payment_status,o.total,o.created_at,o.paid_at,o.accepted_at,o.completed_at,o.legacy_completed,o.chef_rejected,o.user_cancelled,o.other_cancelled,(SELECT GROUP_CONCAT(CONCAT(i.quantity,' × ',i.name) ORDER BY i.id SEPARATOR ', ') FROM order_items i WHERE i.order_id=o.id) summary FROM ledger o WHERE ${where} ORDER BY o.created_at DESC,o.id DESC LIMIT 20 OFFSET ?`,
        [...values, (page - 1) * 20],
      ),
      rows(
        ledger +
          ` SELECT o.status,COUNT(*) count FROM ledger o WHERE ${where} GROUP BY o.status`,
        values,
      ),
    ]);
    return { chef, items, total, pages, page, counts, focus };
  }
  if (tab === "payments") {
    const filter = params.get("payment") || "all";
    if (!["all", "OPEN", "REVIEW", "RESOLVED"].includes(filter))
      throw new AppError("Bộ lọc đối soát không hợp lệ.");
    const status =
      filter === "RESOLVED"
        ? " AND e.status IN ('RESOLVED','REFUNDED')"
        : filter === "all"
          ? ""
          : " AND e.status=?";
    const values = [
      id,
      ...mealValues,
      ...(["OPEN", "REVIEW"].includes(filter) ? [filter] : []),
    ];
    return {
      chef,
      ...(await paginate(
        `SELECT e.id,e.order_id,o.code,e.kind,e.status,e.amount,e.created_at,d.contact_phone,d.resolution_note,d.evidence_asset_id,d.submitted_at,d.review_note,d.reviewed_at FROM payment_exceptions e JOIN orders o ON o.id=e.order_id LEFT JOIN payment_request_details d ON d.exception_id=e.id WHERE o.chef_id=?${mealSql} AND (e.actor_id<>o.user_id OR d.exception_id IS NOT NULL)${status}`,
        values,
        "e.created_at DESC,e.id DESC",
      )),
      filter,
    };
  }
  if (tab === "customers") {
    const reviewSort = params.get("reviewSort") || "recent";
    if (!["recent", "highest", "lowest"].includes(reviewSort))
      throw new AppError("Sắp xếp đánh giá không hợp lệ.");
    const [buyers, ratings] = await Promise.all([
      rows(
        ledger +
          `, ranked_buyers AS (SELECT o.*,ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.completed_at,o.id) rn FROM ledger o WHERE o.chef_id=? AND o.completed_at IS NOT NULL) SELECT COUNT(DISTINCT o.user_id) buyers,COUNT(DISTINCT CASE WHEN o.rn=1 THEN o.user_id END) new_buyers,COUNT(DISTINCT CASE WHEN o.rn>1 THEN o.user_id END) returning_buyers FROM ranked_buyers o WHERE o.completed_at>=? AND o.completed_at<?${mealSql}`,
        [id, ...p, ...mealValues],
      ),
      rows(
        `SELECT r.rating,COUNT(*) count FROM reviews r JOIN orders o ON o.id=r.order_id WHERE r.chef_id=? AND o.status='COMPLETED' AND o.user_id=r.user_id AND r.created_at>=? AND r.created_at<?${mealSql} GROUP BY r.rating`,
        [id, ...p, ...mealValues],
      ),
    ]);
    const reviews = await paginate(
      `SELECT r.id,r.rating,r.body,r.created_at,u.name user_name,o.code,(SELECT GROUP_CONCAT(DISTINCT i.name ORDER BY i.name SEPARATOR ', ') FROM order_items i WHERE i.order_id=o.id) dishes FROM reviews r JOIN orders o ON o.id=r.order_id JOIN users u ON u.id=r.user_id WHERE r.chef_id=? AND o.status='COMPLETED' AND o.user_id=r.user_id AND r.created_at>=? AND r.created_at<?${mealSql}`,
      [id, ...p, ...mealValues],
      (reviewSort === "highest"
        ? "r.rating DESC,"
        : reviewSort === "lowest"
          ? "r.rating ASC,"
          : "") + "r.created_at DESC,r.id DESC",
    );
    return { chef, buyers: buyers[0], ratings, ...reviews };
  }
  const [{ legacy: legacyRaw }] = await rows<{ legacy: number }>(
    ledger +
      ` SELECT COALESCE(SUM(o.legacy_completed),0) legacy FROM ledger o WHERE o.chef_id=? AND o.completed_at>=? AND o.completed_at<?${mealSql}`,
    [id, ...p, ...mealValues],
  );
  const [retention] = await rows<{ eligible: number; returned: number }>(
    ledger +
      `, first_buy AS (SELECT user_id,MIN(completed_at) first_at FROM ledger WHERE chef_id=? AND completed_at IS NOT NULL GROUP BY user_id) SELECT COUNT(*) eligible,COALESCE(SUM(EXISTS(SELECT 1 FROM ledger n WHERE n.chef_id=? AND n.user_id=b.user_id AND n.completed_at>b.first_at AND n.completed_at<=DATE_ADD(b.first_at,INTERVAL 30 DAY))),0) returned FROM first_buy b WHERE b.first_at>=? AND b.first_at<? AND b.first_at<=DATE_SUB(?,INTERVAL 30 DAY)${f.meal ? " AND EXISTS(SELECT 1 FROM ledger o WHERE o.chef_id=? AND o.user_id=b.user_id AND o.completed_at=b.first_at AND o.meal_id=?)" : ""}`,
    [id, id, ...p, sqlDate(now), ...(f.meal ? [id, f.meal] : [])],
  );
  return {
    chef,
    legacyCompletions: Number(legacyRaw),
    retention: {
      eligible: Number(retention.eligible),
      returned: Number(retention.returned),
      rate: ratio(Number(retention.returned), Number(retention.eligible)),
    },
    thresholds: data.thresholds,
    sla: data.sla,
  };
}
