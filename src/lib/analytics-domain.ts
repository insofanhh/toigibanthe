import { MEALS, serviceDate } from "./domain";

export const ANALYTICS_EVENTS = [
  "catalog",
  "dish_view",
  "cart_add",
  "checkout",
  "order_created",
] as const;
export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];
export type AnalyticsFilter = {
  from: string;
  to: string;
  region: string;
  meal: string;
};
export const GOAL_METRICS = {
  completed: "Đơn hoàn thành",
  gmv: "Doanh số món",
  buyers: "Khách mua",
  sellers: "Bếp có đơn",
  repeat30: "Mua lại trong 30 ngày",
  cancelRate: "Tỷ lệ hủy / từ chối",
} as const;
export type GoalMetric = keyof typeof GOAL_METRICS;
export function validDate(s: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s
  );
}
export function shiftDate(s: string, days: number) {
  return new Date(Date.parse(s + "T00:00:00Z") + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function dateBounds(from: string, to: string) {
  return {
    start: new Date(from + "T00:00:00+07:00"),
    end: new Date(shiftDate(to, 1) + "T00:00:00+07:00"),
  };
}
export function analyticsFilter(
  params: URLSearchParams,
  now = new Date(),
): AnalyticsFilter {
  const to = params.get("to") || serviceDate(now),
    from = params.get("from") || shiftDate(to, -29);
  const region = params.get("region") || "",
    meal = params.get("meal") || "";
  if (
    !validDate(from) ||
    !validDate(to) ||
    from > to ||
    to > serviceDate(now) ||
    (Date.parse(to) - Date.parse(from)) / 86400000 > 365
  )
    throw new Error(
      "Chọn khoảng ngày hợp lệ, tối đa 366 ngày và không vượt hôm nay.",
    );
  if (meal && !MEALS.includes(meal as (typeof MEALS)[number]))
    throw new Error("Bữa ăn không hợp lệ.");
  if (region && !/^-?\d{1,4}:-?\d{1,5}$/.test(region))
    throw new Error("Khu vực không hợp lệ.");
  if (region) {
    const p = region.split(":").map(Number);
    if (Math.abs(p[0]) > 4500 || Math.abs(p[1]) > 9000)
      throw new Error("Khu vực không hợp lệ.");
  }
  return { from, to, region, meal };
}
export function previousFilter(f: AnalyticsFilter): AnalyticsFilter {
  const days =
    Math.round((Date.parse(f.to) - Date.parse(f.from)) / 86400000) + 1;
  return { ...f, from: shiftDate(f.from, -days), to: shiftDate(f.from, -1) };
}
export function regionCell(lat: number, lng: number) {
  return `${Math.round(lat * 50)}:${Math.round(lng * 50)}`;
}
export function regionLabel(cell: string) {
  const [lat, lng] = cell.split(":").map((n) => Number(n) / 50);
  return `Vùng ${lat.toFixed(2)}, ${lng.toFixed(2)}`;
}
export function ratio(n: number, d: number) {
  return d ? (n / d) * 100 : null;
}
export function metricDelta(current: number | null, previous: number | null) {
  return current === null || previous === null || !previous
    ? null
    : ((current - previous) / previous) * 100;
}
export function csvCell(value: unknown) {
  let s = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function csvDocument(rows: unknown[][]) {
  return "\ufeff" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
