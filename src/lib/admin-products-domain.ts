import { analyticsFilter } from "./analytics-domain";
import { parseUTC } from "./domain";
export const PRODUCT_GROUPS = {
  all: "Tất cả món",
  ready: "Đang nhận đơn",
  unready: "Chưa nhận được đơn",
  sales: "Có doanh số trong kỳ",
  new: "Mới trong kỳ",
  attention: "Cần chú ý",
  no_menu: "Chưa có thực đơn",
  legacy: "Lịch sử thiếu liên kết",
} as const;
export const PRODUCT_STATUSES = {
  all: "Tất cả trạng thái",
  active: "Đang bật",
  hidden: "Đã ẩn",
} as const;
export const PRODUCT_SORTS = {
  newest: "Mới nhất",
  servings: "Nhiều phần bán",
  gmv: "Doanh số cao",
  orders: "Nhiều đơn",
  rating: "Rating cao",
  attention: "Nhiều cảnh báo",
  views: "Nhiều phiên xem",
  favorites: "Nhiều lượt thích",
} as const;
export const PRODUCT_PANELS = {
  overview: "Tổng quan",
  menu: "Thực đơn & suất",
  orders: "Đơn có món",
  reviews: "Đánh giá & khách",
  history: "Hành vi & lịch sử",
} as const;
export const PRODUCT_VIEWS = {
  list: "Danh sách món",
  supply: "Nguồn cung theo bữa",
  behavior: "Hiệu quả & hành vi",
} as const;
export type ProductFilter = ReturnType<typeof productFilter>;
export function productFilter(p: URLSearchParams, now = new Date()) {
  const region = p.get("region") || "";
  const base = analyticsFilter(
    new URLSearchParams({
      from: p.get("from") || "",
      to: p.get("to") || "",
      meal: p.get("meal") || "",
      region: region === "unknown" ? "" : region,
    }),
    now,
  );
  const q = (p.get("q") || "").trim(),
    chef = p.get("chef") || "",
    group = p.get("group") || "all",
    status = p.get("status") || "all",
    sort = p.get("sort") || "newest",
    view = p.get("view") || "list",
    page = p.get("page") || "1";
  if (
    q.length > 100 ||
    chef.length > 36 ||
    !Object.hasOwn(PRODUCT_GROUPS, group) ||
    !Object.hasOwn(PRODUCT_STATUSES, status) ||
    !Object.hasOwn(PRODUCT_SORTS, sort) ||
    !Object.hasOwn(PRODUCT_VIEWS, view) ||
    !/^[1-9]\d{0,6}$/.test(page)
  )
    throw new Error("Bộ lọc sản phẩm không hợp lệ.");
  return {
    ...base,
    region,
    q,
    chef,
    group: group as keyof typeof PRODUCT_GROUPS,
    status: status as keyof typeof PRODUCT_STATUSES,
    sort: sort as keyof typeof PRODUCT_SORTS,
    view: view as keyof typeof PRODUCT_VIEWS,
    page: Number(page),
  };
}
export type ProductThresholds = {
  lowRating: number;
  minReviews: number;
  minMenuDays: number;
  minAgeDays: number;
};
export type ProductAlert = {
  key: string;
  label: string;
  count: number;
  panel: keyof typeof PRODUCT_PANELS;
  priority: number;
  category: "operation" | "content" | "performance";
  waitingSince?: string | null;
};
export type ProductRow = Record<string, any> & {
  id: string;
  name: string;
  chef_id: string;
  chef_name: string;
  active: number;
  missing: number;
  ready: boolean;
  operation: string;
  alerts: ProductAlert[];
};
export function productOperation(p: ProductRow, menus: Record<string, any>[]) {
  if (p.missing) return "Thiếu liên kết sản phẩm";
  if (!p.active) return "Món đã ẩn";
  if (p.chef_status !== "approved") return "Bếp chưa hoạt động";
  if (!p.owner_active) return "Tài khoản chủ bị khóa";
  if (!p.bank_ready) return "Chưa cấu hình ngân hàng";
  if (menus.some((m) => m.ready)) return "Đang nhận đơn";
  if (!menus.length) return "Chưa lên thực đơn";
  if (!menus.some((m) => m.is_open)) return "Bếp chưa mở";
  const open = menus.filter((m) => m.is_open);
  if (!open.some((m) => m.enabled)) return "Phiên bán đã tắt";
  if (!open.some((m) => m.enabled && !m.expired)) return "Bữa đã hết giờ";
  return "Không còn suất khả dụng";
}
export function productAlerts(
  p: ProductRow,
  now: Date,
  t: ProductThresholds,
): ProductAlert[] {
  const alerts: ProductAlert[] = [];
  if (p.missing) {
    if (p.servings > 0)
      alerts.push({
        key: "legacy",
        label: "Lịch sử thiếu liên kết",
        count: p.orders,
        panel: "overview",
        priority: 1,
        category: "content",
      });
    return alerts;
  }
  const missing = [
    !p.image_url ||
    p.image_url === "/icon.svg" ||
    /placeholder/i.test(p.image_url)
      ? "ảnh"
      : null,
    !p.description?.trim() ? "mô tả" : null,
    !p.ingredients?.trim() ? "thành phần" : null,
  ].filter(Boolean);
  if (missing.length)
    alerts.push({
      key: "content",
      label: "Thiếu " + missing.join(", "),
      count: missing.length,
      panel: "overview",
      priority: 3,
      category: "content",
    });
  if (p.review_count >= t.minReviews && p.period_rating < t.lowRating)
    alerts.push({
      key: "rating",
      label: "Đánh giá từ đơn thấp",
      count: p.review_count,
      panel: "reviews",
      priority: 1,
      category: "performance",
    });
  if (
    p.active &&
    p.chef_status === "approved" &&
    p.owner_active &&
    p.menu_days >= t.minMenuDays &&
    p.first_menu &&
    !p.servings &&
    now.getTime() - parseUTC(p.first_menu + "T00:00:00+07:00").getTime() >=
      t.minAgeDays * 86400000
  )
    alerts.push({
      key: "no_sales",
      label: "Có thực đơn · Chưa có đơn hoàn thành trong kỳ",
      count: p.menu_days,
      panel: "menu",
      priority: 3,
      category: "performance",
    });
  if (p.empty_offers)
    alerts.push({
      key: "stock",
      label: "Phiên không còn suất khả dụng",
      count: p.empty_offers,
      panel: "menu",
      priority: 2,
      category: "operation",
    });
  for (const [key, label, count, since] of [
    [
      "refund_open",
      "Đơn liên quan chờ đối soát chef",
      p.refund_open,
      p.oldest_refund_open_at,
    ],
    [
      "refund_review",
      "Đơn liên quan chờ đối soát admin",
      p.refund_review,
      p.oldest_refund_review_at,
    ],
  ] as const)
    if (count)
      alerts.push({
        key,
        label,
        count: Number(count),
        panel: "orders",
        priority: p.refund_overdue ? 0 : 2,
        category: "operation",
        waitingSince: since,
      });
  return alerts.sort(
    (a, b) => a.priority - b.priority || a.key.localeCompare(b.key),
  );
}
