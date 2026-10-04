import { analyticsFilter } from "./analytics-domain";
import { parseUTC } from "./domain";

export const CHEF_STATUSES = {
  all: "Tất cả hồ sơ",
  pending: "Chờ duyệt",
  approved: "Đã duyệt",
  needs_changes: "Cần bổ sung",
  rejected: "Từ chối",
  suspended: "Tạm ngưng",
} as const;
export const CHEF_GROUPS = {
  all: "Tất cả bếp",
  ready: "Đang nhận đơn",
  closed: "Chưa mở / chưa nhận được đơn",
  sales: "Có đơn hoàn thành trong kỳ",
  new: "Duyệt lần đầu trong kỳ",
  attention: "Cần chú ý",
} as const;
export const CHEF_SORTS = {
  newest: "Hồ sơ mới nhất",
  approved: "Duyệt mới nhất",
  gmv: "Doanh số món cao nhất",
  completed: "Nhiều đơn hoàn thành",
  rating: "Rating cao nhất",
  attention: "Nhiều cảnh báo nhất",
} as const;
export const CHEF_DETAIL_TABS = {
  overview: "Tổng quan",
  menu: "Thực đơn & sản phẩm",
  orders: "Đơn hàng",
  customers: "Khách & đánh giá",
  payments: "Đối soát",
  profile: "Hồ sơ & lịch sử",
} as const;
export type ChefFilter = {
  from: string;
  to: string;
  region: string;
  meal: string;
  q: string;
  status: keyof typeof CHEF_STATUSES;
  group: keyof typeof CHEF_GROUPS;
  sort: keyof typeof CHEF_SORTS;
  view: "list" | "approvals";
  page: number;
};
export function chefFilter(
  params: URLSearchParams,
  now = new Date(),
): ChefFilter {
  const region = params.get("region") || "",
    d = analyticsFilter(
      new URLSearchParams({
        from: params.get("from") || "",
        to: params.get("to") || "",
        meal: params.get("meal") || "",
        region: region === "unknown" ? "" : region,
      }),
      now,
    );
  const q = (params.get("q") || "").trim(),
    status = params.get("status") || "all",
    group = params.get("group") || "all",
    sort = params.get("sort") || "newest",
    view = params.get("view") || "list",
    page = params.get("page") || "1";
  if (
    q.length > 100 ||
    !Object.hasOwn(CHEF_STATUSES, status) ||
    !Object.hasOwn(CHEF_GROUPS, group) ||
    !Object.hasOwn(CHEF_SORTS, sort) ||
    !["list", "approvals"].includes(view) ||
    !/^[1-9]\d{0,6}$/.test(page)
  )
    throw new Error("Bộ lọc bếp không hợp lệ.");
  return {
    ...d,
    region,
    q,
    status: status as ChefFilter["status"],
    group: group as ChefFilter["group"],
    sort: sort as ChefFilter["sort"],
    view: view as ChefFilter["view"],
    page: Number(page),
  };
}
export type ChefThresholds = {
  activationDays: number;
  lowRating: number;
  minReviews: number;
  rejectRate: number;
  minPaid: number;
};
export type ChefSLA = {
  acceptMinutes: number;
  profileHours: number;
  refundHours: number;
};
export type ChefAlert = {
  key: string;
  label: string;
  count: number;
  detailTab: keyof typeof CHEF_DETAIL_TABS;
  priority: number;
};
export type ChefRow = {
  id: string;
  user_id: string;
  name: string;
  owner_name: string;
  email: string;
  phone: string;
  area: string;
  address: string;
  bio: string;
  avatar_url: string | null;
  region: string;
  radius_km: number;
  status: string;
  rejection_reason: string | null;
  created_at: string;
  owner_active: number;
  bank_ready: number;
  bank_name: string | null;
  account_no: string | null;
  account_name: string | null;
  approved_at: string | null;
  submitted_at: string;
  first_paid_at: string | null;
  first_completed_at: string | null;
  completed: number;
  gmv: number;
  delivery: number;
  placed: number;
  active_orders: number;
  paid_outcomes: number;
  chef_rejected: number;
  accept_median: number | null;
  accept_samples: number;
  products: number;
  dishes: number;
  servings: number;
  is_open: number;
  menu_days: number;
  last_menu: string | null;
  rating: number;
  rating_count: number;
  late_orders: number;
  oldest_paid_at: string | null;
  refund_open: number;
  refund_review: number;
  refund_amount: number;
  refund_overdue: number;
  oldest_refund_open_at?: string | null;
  oldest_refund_review_at?: string | null;
  ready: boolean;
  operation: string;
  alerts: ChefAlert[];
};
export function chefState(
  row: ChefRow,
  now: Date,
  mealOpen: boolean,
  sla: ChefSLA,
  t: ChefThresholds,
) {
  const alerts: ChefAlert[] = [],
    add = (
      key: string,
      label: string,
      count: number,
      detailTab: ChefAlert["detailTab"],
      priority: number,
    ) => alerts.push({ key, label, count, detailTab, priority });
  const ready =
    row.status === "approved" &&
    !!row.owner_active &&
    !!row.bank_ready &&
    row.dishes > 0;
  const operation =
    row.status !== "approved"
      ? "Hồ sơ chưa hoạt động"
      : !row.owner_active
        ? "Tài khoản chủ bị khóa"
        : !row.bank_ready
          ? "Chưa cấu hình ngân hàng"
          : ready
            ? "Đang nhận đơn"
            : !mealOpen
              ? "Hết giờ nhận"
              : row.is_open
                ? "Đã bật · Chưa có món hợp lệ"
                : "Chưa mở hôm nay";
  if (
    row.status === "pending" &&
    now.getTime() - parseUTC(row.submitted_at).getTime() >
      sla.profileHours * 3600000
  )
    add("profile", "Hồ sơ chờ duyệt quá hạn", 1, "profile", 1);
  if (row.late_orders)
    add("late", "Đơn chậm nhận", row.late_orders, "orders", 0);
  if (row.refund_open)
    add(
      "refund_open",
      "Đối soát chờ chef",
      row.refund_open,
      "payments",
      row.refund_overdue ? 0 : 2,
    );
  if (row.refund_review)
    add(
      "refund_review",
      "Đối soát chờ admin",
      row.refund_review,
      "payments",
      row.refund_overdue ? 0 : 2,
    );
  if (row.status === "approved" && row.owner_active) {
    if (!row.bank_ready)
      add("bank", "Chưa cấu hình ngân hàng", 1, "profile", 3);
    if (!row.products)
      add("products", "Chưa có sản phẩm hoạt động", 1, "menu", 3);
    else if (!row.last_menu) add("menu", "Chưa tạo thực đơn", 1, "menu", 3);
    if (
      row.approved_at &&
      !row.first_paid_at &&
      now.getTime() - parseUTC(row.approved_at).getTime() >=
        t.activationDays * 86400000
    )
      add("activation", "Chưa có đơn đã trả tiền đầu tiên", 1, "overview", 3);
  }
  if (row.rating_count >= t.minReviews && row.rating < t.lowRating)
    add("rating", "Đánh giá thấp", row.rating_count, "customers", 2);
  if (
    row.paid_outcomes >= t.minPaid &&
    (row.chef_rejected / row.paid_outcomes) * 100 > t.rejectRate
  )
    add("rejection", "Tỷ lệ từ chối cao", row.chef_rejected, "orders", 2);
  return {
    ...row,
    ready,
    operation,
    alerts: alerts.sort((a, b) => a.priority - b.priority),
  };
}
