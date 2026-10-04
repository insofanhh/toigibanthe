import { analyticsFilter } from "./analytics-domain";
import { ORDER_LABELS, ACTIVE_ORDER_STATUSES, parseUTC } from "./domain";
export const ORDER_REPORT_VIEWS = {
  list: "Danh sách đơn",
  current: "Theo dõi xử lý",
  payments: "Thanh toán",
  performance: "Phân tích vận hành",
} as const;
export const ORDER_REPORT_PANELS = {
  overview: "Tổng quan",
  timeline: "Tiến trình",
  payments: "Thanh toán & đối soát",
  delivery: "Giao hàng & phản hồi",
} as const;
export const ORDER_REPORT_GROUPS = {
  all: "Tất cả",
  active: "Đang xử lý",
  attention: "Cần chú ý",
  cancelled: "Hủy / từ chối",
  money: "Tiền cần kiểm tra",
  requests: "Có đối soát đang chờ",
  paid: "Đã có xác nhận tiền",
  unknown: "Trạng thái chưa xác định",
} as const;
export const ORDER_REPORT_SORTS = {
  newest: "Mới nhất",
  oldest: "Cũ nhất",
  waiting: "Tuổi chờ lâu nhất",
  amount: "Giá trị cao",
  priority: "Ưu tiên xử lý",
} as const;
export const ORDER_DATE_BY = {
  created: "Ngày tạo",
  paid: "Ngày xác nhận tiền",
  completed: "Ngày hoàn thành",
} as const;
export const ORDER_PAYMENT_LABELS: Record<string, string> = {
  PENDING: "Chờ tiền",
  PARTIAL: "Thiếu tiền",
  PAYMENT_REVIEW: "Cần đối soát",
  PAID_AUTO: "Đã xác nhận tự động",
  PAID_MANUAL: "Đã xác nhận thủ công",
  REFUND_PENDING: "Chờ hoàn",
  REFUNDED_MANUAL: "Đã ghi nhận hoàn thủ công",
  EXPIRED: "Hết hạn thanh toán",
};
export const ORDER_ACTORS = {
  all: "Mọi người thực hiện",
  chef: "Chef",
  customer: "Khách",
  admin: "Admin",
  system: "Hệ thống",
  unknown: "Chưa xác định",
} as const;
export const TRANSACTION_GROUPS = {
  linked: "Đã gắn đơn",
  valid: "Khoản hợp lệ",
  unmatched: "Chưa gắn đơn",
  invalid: "Cần kiểm tra",
  extra: "Tiền sau hạn / chuyển thêm",
} as const;
export const TRANSACTION_RESULTS: Record<string, string> = {
  PARTIAL: "Chuyển thiếu",
  PAID: "Đủ tiền",
  OVERPAID: "Chuyển thừa",
  LATE: "Sau hạn / đơn kết thúc",
  EXTRA_PAYMENT: "Chuyển thêm",
  UNMATCHED: "Chưa khớp đơn",
  ACCOUNT_MISMATCH: "Sai tài khoản",
  INVALID_DATE: "Thời gian không hợp lệ",
  RECEIVED: "Chưa kết luận",
  PAYMENT_REVIEW: "Cần kiểm tra",
};
export const VALID_RECEIPTS = [
  "PARTIAL",
  "PAID",
  "OVERPAID",
  "LATE",
  "EXTRA_PAYMENT",
] as const;
function enumValue<T extends Record<string, unknown>>(
  p: URLSearchParams,
  key: string,
  options: T,
  fallback: keyof T,
) {
  const v = p.get(key) || String(fallback);
  if (!Object.hasOwn(options, v)) throw new Error("Bộ lọc đơn không hợp lệ.");
  return v as keyof T;
}
export function orderReportFilter(p: URLSearchParams, now = new Date()) {
  const region = p.get("region") || "",
    base = analyticsFilter(
      new URLSearchParams({
        from: p.get("from") || "",
        to: p.get("to") || "",
        meal: p.get("meal") || "",
        region: region === "unknown" ? "" : region,
      }),
      now,
    ),
    q = (p.get("q") || "").trim(),
    chef = p.get("chef") || "",
    page = p.get("page") || "1",
    status = p.get("status") || "all",
    payment = p.get("payment") || "all",
    scope =
      p.get("scope") || (p.get("filter") === "active" ? "current" : "period"),
    source = p.get("source") || "all",
    txDate = p.get("txDate") || "bank",
    txQ = (p.get("txQ") || "").trim(),
    stage = p.get("stage") || "all";
  if (
    q.length > 100 ||
    txQ.length > 100 ||
    chef.length > 36 ||
    !/^[1-9]\d{0,6}$/.test(page) ||
    !["period", "current"].includes(scope) ||
    !["all", "auto", "manual", "unknown"].includes(source) ||
    !["bank", "received"].includes(txDate) ||
    (status !== "all" && !Object.hasOwn(ORDER_LABELS, status)) ||
    (payment !== "all" && !Object.hasOwn(ORDER_PAYMENT_LABELS, payment)) ||
    (stage !== "all" &&
      stage !== "PAYMENT_REPORTED" &&
      !Object.hasOwn(ORDER_LABELS, stage))
  )
    throw new Error("Bộ lọc đơn không hợp lệ.");
  return {
    ...base,
    region,
    q,
    chef,
    page: Number(page),
    status,
    payment,
    scope,
    source,
    txDate,
    txQ,
    stage,
    dateBy: enumValue(p, "dateBy", ORDER_DATE_BY, "created"),
    group: enumValue(
      p,
      "group",
      ORDER_REPORT_GROUPS,
      p.get("filter") === "active" ? "active" : "all",
    ),
    sort: enumValue(p, "sort", ORDER_REPORT_SORTS, "newest"),
    view: enumValue(p, "view", ORDER_REPORT_VIEWS, "list"),
    actor: enumValue(p, "actor", ORDER_ACTORS, "all"),
    txGroup: enumValue(p, "txGroup", TRANSACTION_GROUPS, "linked"),
  };
}
export type OrderReportFilter = ReturnType<typeof orderReportFilter>;
export type OrderReportRow = Record<string, any>;
export function orderAlerts(o: OrderReportRow) {
  const a: {
    key: string;
    label: string;
    panel: keyof typeof ORDER_REPORT_PANELS;
    priority: number;
  }[] = [];
  for (const [flag, key, label, panel, priority] of [
    ["refund_overdue", "refund", "Đối soát quá hạn", "payments", 0],
    [
      "late_money",
      "late_money",
      "Tiền sau hạn / chuyển thêm cần kiểm tra",
      "payments",
      0,
    ],
    ["late_accept", "accept", "Đã trả tiền, bếp chậm nhận", "timeline", 1],
    ["long_stage", "stage", "Giai đoạn cần kiểm tra", "timeline", 2],
    ["money_issue", "money", "Thanh toán cần kiểm tra", "payments", 1],
    ["open_requests", "requests", "Có đối soát đang chờ", "payments", 2],
    ["expiry_pending", "expiry", "Hết hạn chưa cập nhật", "timeline", 2],
    ["data_issue", "data", "Thiếu mốc / số liệu không khớp", "overview", 3],
  ] as const)
    if (Number(o[flag])) a.push({ key, label, panel, priority });
  return a.sort(
    (x, y) => x.priority - y.priority || x.key.localeCompare(y.key),
  );
}
export function orderAge(o: OrderReportRow, now = new Date()) {
  return ACTIVE_ORDER_STATUSES.includes(o.status as any) &&
    o.stage_at &&
    parseUTC(o.stage_at) <= now
    ? (now.getTime() - parseUTC(o.stage_at).getTime()) / 60000
    : null;
}
