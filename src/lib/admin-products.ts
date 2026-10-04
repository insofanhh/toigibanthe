import { z } from "zod";
import { rows, exec, transaction, sqlDate } from "./db";
import { AppError } from "./http";
import {
  productFilter,
  productOperation,
  productAlerts,
  PRODUCT_PANELS,
  type ProductFilter,
  type ProductRow,
} from "./admin-products-domain";
import {
  dateBounds,
  shiftDate,
  previousFilter,
  metricDelta,
  regionLabel,
} from "./analytics-domain";
import { serviceDate, parseUTC, type Actor } from "./domain";
import { ensureAnalyticsSchema } from "./analytics-schema";
import { ensurePaymentRequestSchema } from "./payment-request-store";
import { analyticsLive, slaSchema } from "./analytics";
import { audit } from "./manage";
type R = Record<string, any>;
export const productThresholdSchema = z.object({
  lowRating: z.number().min(1).max(5).default(3.5),
  minReviews: z.number().int().min(1).max(1000).default(5),
  minMenuDays: z.number().int().min(1).max(90).default(3),
  minAgeDays: z.number().int().min(1).max(365).default(7),
});
function parse(p: URLSearchParams, now: Date) {
  try {
    return productFilter(p, now);
  } catch (e) {
    throw new AppError((e as Error).message);
  }
}
function bounds(f: Pick<ProductFilter, "from" | "to">) {
  const b = dateBounds(f.from, f.to);
  return [sqlDate(b.start), sqlDate(b.end)];
}
// Allocate an order's voucher before filtering products. Integer VND remainders
// go to the largest fractional shares, with product ID as a stable tie breaker.
export const productLedger = `WITH event_times AS (
 SELECT e.order_id,MIN(CASE WHEN e.status='COMPLETED' THEN e.created_at END) finished_at,
 MAX(e.status='REJECTED' AND e.actor_id=c.user_id) chef_rejected,
 MAX(e.status='CANCELLED' AND e.actor_id=o.user_id) user_cancelled,
 MAX(e.status IN ('CANCELLED','REJECTED') AND e.actor_id<>c.user_id AND e.actor_id<>o.user_id) other_cancelled
 FROM order_events e JOIN orders o ON o.id=e.order_id LEFT JOIN chefs c ON c.id=o.chef_id GROUP BY e.order_id
), ledger AS (
 SELECT o.*,CASE WHEN o.status='COMPLETED' THEN COALESCE(e.finished_at,o.updated_at) END completed_at,
 e.finished_at IS NULL AND o.status='COMPLETED' legacy_completed,COALESCE(e.chef_rejected,0) chef_rejected,COALESCE(e.user_cancelled,0) user_cancelled,COALESCE(e.other_cancelled,0) other_cancelled
 FROM orders o LEFT JOIN event_times e ON e.order_id=o.id
), item_groups AS (
 SELECT i.order_id,i.product_id,SUM(i.quantity) quantity,SUM(CAST(i.unit_price AS DECIMAL(20,0))*i.quantity) gross,MAX(i.name) item_name,MAX(i.image_url) item_image FROM order_items i GROUP BY i.order_id,i.product_id
), shares AS (
 SELECT i.*,o.subtotal,o.subtotal-o.discount net,
 CASE WHEN o.subtotal>0 THEN CAST(i.gross AS DECIMAL(30,10))*(o.subtotal-o.discount)/o.subtotal ELSE 0 END share,
 SUM(i.gross) OVER(PARTITION BY i.order_id) gross_total FROM item_groups i JOIN ledger o ON o.id=i.order_id
), fractions AS (
 SELECT s.*,FLOOR(share) base_share,ROW_NUMBER() OVER(PARTITION BY order_id ORDER BY share-FLOOR(share) DESC,product_id) fraction_rank,
 SUM(FLOOR(share)) OVER(PARTITION BY order_id) base_total FROM shares s
), allocated AS (
 SELECT f.*,base_share+CASE WHEN gross_total=subtotal AND net>=0 AND fraction_rank<=net-base_total THEN 1 ELSE 0 END amount,
 gross_total<>subtotal OR subtotal<=0 OR net<0 allocation_warning FROM fractions f
), product_orders AS (
 SELECT o.*,i.product_id,i.quantity,i.gross,i.amount,i.item_name,i.item_image,i.allocation_warning FROM ledger o JOIN allocated i ON i.order_id=o.id
)`;
const cache = new Map<
  string,
  { at: number; value: Promise<Awaited<ReturnType<typeof loadFacts>>> }
