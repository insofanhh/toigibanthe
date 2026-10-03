import { rows, sqlDate } from "./db";
import { AppError } from "./http";
import { haversine, effectivePrice, parseUTC, type Actor } from "./domain";
import { direction } from "./goong";
export async function quoteOrder(
  user: Actor,
  input: {
    items: { menuId: string; quantity: number }[];
    lat: number;
    lng: number;
    voucher?: string;
  },
) {
  let chefId = "",
    mealId = "",
    sessionId = "",
    subtotal = 0;
  const details = [];
  let chef: {
    lat: number;
    lng: number;
    radius_km: number;
    account_no: string;
    bank_bin: string;
    account_name: string;
    status: string;
  } | null = null;
  for (const item of input.items) {
    const m = (
      await rows<any>(
        "SELECT m.*,p.price,p.name,p.chef_id,p.active,k.is_open,c.lat,c.lng,c.radius_km,c.account_no,c.account_name,c.status,c.bank_bin,u.active owner_active,ca.active campaign_active,ca.starts_at,ca.ends_at FROM daily_menu m JOIN products p ON p.id=m.product_id JOIN kitchen_sessions k ON k.id=m.session_id JOIN chefs c ON c.id=p.chef_id JOIN users u ON u.id=c.user_id LEFT JOIN campaigns ca ON ca.id=m.campaign_id WHERE m.id=?",
        [item.menuId],
      )
    )[0];
    if (
      !m ||
      !m.active ||
      !m.is_open ||
      !m.enabled ||
      m.status !== "approved" ||
      !m.owner_active ||
      parseUTC(m.cutoff_at).getTime() <= Date.now() ||
      m.stock < item.quantity
    )
      throw new AppError("Món trong giỏ đã hết suất hoặc ngừng nhận.");
    if (
      chefId &&
      (m.chef_id !== chefId ||
        m.meal_id !== mealId ||
        m.session_id !== sessionId)
    )
      throw new AppError("Giỏ phải gồm một bếp và một bữa.");
    chefId = m.chef_id;
    mealId = m.meal_id;
    sessionId = m.session_id;
    chef = m;
    const active =
      Boolean(m.campaign_active) &&
      parseUTC(String(m.starts_at)).getTime() <= Date.now() &&
      parseUTC(String(m.ends_at)).getTime() > Date.now();
    const price = effectivePrice(m.price, m.sale_price, active);
    subtotal += price * item.quantity;
    details.push({
      menuId: item.menuId,
      name: m.name,
      price,
      quantity: item.quantity,
    });
  }
  if (!chef?.account_no || !chef.bank_bin || !chef.account_name)
    throw new AppError("Bếp chưa cấu hình tài khoản nhận tiền.");
  if (haversine(input, chef) > chef.radius_km)
    throw new AppError("Địa chỉ nằm ngoài bán kính giao của bếp.");
  const setting = (
    await rows<{ value: any }>(
      'SELECT value FROM platform_settings WHERE id="delivery"',
    )
  )[0];
  const fee =
    typeof setting?.value === "string"
      ? JSON.parse(setting.value)
      : setting?.value || { baseFee: 15000, perKm: 0 };
  const route = fee.perKm > 0 ? await direction(chef, input) : null;
  const deliveryFee =
    fee.baseFee +
    (fee.perKm > 0 ? Math.ceil(route!.distanceKm) * fee.perKm : 0);
  let discount = 0;
  if (input.voucher) {
    const v = (
      await rows<any>("SELECT * FROM vouchers WHERE code=?", [
        input.voucher.toUpperCase(),
      ])
    )[0];
    if (
      !v ||
      !v.active ||
      v.chef_id !== chefId ||
      v.min_subtotal > subtotal ||
      v.used_count >= v.max_uses ||
      parseUTC(v.expires_at).getTime() <= Date.now() ||
      (
        await rows(
          "SELECT * FROM voucher_redemptions WHERE voucher_id=? AND user_id=?",
          [v?.id || "", user.id],
        )
      ).length
    )
      throw new AppError("Voucher không áp dụng cho đơn này.");
    discount = Math.min(subtotal, v.discount_amount);
  }
  return {
    items: details,
    subtotal,
    discount,
    deliveryFee,
    total: subtotal - discount + deliveryFee,
  };
}
