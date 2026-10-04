export const MEALS = ["breakfast", "lunch", "dinner", "late"] as const;
export type MealId = (typeof MEALS)[number];
export const MEAL_NAMES: Record<MealId, string> = {
  breakfast: "Bữa sáng",
  lunch: "Bữa trưa",
  dinner: "Bữa tối",
  late: "Quẩy đêm",
};
export const money = (value: number) =>
  new Intl.NumberFormat("vi-VN").format(value) + "đ";
export function serviceDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function cutoffAt(date: string, time: string, offset = 0) {
  const result = new Date(`${date}T${time}:00+07:00`);
  result.setUTCDate(result.getUTCDate() + offset);
  return result;
}
export function haversine(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const rad = Math.PI / 180,
    dlat = (b.lat - a.lat) * rad,
    dlng = (b.lng - a.lng) * rad;
  const x =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dlng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
export function effectivePrice(
  base: number,
  sale: number | null,
  campaignActive: boolean,
) {
  return campaignActive && sale && sale > 0 && sale < base ? sale : base;
}
export const ORDER_LABELS: Record<string, string> = {
  PLACED: "Chờ thanh toán",
  PAID: "Đã thanh toán",
  ACCEPTED: "Bếp đã nhận",
  PREPARING: "Đang chuẩn bị",
  DELIVERING: "Đang giao",
  DELIVERED: "Đã giao",
  COMPLETED: "Hoàn thành",
  REJECTED: "Bếp từ chối",
  EXPIRED: "Hết hạn",
  CANCELLED: "Đã hủy",
};
export const ORDER_NEXT: Record<string, string> = {
  PAID: "ACCEPTED",
  ACCEPTED: "PREPARING",
  PREPARING: "DELIVERING",
  DELIVERING: "DELIVERED",
};
export const TERMINAL = ["COMPLETED", "REJECTED", "EXPIRED", "CANCELLED"];
export const ACTIVE_ORDER_STATUSES = [
  "PLACED",
  "PAID",
  "ACCEPTED",
  "PREPARING",
  "DELIVERING",
  "DELIVERED",
] as const;
export const PAYMENT_REQUEST_KINDS: Record<string, string> = {
  LATE: "Chuyển khoản sau hạn",
  UNDERPAID: "Chuyển thiếu",
  OVERPAID: "Chuyển thừa",
  DUPLICATE: "Chuyển hai lần",
  WRONG_REFERENCE: "Sai nội dung chuyển khoản",
  REFUND: "Yêu cầu hoàn tiền",
};
export const PAYMENT_REQUEST_STATUSES: Record<string, string> = {
  OPEN: "Chờ xử lý",
  REVIEW: "Chờ hệ thống",
  RESOLVED: "Đã xử lý",
  REFUNDED: "Đã xử lý",
};
export function parseUTC(value: string) {
  return new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z");
}
export function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}
export type Actor = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: "user" | "chef" | "admin";
  active: number;
};
export type Dish = {
  id: string;
  menuId: string;
  chefId: string;
  chefName: string;
  chefAvatar: string;
  name: string;
  description: string;
  ingredients: string;
  image: string;
  price: number;
  originalPrice: number;
  rating: number;
  ratingCount: number;
  distance: number;
  meal: MealId;
  stock: number;
  cutoffAt: string;
  prepMinutes: number;
  liked: boolean;
};
export type ChefCard = {
  id: string;
  name: string;
  bio: string;
  area: string;
  avatar: string;
  rating: number;
  ratingCount: number;
  completedOrders: number;
  distance: number;
};
export type Location = { address: string; lat: number; lng: number };
export type Feed = {
  dishes: Dish[];
  chefs: ChefCard[];
  meals: {
    id: MealId;
    name: string;
    cutoff: string;
    cutoffAt: string;
    disabled: boolean;
  }[];
  campaign: { id: string; name: string } | null;
  banners: {
    id: string;
    title: string;
    body: string;
    image_url: string | null;
    href: string;
  }[];
  serverNow: string;
  hasMore: boolean;
  cursor: number | null;
};