>();
export function clearProductReports() {
  cache.clear();
}
function match(p: ProductRow, f: ProductFilter) {
  const term = f.q.toLocaleLowerCase("vi-VN");
  return (
    (!f.chef || p.chef_id === f.chef) &&
    (!f.region || p.region === f.region) &&
    (!term ||
      [p.name, p.chef_name, p.id].some((s) =>
        String(s || "")
          .toLocaleLowerCase("vi-VN")
          .includes(term),
      ))
  );
}
const numericFields = new Set(
  "price active missing owner_active bank_ready radius_km rating rating_count prep_minutes quantity gross amount total stock enabled is_open sale_price current_price servings gmv orders buyers previous_servings previous_gmv previous_orders legacy_orders allocation_warnings menu_days review_count period_rating lifetime_review_count lifetime_rating refund_open refund_review views adds favorites legacyOrders allocationWarnings weekday count tracked first_buyers repeat_buyers chef_rejected user_cancelled other_cancelled legacy_completed allocation_warning".split(
    " ",
  ),
);
function numbers(r: R) {
  for (const [k, v] of Object.entries(r))
    if (v !== null && numericFields.has(k)) r[k] = Number(v);
  return r;
}
async function loadFacts(f: ProductFilter, now: Date) {
  await Promise.all([ensureAnalyticsSchema(), ensurePaymentRequestSchema()]);
  const [from, to] = bounds(f),
    [prevFrom, prevTo] = bounds(previousFilter(f)),
    today = serviceDate(now),
    yesterday = shiftDate(today, -1),
    when = sqlDate(now);
  const [
    catalog,
    orphans,
    sales,
    menuStats,
    offers,
    reviews,
    refunds,
    behavior,
    favorites,
    settings,
  ] = await Promise.all([
    rows<R>(`SELECT p.*,c.name chef_name,c.status chef_status,c.area,c.address,c.radius_km,u.active owner_active,
      c.bank_bin REGEXP '^[0-9]{6}$' AND c.account_no REGEXP '^[0-9]{6,19}$' AND LENGTH(TRIM(c.account_name))>=5 bank_ready,
      CASE WHEN c.lat BETWEEN -90 AND 90 AND c.lng BETWEEN -180 AND 180 AND (c.lat<>0 OR c.lng<>0) THEN CONCAT(ROUND(c.lat*50),':',ROUND(c.lng*50)) ELSE 'unknown' END region,0 missing
      FROM products p JOIN chefs c ON c.id=p.chef_id JOIN users u ON u.id=c.user_id`),
    rows<R>(
      productLedger +
        `, missing_rows AS (SELECT l.*,ROW_NUMBER() OVER(PARTITION BY l.product_id ORDER BY l.created_at DESC,l.id DESC) rn FROM product_orders l LEFT JOIN products p ON p.id=l.product_id WHERE p.id IS NULL)
      SELECT l.product_id id,l.item_name name,l.item_image image_url,l.chef_id,c.name chef_name,c.status chef_status,c.area,c.address,c.radius_km,
      CASE WHEN c.lat BETWEEN -90 AND 90 AND c.lng BETWEEN -180 AND 180 AND (c.lat<>0 OR c.lng<>0) THEN CONCAT(ROUND(c.lat*50),':',ROUND(c.lng*50)) ELSE 'unknown' END region,
      1 missing,0 active,0 price,'' description,'' ingredients,NULL created_at,0 owner_active,0 bank_ready FROM missing_rows l LEFT JOIN chefs c ON c.id=l.chef_id WHERE rn=1`,
    ),
    rows<R>(
      productLedger +
        ` SELECT product_id,
      SUM(CASE WHEN completed_at>=? AND completed_at<? AND (?='' OR meal_id=?) THEN quantity ELSE 0 END) servings,
      SUM(CASE WHEN completed_at>=? AND completed_at<? AND (?='' OR meal_id=?) THEN amount ELSE 0 END) gmv,
      COUNT(DISTINCT CASE WHEN completed_at>=? AND completed_at<? AND (?='' OR meal_id=?) THEN id END) orders,
      COUNT(DISTINCT CASE WHEN completed_at>=? AND completed_at<? AND (?='' OR meal_id=?) THEN user_id END) buyers,
      SUM(CASE WHEN completed_at>=? AND completed_at<? AND (?='' OR meal_id=?) THEN quantity ELSE 0 END) previous_servings,
      SUM(CASE WHEN completed_at>=? AND completed_at<? AND (?='' OR meal_id=?) THEN amount ELSE 0 END) previous_gmv,
      COUNT(DISTINCT CASE WHEN completed_at>=? AND completed_at<? AND (?='' OR meal_id=?) THEN id END) previous_orders,
      COUNT(DISTINCT CASE WHEN completed_at>=? AND completed_at<? AND (?='' OR meal_id=?) AND legacy_completed THEN id END) legacy_orders,
      COUNT(DISTINCT CASE WHEN completed_at>=? AND completed_at<? AND (?='' OR meal_id=?) AND allocation_warning THEN id END) allocation_warnings,
      MIN(completed_at) first_completed_at,MAX(completed_at) last_completed_at FROM product_orders GROUP BY product_id`,
      [
        [from, to],
        [from, to],
        [from, to],
        [from, to],
        [prevFrom, prevTo],
        [prevFrom, prevTo],
        [prevFrom, prevTo],
        [from, to],
        [from, to],
      ].flatMap((b) => [...b, f.meal, f.meal]),
    ),
    rows<R>(
      `SELECT m.product_id,COUNT(DISTINCT CASE WHEN k.service_date>=? AND k.service_date<=? THEN k.service_date END) menu_days,MIN(k.service_date) first_menu,MAX(k.service_date) last_menu FROM daily_menu m JOIN kitchen_sessions k ON k.id=m.session_id WHERE k.service_date<=? AND (?='' OR m.meal_id=?) GROUP BY m.product_id`,
      [f.from, f.to, today, f.meal, f.meal],
    ),
    rows<R>(
      `SELECT m.*,k.service_date,k.is_open,CASE WHEN ca.active AND ca.starts_at<=? AND ca.ends_at>? AND m.sale_price>0 AND m.sale_price<p.price THEN m.sale_price ELSE p.price END current_price FROM daily_menu m JOIN kitchen_sessions k ON k.id=m.session_id JOIN products p ON p.id=m.product_id JOIN meal_settings ms ON ms.id=m.meal_id LEFT JOIN campaigns ca ON ca.id=m.campaign_id WHERE (k.service_date=? OR (k.service_date=? AND ms.day_offset=1 AND m.cutoff_at>?)) AND (?='' OR m.meal_id=?)`,
      [when, when, today, yesterday, when, f.meal, f.meal],
    ),
    rows<R>(
      productLedger +
        ` SELECT l.product_id,COUNT(CASE WHEN r.created_at>=? AND r.created_at<? AND (?='' OR l.meal_id=?) THEN 1 END) review_count,AVG(CASE WHEN r.created_at>=? AND r.created_at<? AND (?='' OR l.meal_id=?) THEN r.rating END) period_rating,COUNT(*) lifetime_review_count,AVG(r.rating) lifetime_rating FROM product_orders l JOIN reviews r ON r.order_id=l.id AND r.user_id=l.user_id AND r.chef_id=l.chef_id WHERE l.status='COMPLETED' GROUP BY l.product_id`,
      [from, to, f.meal, f.meal, from, to, f.meal, f.meal],
    ),
    rows<R>(
      productLedger +
        ` SELECT l.product_id,COUNT(DISTINCT CASE WHEN e.status='OPEN' THEN l.id END) refund_open,COUNT(DISTINCT CASE WHEN e.status='REVIEW' THEN l.id END) refund_review,
      MIN(CASE WHEN e.status='OPEN' THEN COALESCE(d.reviewed_at,e.created_at) END) oldest_refund_open_at,MIN(CASE WHEN e.status='REVIEW' THEN COALESCE(d.submitted_at,e.created_at) END) oldest_refund_review_at
      FROM product_orders l JOIN payment_exceptions e ON e.order_id=l.id LEFT JOIN payment_request_details d ON d.exception_id=e.id WHERE e.status IN ('OPEN','REVIEW') AND (e.actor_id<>l.user_id OR d.exception_id IS NOT NULL) AND (?='' OR l.meal_id=?) GROUP BY l.product_id`,
      [f.meal, f.meal],
    ),
    rows<R>(
      `SELECT product_id,COUNT(DISTINCT CASE WHEN created_at>=? AND created_at<? AND (?='' OR meal_id=?) AND event_name='dish_view' THEN session_id END) views,COUNT(DISTINCT CASE WHEN created_at>=? AND created_at<? AND (?='' OR meal_id=?) AND event_name='cart_add' THEN session_id END) adds,MIN(created_at) tracking_started_at FROM analytics_events WHERE product_id IS NOT NULL AND event_name IN ('dish_view','cart_add') GROUP BY product_id`,
      [from, to, f.meal, f.meal, from, to, f.meal, f.meal],
    ),
    rows<R>(
      "SELECT product_id,COUNT(*) favorites FROM favorites GROUP BY product_id",
    ),
    rows<R>(
      "SELECT id,value FROM platform_settings WHERE id IN ('product_analytics_thresholds','analytics_sla')",
    ),
  ]);
  const get = (id: string) => {
    const v = settings.find((r) => r.id === id)?.value;
    return typeof v === "string" ? JSON.parse(v) : v;
  };
  const thresholds = productThresholdSchema.parse(
      get("product_analytics_thresholds") || {},
    ),
    sla = slaSchema.parse(
      get("analytics_sla") || {
        acceptMinutes: 10,
        profileHours: 48,
        refundHours: 24,
      },
    );
  const maps = [sales, menuStats, reviews, refunds, behavior, favorites].map(
    (a) => new Map(a.map((r) => [r.product_id, numbers(r)])),
  );
  const offersByProduct = new Map<string, R[]>();
  for (const offer of offers) {
    const group = offersByProduct.get(offer.product_id) || [];
    group.push(offer);
    offersByProduct.set(offer.product_id, group);
  }
  const data = [...catalog, ...orphans].map((raw) => {
    const p = numbers({
      ...raw,
      servings: 0,
      gmv: 0,
      orders: 0,
      buyers: 0,
      previous_servings: 0,
      previous_gmv: 0,
      previous_orders: 0,
      legacy_orders: 0,
      allocation_warnings: 0,
      menu_days: 0,
      review_count: 0,
      period_rating: null,
      lifetime_review_count: 0,
      lifetime_rating: null,
      refund_open: 0,
      refund_review: 0,
      views: 0,
      adds: 0,
      favorites: 0,
      ...Object.assign({}, ...maps.map((m) => m.get(raw.id) || {})),
    }) as ProductRow;
    p.offers = (offersByProduct.get(p.id) || []).map((raw) => {
      const m = numbers({ ...raw });
      m.expired = parseUTC(m.cutoff_at) <= now;
      m.ready =
        !!p.active &&
        p.chef_status === "approved" &&
        !!p.owner_active &&
        !!p.bank_ready &&
        !!m.is_open &&
        !!m.enabled &&
        !m.expired &&
        m.stock > 0;
      return m;
    });
    p.ready = p.offers.some((m: R) => m.ready);
    p.operation = productOperation(p, p.offers);
    p.empty_offers = p.offers.filter(
      (m: R) =>
        !p.missing &&
        p.active &&
        p.chef_status === "approved" &&
        p.owner_active &&
        p.bank_ready &&
        m.is_open &&
        m.enabled &&
        !m.expired &&
        m.stock === 0,
    ).length;
    const valid = p.offers.filter((m: R) => m.ready);
    p.available_stock = valid.reduce((n: number, m: R) => n + m.stock, 0);
    p.meals = [...new Set(valid.map((m: R) => m.meal_id))];
    p.price_min = valid.length
      ? Math.min(...valid.map((m: R) => m.current_price))
      : null;
    p.price_max = valid.length
      ? Math.max(...valid.map((m: R) => m.current_price))
      : null;
    p.refund_overdue = [
      p.oldest_refund_open_at,
      p.oldest_refund_review_at,
    ].filter(
      (d) =>
        d && now.getTime() - parseUTC(d).getTime() > sla.refundHours * 3600000,
    ).length;
    p.alerts = productAlerts(p, now, thresholds);
    return p;
  });
  return { data, thresholds, sla, at: now.toISOString() };
}
async function facts(
  f: ProductFilter,
  p: URLSearchParams,
  now: Date,
  fresh = false,
) {
  const key = JSON.stringify([
      f.from,
      f.to,
      f.meal,
      serviceDate(now),
      (p.get("v") || "").slice(0, 80),
    ]),
    old = cache.get(key);
  if (!fresh && !p.get("fresh") && old && Date.now() - old.at < 20000)
    return old.value;
  const value = loadFacts(f, now);
  if (cache.size >= 12) cache.clear();
  cache.set(key, { at: Date.now(), value });
  try {
    return await value;
  } catch (e) {
    if (cache.get(key)?.value === value) cache.delete(key);
    throw e;
  }
}
function scoped(data: ProductRow[], f: ProductFilter) {
  return data.filter((p) => match(p, f));
}
function filtered(data: ProductRow[], f: ProductFilter) {
  const b = dateBounds(f.from, f.to);
  const a = scoped(data, f).filter(
    (p) =>
      (!["sales", "attention", "legacy"].includes(f.group)
        ? !p.missing
        : true) &&
      (f.status === "all" ||
        (!p.missing && !!p.active === (f.status === "active"))) &&
      (f.group === "all" ||
        (f.group === "ready" && p.ready) ||
        (f.group === "unready" && !p.ready) ||
        (f.group === "sales" && p.servings > 0) ||
        (f.group === "new" &&
          p.created_at &&
          parseUTC(p.created_at) >= b.start &&
          parseUTC(p.created_at) < b.end) ||
        (f.group === "attention" && p.alerts.length) ||
        (f.group === "no_menu" && !p.first_menu) ||
        (f.group === "legacy" && p.missing)),
  );
  const value = (p: ProductRow) =>
    f.sort === "newest"
      ? p.created_at
        ? parseUTC(p.created_at).getTime()
        : 0
      : f.sort === "rating"
        ? (p.period_rating ?? -1)
        : f.sort === "attention"
          ? p.alerts.length
          : Number(p[f.sort] || 0);
  return a.sort((a, b) => value(b) - value(a) || a.id.localeCompare(b.id));
}
function pageOf(a: R[], page: number) {
  const total = a.length,
    pages = Math.max(1, Math.ceil(total / 20)),
    n = Math.min(page, pages);
  return {
    items: a.slice((n - 1) * 20, n * 20),
    total,
    pages,
    page: n,
    pageSize: 20,
  };
}
export async function saveProductThresholds(user: Actor, input: unknown) {
  if (user.role !== "admin")
    throw new AppError("Không có quyền quản trị.", 403);
  const b = productThresholdSchema.parse(input);
  await transaction(async (db) => {
    await exec(
      "INSERT INTO platform_settings VALUES ('product_analytics_thresholds',?) ON DUPLICATE KEY UPDATE value=VALUES(value)",
      [JSON.stringify(b)],
      db,
    );
    await audit(db, user, "product.analytics.thresholds", null, b);
    await analyticsLive(db, user.id);
  });
  clearProductReports();
  return { ok: true };
}
export async function adminProductAnalytics(
  section: string,
  params: URLSearchParams,
  now = new Date(),
) {
  if (!["summary", "trends", "operations", "list", "supply"].includes(section))
    throw new AppError("Báo cáo sản phẩm không hợp lệ.", 404);
  const f = parse(params, now),
    loaded = await facts(
      f,
      params,
      now,
      section === "operations" || section === "supply",
    ),
    a = scoped(loaded.data, f),
    catalog = a.filter((p) => !p.missing),
    b = dateBounds(f.from, f.to);
  if (section === "list") {
    const page = pageOf(filtered(loaded.data, f), f.page);
    return { ...page, products: page.items };
  }
  if (section === "summary") {
    const previousBounds = dateBounds(
      previousFilter(f).from,
      previousFilter(f).to,
    );
    const current = {
        sold: a.filter((p) => p.servings > 0).length,
        servings: a.reduce((n, p) => n + p.servings, 0),
        gmv: a.reduce((n, p) => n + p.gmv, 0),
        new: catalog.filter(
          (p) =>
            parseUTC(p.created_at) >= b.start && parseUTC(p.created_at) < b.end,
        ).length,
      },
      previous = {
        sold: a.filter((p) => p.previous_servings > 0).length,
        servings: a.reduce((n, p) => n + p.previous_servings, 0),
        gmv: a.reduce((n, p) => n + p.previous_gmv, 0),
        new: catalog.filter(
          (p) =>
            parseUTC(p.created_at) >= previousBounds.start &&
            parseUTC(p.created_at) < previousBounds.end,
        ).length,
      };
    const options = loaded.data,
      regions = new Map(
        options.map((p) => [
          p.region,
          {
            id: p.region,
            label:
              p.region === "unknown"
                ? "Chưa xác định"
                : (p.area ? p.area + " · " : "") + regionLabel(p.region),
          },
        ]),
      ),
      chefs = new Map(
        options.map((p) => [
          p.chef_id,
          { id: p.chef_id, name: p.chef_name || "Bếp không còn hồ sơ" },
        ]),
      );
    const [quality] = await rows<R>(
      productLedger +
        ` SELECT COUNT(DISTINCT l.id) orders,COUNT(DISTINCT CASE WHEN x.session_id IS NOT NULL THEN l.id END) tracked FROM product_orders l LEFT JOIN analytics_order_context x ON x.order_id=l.id WHERE l.created_at>=? AND l.created_at<? AND (?='' OR l.meal_id=?) AND l.product_id IN (${a.length ? a.map(() => "?").join(",") : "NULL"})`,
      [...bounds(f), f.meal, f.meal, ...a.map((p) => p.id)],
    );
    return {
      metrics: {
        total: catalog.length,
        active: catalog.filter((p) => p.active).length,
        ready: catalog.filter((p) => p.ready).length,
        sold: current.sold,
        servings: current.servings,
        gmv: current.gmv,
        new: catalog.filter(
          (p) =>
            parseUTC(p.created_at) >= b.start && parseUTC(p.created_at) < b.end,
        ).length,
        attention: a.filter((p) => p.alerts.length).length,
      },
      previous,
      delta: Object.fromEntries(
        Object.keys(current).map((k) => [
          k,
          metricDelta(
            current[k as keyof typeof current],
            previous[k as keyof typeof previous],
          ),
        ]),
      ),
      regions: [...regions.values()].sort((a, b) => a.id.localeCompare(b.id)),
      chefs: [...chefs.values()].sort((a, b) => a.name.localeCompare(b.name)),
      thresholds: loaded.thresholds,
      sla: loaded.sla,
      missingProducts: a.filter((p) => p.missing && p.servings > 0).length,
      trackingStartedAt:
        a
          .map((p) => p.tracking_started_at)
          .filter(Boolean)
          .sort()[0] || null,
      trackingCoverage: {
        orders: Number(quality.orders),
        tracked: Number(quality.tracked),
      },
      updatedAt: loaded.at,
    };
  }
  if (section === "operations") {
    const category = params.get("category") || "all";
    if (!["all", "operation", "content", "performance"].includes(category))
      throw new AppError("Nhóm cảnh báo không hợp lệ.");
    const alerts = a
      .flatMap((p) =>
        p.alerts.map((alert) => ({
          ...alert,
          productId: p.id,
          productName: p.name,
          chefId: p.chef_id,
          chefName: p.chef_name,
        })),
      )
      .sort(
        (a, b) =>
          a.priority - b.priority || a.productId.localeCompare(b.productId),
      );
    return {
      alerts: alerts
        .filter((alert) => category === "all" || alert.category === category)
        .slice(0, 30),
      total: alerts.length,
      matched: alerts.filter(
        (alert) => category === "all" || alert.category === category,
      ).length,
      products: a.filter((p) => p.alerts.length).length,
      updatedAt: loaded.at,
    };
  }
  const ids = a.map((p) => p.id),
    where = `l.product_id IN (${ids.length ? ids.map(() => "?").join(",") : "NULL"}) AND (?='' OR l.meal_id=?)`,
    scopeValues = [...ids, f.meal, f.meal];
  if (section === "trends") {
    const prev = previousFilter(f),
      [from, to] = bounds(f),
      [pf, pt] = bounds(prev);
    const days = await rows<R>(
      productLedger +
        ` SELECT DATE(DATE_ADD(l.completed_at,INTERVAL 7 HOUR)) day,SUM(l.quantity) servings,SUM(l.amount) gmv FROM product_orders l WHERE l.completed_at>=? AND l.completed_at<? AND ${where} GROUP BY day ORDER BY day`,
      [pf, to, ...scopeValues],
    );
    const map = new Map(
        days.map((d) => [String(d.day).slice(0, 10), numbers(d)]),
      ),
      series = [];
    for (
      let day = f.from, old = prev.from;
      day <= f.to;
      day = shiftDate(day, 1), old = shiftDate(old, 1)
    )
      series.push({
        day,
        servings: map.get(day)?.servings || 0,
        gmv: map.get(day)?.gmv || 0,
        previous_day: old,
        previous_servings: map.get(old)?.servings || 0,
        previous_gmv: map.get(old)?.gmv || 0,
      });
    const top = (field: string) =>
      [...a]
        .filter((p) => p.servings > 0)
        .sort((x, y) => y[field] - x[field] || x.id.localeCompare(y.id))
        .slice(0, 10)
        .map((p) => ({
          id: p.id,
          name: p.name,
          chef_name: p.chef_name,
          image_url: p.image_url,
          servings: p.servings,
          gmv: p.gmv,
          orders: p.orders,
        }));
    const [quality] = await rows<R>(
      productLedger +
        ` SELECT COUNT(DISTINCT CASE WHEN l.legacy_completed THEN l.id END) legacyOrders,COUNT(DISTINCT CASE WHEN l.allocation_warning THEN l.id END) allocationWarnings FROM product_orders l WHERE l.completed_at>=? AND l.completed_at<? AND ${where}`,
      [from, to, ...scopeValues],
    );
    return {
      days: series,
      tops: {
        servings: top("servings"),
        gmv: top("gmv"),
        orders: top("orders"),
      },
      quality: numbers(quality),
    };
  }
  const cells = new Map<string, R>();
  for (const p of catalog) {
    for (const m of p.offers as R[]) {
      const key = p.region + ":" + m.meal_id;
      if (!cells.has(key))
        cells.set(key, {
          region: p.region,
          area: p.area,
          meal_id: m.meal_id,
          productIds: new Set(),
          chefIds: new Set(),
          menuDays: new Set(),
          stock: 0,
        });
      const cell = cells.get(key)!;
      if (m.ready) {
        cell.productIds.add(p.id);
        cell.chefIds.add(p.chef_id);
        cell.stock += m.stock;
      }
    }
  }
  const historical = await rows<R>(
    `SELECT CASE WHEN c.lat BETWEEN -90 AND 90 AND c.lng BETWEEN -180 AND 180 AND (c.lat<>0 OR c.lng<>0) THEN CONCAT(ROUND(c.lat*50),':',ROUND(c.lng*50)) ELSE 'unknown' END region,m.meal_id,COUNT(DISTINCT k.service_date) menu_days FROM daily_menu m JOIN kitchen_sessions k ON k.id=m.session_id JOIN products p ON p.id=m.product_id JOIN chefs c ON c.id=p.chef_id WHERE k.service_date>=? AND k.service_date<=? AND m.product_id IN (${ids.length ? ids.map(() => "?").join(",") : "NULL"}) AND (?='' OR m.meal_id=?) GROUP BY region,m.meal_id`,
    [f.from, f.to, ...scopeValues],
  );
  for (const h of historical) {
    const key = h.region + ":" + h.meal_id;
    if (!cells.has(key))
      cells.set(key, {
        region: h.region,
        area: catalog.find((p) => p.region === h.region)?.area || "",
        meal_id: h.meal_id,
        productIds: new Set(),
        chefIds: new Set(),
        stock: 0,
      });
    cells.get(key)!.menu_days = Number(h.menu_days);
  }
  const heatmap = await rows<R>(
    productLedger +
      ` SELECT WEEKDAY(DATE_ADD(l.completed_at,INTERVAL 7 HOUR)) weekday,l.meal_id,SUM(l.quantity) servings FROM product_orders l WHERE l.completed_at>=? AND l.completed_at<? AND ${where} GROUP BY weekday,l.meal_id`,
    [...bounds(f), ...scopeValues],
  );
  return {
    cells: [...cells.values()]
      .map((c) => ({
        region: c.region,
        label:
          c.region === "unknown"
            ? "Chưa xác định"
            : (c.area ? c.area + " · " : "") + regionLabel(c.region),
        meal_id: c.meal_id,
        products: c.productIds.size,
        chefs: c.chefIds.size,
        stock: c.stock,
        menu_days: c.menu_days || 0,
      }))
      .sort(
        (a, b) =>
          a.region.localeCompare(b.region) ||
          a.meal_id.localeCompare(b.meal_id),
      ),
    heatmap: heatmap.map(numbers),
    updatedAt: loaded.at,
  };
}
export async function adminProductDetail(
  id: string,
  params: URLSearchParams,
  now = new Date(),
) {
  const f = parse(params, now),
    panel = params.get("panel") || "overview";
  if (!Object.hasOwn(PRODUCT_PANELS, panel))
    throw new AppError("Mục chi tiết món không hợp lệ.");
  const loaded = await facts(f, params, now),
    product = loaded.data.find((p) => p.id === id);
  if (!product) throw new AppError("Không tìm thấy món hoặc lịch sử món.", 404);
  const meal = " AND (?='' OR l.meal_id=?)",
    mv = [f.meal, f.meal],
    p = bounds(f);
  async function paginate(
    sql: string,
    values: unknown[],
    sort: string,
    cte = "",
  ) {
    const [count] = await rows<R>(
      cte + ` SELECT COUNT(*) total FROM (${sql}) records`,
      values,
    );
    const total = Number(count.total),
      pages = Math.max(1, Math.ceil(total / 20)),
      page = Math.min(f.page, pages),
      items = await rows<R>(cte + sql + ` ORDER BY ${sort} LIMIT 20 OFFSET ?`, [
        ...values,
        (page - 1) * 20,
      ]);
    return { items: items.map(numbers), total, pages, page };
  }
  if (panel === "menu")
    return {
      product,
      ...(await paginate(
        `SELECT m.*,k.service_date,k.is_open,p.price,p.active,CASE WHEN ca.active AND ca.starts_at<=? AND ca.ends_at>? AND m.sale_price>0 AND m.sale_price<p.price THEN m.sale_price ELSE p.price END current_price FROM daily_menu m JOIN kitchen_sessions k ON k.id=m.session_id JOIN products p ON p.id=m.product_id LEFT JOIN campaigns ca ON ca.id=m.campaign_id WHERE m.product_id=? AND k.service_date>=? AND k.service_date<=? AND (?='' OR m.meal_id=?)`,
        [sqlDate(now), sqlDate(now), id, f.from, f.to, ...mv],
        "k.service_date DESC,m.cutoff_at DESC,m.id",
      )),
      offers: product.offers,
    };
  if (panel === "orders") {
    const focus = params.get("focus") || "period",
      dateBy = params.get("dateBy") || "created";
    if (
      !["period", "issues"].includes(focus) ||
      !["created", "completed"].includes(dateBy)
    )
      throw new AppError("Bộ lọc đơn không hợp lệ.");
    const conditions =
      focus === "issues"
        ? `EXISTS(SELECT 1 FROM payment_exceptions e LEFT JOIN payment_request_details d ON d.exception_id=e.id WHERE e.order_id=l.id AND e.status IN ('OPEN','REVIEW') AND (e.actor_id<>l.user_id OR d.exception_id IS NOT NULL))`
        : `l.${dateBy === "completed" ? "completed_at" : "created_at"}>=? AND l.${dateBy === "completed" ? "completed_at" : "created_at"}<?`;
    const result = await paginate(
      `SELECT l.id,l.code,l.status,l.payment_status,l.total,l.created_at,l.completed_at,l.quantity,l.gross,l.amount,l.item_name,l.item_image,l.chef_rejected,l.user_cancelled,l.other_cancelled,l.legacy_completed,l.allocation_warning,(SELECT GROUP_CONCAT(DISTINCT e.status ORDER BY e.status) FROM payment_exceptions e LEFT JOIN payment_request_details d ON d.exception_id=e.id WHERE e.order_id=l.id AND (e.actor_id<>l.user_id OR d.exception_id IS NOT NULL)) request_status FROM product_orders l WHERE l.product_id=? AND ${conditions}${meal}`,
      [id, ...(focus === "issues" ? [] : p), ...mv],
      "l.created_at DESC,l.id DESC",
      productLedger,
    );
    return { product, ...result, focus, dateBy };
  }
  if (panel === "reviews") {
    const sort = params.get("reviewSort") || "recent";
    if (!["recent", "highest", "lowest"].includes(sort))
      throw new AppError("Sắp xếp đánh giá không hợp lệ.");
    const result = await paginate(
      `SELECT r.id,r.rating,r.body,r.created_at,u.name user_name,l.code,l.id order_id,(SELECT GROUP_CONCAT(DISTINCT i.name ORDER BY i.name SEPARATOR ', ') FROM order_items i WHERE i.order_id=l.id) dishes FROM product_orders l JOIN reviews r ON r.order_id=l.id AND r.user_id=l.user_id AND r.chef_id=l.chef_id JOIN users u ON u.id=r.user_id WHERE l.product_id=? AND l.status='COMPLETED' AND r.created_at>=? AND r.created_at<?${meal}`,
      [id, ...p, ...mv],
      (sort === "highest"
        ? "r.rating DESC,"
        : sort === "lowest"
          ? "r.rating ASC,"
          : "") + "r.created_at DESC,r.id DESC",
      productLedger,
    );
    const distribution = await rows<R>(
      productLedger +
        ` SELECT r.rating,COUNT(*) count FROM product_orders l JOIN reviews r ON r.order_id=l.id AND r.user_id=l.user_id AND r.chef_id=l.chef_id WHERE l.product_id=? AND l.status='COMPLETED' AND r.created_at>=? AND r.created_at<?${meal} GROUP BY r.rating`,
      [id, ...p, ...mv],
    );
    return { product, ...result, distribution: distribution.map(numbers) };
  }
  if (panel === "history")
    return {
      product,
      ...(await paginate(
        "SELECT a.id,a.action,a.detail,a.created_at,u.name actor_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE a.entity_id=? AND a.action IN ('product.created','product.updated','product.active')",
        [id],
        "a.created_at DESC,a.id DESC",
      )),
      trackingStartedAt: product.tracking_started_at || null,
    };
  const [buyers] = await rows<R>(
    productLedger +
      `, purchases AS (SELECT l.*,ROW_NUMBER() OVER(PARTITION BY user_id ORDER BY completed_at,id) purchase_no FROM product_orders l WHERE product_id=? AND completed_at IS NOT NULL) SELECT COUNT(DISTINCT user_id) buyers,COUNT(DISTINCT CASE WHEN purchase_no=1 THEN user_id END) first_buyers,COUNT(DISTINCT CASE WHEN purchase_no>1 THEN user_id END) repeat_buyers FROM purchases l WHERE l.completed_at>=? AND l.completed_at<?${meal}`,
    [id, ...p, ...mv],
  );
  return {
    product,
    buyers: numbers(buyers),
    thresholds: loaded.thresholds,
    sla: loaded.sla,
  };
}
