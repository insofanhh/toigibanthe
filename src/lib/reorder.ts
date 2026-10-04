import { rows } from "./db";
import { getOrder } from "./orders";
import { AppError } from "./http";
import {
  effectivePrice,
  haversine,
  MEAL_NAMES,
  parseUTC,
  serviceDate,
  type Actor,
  type MealId,
} from "./domain";

export type ReorderOption = {
  productId: string;
  name: string;
  eligible: boolean;
  reason: string;
  menuId: string | null;
  cutoffAt: string | null;
  price: number | null;
  href: string | null;
};
export type ReorderResult = { options: ReorderOption[]; serverNow: string };
type Product = {
  product_id: string;
  name: string;
  original_meal: MealId;
  current_product_id: string | null;
  product_active: number;
  price: number;
  chef_status: string;
  owner_active: number;
  lat: number;
  lng: number;
  radius_km: number;
  account_no: string;
  bank_bin: string;
  account_name: string;
};
type Menu = {
  id: string;
  product_id: string;
  meal_id: MealId;
  is_open: number;
  enabled: number;
  stock: number;
  cutoff_at: string;
  sale_price: number | null;
  campaign_active: number;
  starts_at: string | null;
  ends_at: string | null;
};

/** Read current menus; the original order's menu, prices and voucher are never reused. */
export async function getReorderOptions(
  user: Actor,
  orderId: string,
  location: { lat: number; lng: number },
): Promise<ReorderResult> {
  const order = await getOrder(orderId, user);
  if (order.user_id !== user.id)
    throw new AppError("Chỉ khách đặt đơn được đặt lại món.", 403);
  if (order.status !== "COMPLETED")
    throw new AppError("Chỉ đặt lại món từ đơn đã hoàn thành.", 409);
  const products = await rows<Product>(
    `SELECT oi.product_id,oi.name,om.meal_id original_meal,p.id current_product_id,p.active product_active,p.price,
     c.status chef_status,u.active owner_active,c.lat,c.lng,c.radius_km,c.account_no,c.bank_bin,c.account_name
     FROM order_items oi LEFT JOIN daily_menu om ON om.id=oi.menu_id
     LEFT JOIN products p ON p.id=oi.product_id LEFT JOIN chefs c ON c.id=p.chef_id
     LEFT JOIN users u ON u.id=c.user_id WHERE oi.order_id=? ORDER BY oi.id`,
    [orderId],
  );
  const now = new Date(),
    date = serviceDate(now);
  const previousDay = new Date(`${date}T12:00:00+07:00`);
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  const menus = products.length
    ? await rows<Menu>(
        `SELECT m.*,k.is_open,ca.active campaign_active,ca.starts_at,ca.ends_at
     FROM daily_menu m JOIN kitchen_sessions k ON k.id=m.session_id
     JOIN meal_settings ms ON ms.id=m.meal_id LEFT JOIN campaigns ca ON ca.id=m.campaign_id
     WHERE m.product_id IN (${products.map(() => "?").join(",")})
     AND (k.service_date=? OR (k.service_date=? AND ms.day_offset=1))`,
        [...products.map((p) => p.product_id), date, serviceDate(previousDay)],
      )
    : [];
  const time = Date.now();
  return {
    serverNow: new Date(time).toISOString(),
    options: products.map((p) => {
      const candidates = menus
        .filter((m) => m.product_id === p.product_id)
        .sort(
          (a, b) =>
            Number(b.meal_id === p.original_meal) -
              Number(a.meal_id === p.original_meal) ||
            parseUTC(a.cutoff_at).getTime() - parseUTC(b.cutoff_at).getTime() ||
            a.id.localeCompare(b.id),
        );
      let reason = "";
      if (!p.current_product_id || !p.product_active)
        reason = "Món đã ngừng bán.";
      else if (p.chef_status !== "approved" || !p.owner_active)
        reason = "Bếp hiện không hoạt động.";
      else if (haversine(location, p) > p.radius_km)
        reason = "Địa chỉ hiện tại nằm ngoài bán kính giao của bếp.";
      else if (!p.account_no || !p.bank_bin || !p.account_name)
        reason = "Bếp chưa cấu hình tài khoản nhận tiền.";
      else if (!candidates.length)
        reason = "Bếp chưa thêm món vào thực đơn đang nhận đặt.";
      const open = candidates.filter((m) => m.is_open);
      const enabled = open.filter((m) => m.enabled);
      const inTime = enabled.filter(
        (m) => parseUTC(m.cutoff_at).getTime() > time,
      );
      const available = inTime.find((m) => m.stock > 0);
      if (!reason && !available) {
        if (!open.length) reason = "Bếp đang đóng, chưa nhận đặt món.";
        else if (!enabled.length)
          reason = "Món chưa được bật trong thực đơn hiện tại.";
        else if (!inTime.length)
          reason = `Đã hết giờ nhận ${MEAL_NAMES[enabled[0].meal_id].toLocaleLowerCase("vi")}.`;
        else reason = "Món đã hết suất.";
      }
      const selected = !reason ? available : undefined;
      const campaign =
        selected?.campaign_active &&
        selected.starts_at &&
        selected.ends_at &&
        parseUTC(selected.starts_at).getTime() <= time &&
        parseUTC(selected.ends_at).getTime() > time;
      return {
        productId: p.product_id,
        name: p.name,
        eligible: Boolean(selected),
        reason,
        menuId: selected?.id || null,
        cutoffAt: selected ? parseUTC(selected.cutoff_at).toISOString() : null,
        price: selected
          ? effectivePrice(p.price, selected.sale_price, Boolean(campaign))
          : null,
        href: selected
          ? `/dishes/${encodeURIComponent(p.product_id)}?menu=${encodeURIComponent(selected.id)}`
          : null,
      };
    }),
  };
}
