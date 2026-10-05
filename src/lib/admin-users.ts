import { rows, sqlDate } from "./db";
import { AppError } from "./http";
import { dateBounds, shiftDate } from "./analytics-domain";
import {
  usersFilter,
  type UsersFilter,
  type AdminUserRow,
  type UsersReport,
} from "./admin-users-domain";
import { ensurePaymentRequestSchema } from "./payment-request-store";
import { ensureEmailVerificationSchema } from "./email-verification-schema";
import { ensureUserAccountSchema } from "./user-account-schema";

// Completed orders are ranked by immutable completion time, then ID to break ties.
const base = `WITH report_period AS (SELECT ? start_at,? end_at),
 completion_times AS (SELECT order_id,MIN(created_at) completed_at FROM order_events WHERE status='COMPLETED' GROUP BY order_id),
 completed AS (SELECT o.id,o.user_id,o.subtotal-o.discount food_value,COALESCE(e.completed_at,o.updated_at) completed_at FROM orders o LEFT JOIN completion_times e ON e.order_id=o.id WHERE o.status='COMPLETED'),
 purchases AS (SELECT c.*,ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY completed_at,id) purchase_no,completed_at>=p.start_at AND completed_at<p.end_at in_period FROM completed c CROSS JOIN report_period p),
 purchase_totals AS (SELECT user_id,COUNT(*) completed_orders,SUM(food_value) food_value,MIN(completed_at) first_purchase,MAX(completed_at) last_purchase,SUM(in_period) period_orders,MAX(in_period) period_buyer,MAX(in_period AND purchase_no=1) period_first,MAX(in_period AND purchase_no>1) period_returning FROM purchases GROUP BY user_id),
 accounts AS (SELECT u.id,u.name,u.email,u.phone,u.role,u.active,u.created_at,u.avatar_url,d.deleted_at,COALESCE(v.verified_at,g.created_at) email_verified_at,COALESCE(v.verification_required,0) email_verification_required,COALESCE(t.completed_orders,0) completed_orders,COALESCE(t.food_value,0) food_value,t.first_purchase,t.last_purchase,COALESCE(t.period_orders,0) period_orders,COALESCE(t.period_buyer,0) period_buyer,COALESCE(t.period_first,0) period_first,COALESCE(t.period_returning,0) period_returning,u.created_at>=p.start_at AND u.created_at<p.end_at registered FROM users u LEFT JOIN user_account_details d ON d.user_id=u.id LEFT JOIN user_email_status v ON v.user_id=u.id LEFT JOIN google_identities g ON g.user_id=u.id LEFT JOIN purchase_totals t ON t.user_id=u.id CROSS JOIN report_period p)`;
