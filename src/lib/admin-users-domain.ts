import { analyticsFilter, shiftDate } from "./analytics-domain";

export function usersDateRange(params: URLSearchParams, today: string) {
  const to = params.get("to") || today;
  return { from: params.get("from") || shiftDate(to, -29), to };
}

export const USER_GROUPS = {
  all: "Tất cả nhóm",
  never: "Chưa từng mua",
  once: "Mua một lần",
  repeat: "Mua nhiều lần",
} as const;
export const USER_SEGMENTS = {
  all: "Tất cả tài khoản",
  registered: "Đăng ký trong kỳ",
  buyers: "Có mua trong kỳ",
  first: "Mua lần đầu trong kỳ",
  returning: "Mua lại trong kỳ",
} as const;
export const USER_SORTS = {
  newest: "Đăng ký mới nhất",
  orders: "Nhiều đơn hoàn thành",
  spend: "Giá trị mua cao nhất",
  recent: "Mua gần nhất",
} as const;
export type UsersFilter = {
  from: string;
  to: string;
  role: string;
  status: string;
  q: string;
  group: keyof typeof USER_GROUPS;
  segment: keyof typeof USER_SEGMENTS;
  sort: keyof typeof USER_SORTS;
  page: number;
};
export function usersFilter(params: URLSearchParams): UsersFilter {
  const dates = analyticsFilter(
    new URLSearchParams({
      from: params.get("from") || "",
      to: params.get("to") || "",
    }),
  );
  const role = params.get("role") || "all",
    status = params.get("status") || "all",
    q = (params.get("q") || "").trim();
  const group = params.get("group") || "all",
    segment = params.get("segment") || "all",
    sort = params.get("sort") || "newest",
    rawPage = params.get("page") || "1";
  if (
    !["all", "user", "chef", "admin"].includes(role) ||
    !["all", "open", "locked"].includes(status) ||
    q.length > 100 ||
    !Object.hasOwn(USER_GROUPS, group) ||
    !Object.hasOwn(USER_SEGMENTS, segment) ||
    !Object.hasOwn(USER_SORTS, sort) ||
    !/^[1-9]\d{0,6}$/.test(rawPage)
  )
    throw new Error("Bộ lọc tài khoản không hợp lệ.");
  return {
    from: dates.from,
    to: dates.to,
    role,
    status,
    q,
    group: group as UsersFilter["group"],
    segment: segment as UsersFilter["segment"],
    sort: sort as UsersFilter["sort"],
    page: Number(rawPage),
  };
}
export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  active: number;
  created_at: string;
  completed_orders: number;
  food_value: number;
  first_purchase: string | null;
  last_purchase: string | null;
  period_orders: number;
  registered: number;
  period_buyer: number;
  period_first: number;
  period_returning: number;
};
export type UsersReport = {
  metrics: {
    total: number;
    registered: number;
    buyers: number;
    first: number;
    returning: number;
    locked: number;
  };
  groups: { never: number; once: number; repeat: number };
  days: { day: string; registered: number; first: number }[];
  filter: UsersFilter;
};
export type UsersList = {
  users: AdminUserRow[];
  total: number;
  page: number;
  pages: number;
  pageSize: number;
};
export type UserDetail = {
  user: AdminUserRow;
  counts: { status: string; count: number }[];
  orders: {
    id: string;
    code: string;
    status: string;
    total: number;
    chef_name: string;
    created_at: string;
    summary: string;
  }[];
  total: number;
  page: number;
  pages: number;
  requests: {
    id: string;
    order_id: string;
    code: string;
    kind: string;
    status: string;
    amount: number;
    created_at: string;
  }[];
};