function parse(params: URLSearchParams) {
  try {
    return usersFilter(params);
  } catch (e) {
    throw new AppError((e as Error).message);
  }
}
function bounds(f: UsersFilter) {
  const b = dateBounds(f.from, f.to);
  return [sqlDate(b.start), sqlDate(b.end)];
}
function scope(f: UsersFilter) {
  const sql: string[] = ["1=1"],
    values: unknown[] = [];
  if (f.role !== "all") {
    sql.push("a.role=?");
    values.push(f.role);
  }
  if (f.status !== "all") {
    sql.push("a.active=?");
    values.push(f.status === "open" ? 1 : 0);
  }
  if (f.q) {
    sql.push(
      "(a.name LIKE ? ESCAPE '=' OR a.email LIKE ? ESCAPE '=' OR a.phone LIKE ? ESCAPE '=')",
    );
    const term = "%" + f.q.replace(/[=%_]/g, "=$&") + "%";
    values.push(term, term, term);
  }
  return { sql: sql.join(" AND "), values };
}
function normalize(r: AdminUserRow) {
  for (const k of [
    "active",
    "email_verification_required",
    "completed_orders",
    "food_value",
    "period_orders",
    "registered",
    "period_buyer",
    "period_first",
    "period_returning",
  ] as const)
    r[k] = Number(r[k]);
  return r;
}
export async function adminUsersReport(
  params: URLSearchParams,
): Promise<UsersReport> {
  await ensureUserAccountSchema();
  await ensureEmailVerificationSchema();
  const f = parse(params),
    s = scope(f),
    values = [...bounds(f), ...s.values];
  const [metrics, trend] = await Promise.all([
    rows<Record<string, number>>(
      base +
        ` SELECT COUNT(*) total,COALESCE(SUM(registered),0) registered,COALESCE(SUM(period_buyer),0) buyers,COALESCE(SUM(period_first),0) first,COALESCE(SUM(period_returning),0) returning,COALESCE(SUM(active=0),0) locked,COALESCE(SUM(completed_orders=0),0) never,COALESCE(SUM(completed_orders=1),0) once,COALESCE(SUM(completed_orders>1),0) repeat_count FROM accounts a WHERE ${s.sql}`,
      values,
    ),
    rows<{ day: string; registered: number; first: number }>(
      base +
        ` SELECT day,SUM(registered) registered,SUM(first_buyers) first FROM (
      SELECT DATE(DATE_ADD(a.created_at,INTERVAL 7 HOUR)) day,COUNT(*) registered,0 first_buyers FROM accounts a WHERE ${s.sql} AND a.registered=1 GROUP BY day
      UNION ALL SELECT DATE(DATE_ADD(p.completed_at,INTERVAL 7 HOUR)) day,0 registered,COUNT(*) first_buyers FROM purchases p JOIN accounts a ON a.id=p.user_id WHERE ${s.sql} AND p.in_period=1 AND p.purchase_no=1 GROUP BY day
    ) daily GROUP BY day ORDER BY day`,
      [...bounds(f), ...s.values, ...s.values],
    ),
  ]);
  const m = metrics[0],
    days: UsersReport["days"] = [],
    map = new Map(trend.map((d) => [String(d.day).slice(0, 10), d]));
  for (let day = f.from; day <= f.to; day = shiftDate(day, 1)) {
    const d = map.get(day);
    days.push({
      day,
      registered: Number(d?.registered || 0),
      first: Number(d?.first || 0),
    });
  }
  return {
    metrics: {
      total: Number(m.total),
      registered: Number(m.registered),
      buyers: Number(m.buyers),
      first: Number(m.first),
      returning: Number(m.returning),
      locked: Number(m.locked),
    },
    groups: {
      never: Number(m.never),
      once: Number(m.once),
      repeat: Number(m.repeat_count),
    },
    days,
    filter: f,
  };
}
export async function adminUsersList(params: URLSearchParams) {
  await ensureUserAccountSchema();
  await ensureEmailVerificationSchema();
  const f = parse(params),
    s = scope(f),
    predicates = [s.sql];
  if (f.group !== "all")
    predicates.push(
      f.group === "never"
        ? "a.completed_orders=0"
        : f.group === "once"
          ? "a.completed_orders=1"
          : "a.completed_orders>1",
    );
  if (f.segment !== "all")
    predicates.push(
      "a." +
        {
          registered: "registered",
          buyers: "period_buyer",
          first: "period_first",
          returning: "period_returning",
        }[f.segment] +
        "=1",
    );
  const where = predicates.join(" AND "),
    values = [...bounds(f), ...s.values];
  const [{ total: rawTotal }] = await rows<{ total: number }>(
    base + ` SELECT COUNT(*) total FROM accounts a WHERE ${where}`,
    values,
  );
  const total = Number(rawTotal),
    pageSize = 20,
    pages = Math.max(1, Math.ceil(total / pageSize)),
    page = Math.min(f.page, pages);
  const sort = {
    newest: "a.created_at DESC",
    orders: "a.completed_orders DESC",
    spend: "a.food_value DESC",
    recent: "a.last_purchase DESC",
  }[f.sort];
  const users = await rows<AdminUserRow>(
    base +
      ` SELECT a.*,(SELECT c.status FROM chefs c WHERE c.user_id=a.id) chef_status FROM accounts a WHERE ${where} ORDER BY ${sort},a.id DESC LIMIT ? OFFSET ?`,
    [...values, pageSize, (page - 1) * pageSize],
  );
  return { users: users.map(normalize), total, page, pages, pageSize };
}
export async function adminUserDetail(id: string, params: URLSearchParams) {
  await ensureUserAccountSchema();
  await ensureEmailVerificationSchema();
  const f = parse(params);
  const [raw] = await rows<AdminUserRow>(
    base +
      " SELECT a.*,(SELECT c.status FROM chefs c WHERE c.user_id=a.id) chef_status FROM accounts a WHERE a.id=?",
    [...bounds(f), id],
  );
  if (!raw) throw new AppError("Tài khoản không tồn tại.", 404);
  await ensurePaymentRequestSchema();
  const counts = await rows<{ status: string; count: number }>(
    "SELECT status,COUNT(*) count FROM orders WHERE user_id=? GROUP BY status",
    [id],
  );
  const total = counts.reduce((n, r) => n + Number(r.count), 0),
    pages = Math.max(1, Math.ceil(total / 20)),
    page = Math.min(f.page, pages);
  const [orders, requests] = await Promise.all([
    rows(
      `SELECT o.id,o.code,o.status,o.total,o.created_at,c.name chef_name,(SELECT GROUP_CONCAT(CONCAT(i.quantity,' × ',i.name) ORDER BY i.id SEPARATOR ', ') FROM order_items i WHERE i.order_id=o.id) summary FROM orders o JOIN chefs c ON c.id=o.chef_id WHERE o.user_id=? ORDER BY o.created_at DESC,o.id DESC LIMIT 20 OFFSET ?`,
      [id, (page - 1) * 20],
    ),
    rows(
      `SELECT r.id,r.order_id,o.code,r.kind,r.status,r.amount,r.created_at FROM payment_request_details d JOIN payment_exceptions r ON r.id=d.exception_id JOIN orders o ON o.id=d.order_id WHERE o.user_id=? ORDER BY r.created_at DESC,r.id DESC LIMIT 20`,
      [id],
    ),
  ]);
  return {
    user: normalize(raw),
    counts: counts.map((r) => ({ ...r, count: Number(r.count) })),
    orders,
    requests,
    total,
    page,
    pages,
  };
}
