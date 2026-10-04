import { randomUUID, randomBytes } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { rows, exec, transaction, sqlDate, type DB } from "./db";
import { AppError } from "./http";
import {
  haversine,
  parseUTC,
  effectivePrice,
  ORDER_NEXT,
  TERMINAL,
  ACTIVE_ORDER_STATUSES,
  CHEF_PROCESSING_ORDER_STATUSES,
  type Actor,
} from "./domain";
import { notify } from "./notifications";
import {
  ensureDeliveryReminderSchema,
  queueDeliveryReminder,
  cancelDeliveryReminder,
} from "./delivery-reminders";
import { direction } from "./goong";
import { ensureSePaySchema } from "./sepay-schema";
import { automaticPayment } from "./sepay-config";
import { ensureAnalyticsSchema } from "./analytics-schema";
import { analyticsLive } from "./analytics";
import { regionCell } from "./analytics-domain";
import {
  ensurePaymentRequestSchema,
  createCancellationRefundRequest,
  attachPaymentRequestSummaries,
} from "./payment-request-store";
export type Checkout = {
  items: { menuId: string; quantity: number }[];
  address: string;
  lat: number;
  lng: number;
  recipient: string;
  phone: string;
  note?: string;
  voucher?: string;
  idempotencyKey: string;
  expectedTotal?: number;
  analytics?: { sessionId: string; source: string };
};
export type OrderRecord = {
  id: string;
  code: string;
  user_id: string;
  chef_id: string;
  chef_name: string;
  chef_user_id: string;
  meal_id: string;
  status: string;
  payment_status: string;
  payment_reported: number;
  automatic_payment: number;
  received_amount: number;
  subtotal: number;
  discount: number;
  delivery_fee: number;
  total: number;
  address: string;
  lat: number;
  lng: number;
  chef_lat: number;
  chef_lng: number;
  distance_km: number;
  route_distance_km: number | null;
  route_duration_seconds: number | null;
  route_polyline: string | null;
  bank_name: string;
  bank_bin: string;
  account_no: string;
  account_name: string;
  transfer_content: string;
  qr_data: string | null;
  expires_at: string;
  created_at: string;
  note: string;
  phone: string;
  recipient: string;
  voucher_id: string | null;
  payment_request_status?: string | null;
  payment_request_kind?: string | null;
  items?: unknown[];
  events?: unknown[];
};
const orderSQL =
  'SELECT o.*,c.name chef_name,c.user_id chef_user_id,COALESCE(ps.automatic,0) automatic_payment,(SELECT COALESCE(SUM(t.amount),0) FROM sepay_transactions t WHERE t.order_id=o.id AND t.result IN ("PARTIAL","PAID","OVERPAID")) received_amount FROM orders o JOIN chefs c ON c.id=o.chef_id LEFT JOIN sepay_order_settings ps ON ps.order_id=o.id';
export async function getOrder(
  id: string,
  user: Actor,
  db?: DB,
  lock = false,
): Promise<OrderRecord> {
  await ensureSePaySchema();
  const result = (
    await rows<OrderRecord>(
      orderSQL + " WHERE o.id=?" + (lock ? " FOR UPDATE" : ""),
      [id],
      db,
    )
  )[0];
  if (!result) throw new AppError("Không tìm thấy đơn.", 404);
  if (
    user.role !== "admin" &&
    result.user_id !== user.id &&
    result.chef_user_id !== user.id
  )
    throw new AppError("Bạn không có quyền xem đơn này.", 403);
  return result;
}
async function event(
  db: DB,
  order: OrderRecord | { id: string },
  actorId: string,
  status: string,
  note = "",
) {
  const createdAt = new Date();
  await exec(
    "INSERT INTO order_events VALUES (?,?,?,?,?,?)",
    [randomUUID(), order.id, actorId, status, note, sqlDate(createdAt)],
    db,
  );
  await analyticsLive(db, order.id);
  return createdAt;
}
async function release(db: DB, order: OrderRecord) {
  const items = await rows<{ menu_id: string; quantity: number }>(
    "SELECT menu_id,quantity FROM order_items WHERE order_id=?",
    [order.id],
    db,
  );
  for (const item of items)
    await exec(
      "UPDATE daily_menu SET stock=stock+? WHERE id=?",
      [item.quantity, item.menu_id],
      db,
    );
  if (order.voucher_id) {
    await exec(
      "DELETE FROM voucher_redemptions WHERE order_id=?",
      [order.id],
      db,
    );
    await exec(
      "UPDATE vouchers SET used_count=GREATEST(0,used_count-1) WHERE id=?",
      [order.voucher_id],
      db,
    );
  }
}
export async function expireOrders() {
  await ensureSePaySchema();
  const pending = await rows<{ id: string }>(
    'SELECT id FROM orders WHERE status="PLACED" AND expires_at<? LIMIT 100',
    [sqlDate()],
  );
  for (const row of pending)
    await transaction(async (db) => {
      const o = (
        await rows<OrderRecord>(
          orderSQL + " WHERE o.id=? FOR UPDATE",
          [row.id],
          db,
        )
      )[0];
      await expirePendingOrder(db, o);
    });
}
// The caller holds the order lock; stock release and notifications are atomic.
export async function expirePendingOrder(db: DB, o: OrderRecord | undefined) {
  if (
    !o ||
    o.status !== "PLACED" ||
    parseUTC(o.expires_at).getTime() > Date.now()
  )
    return false;
  await release(db, o);
  await exec(
    'UPDATE orders SET status="EXPIRED",payment_status=CASE WHEN payment_status IN ("PARTIAL","PAYMENT_REVIEW") THEN "REFUND_PENDING" ELSE "EXPIRED" END,updated_at=? WHERE id=?',
    [sqlDate(), o.id],
    db,
  );
  await event(
    db,
    o,
    o.user_id,
    "EXPIRED",
    "Hết thời gian chờ xác nhận thanh toán.",
  );
  await notify(
    db,
    o.user_id,
    "order",
    "Đơn đã hết hạn",
    `Đơn ${o.code} chưa được xác nhận thanh toán. Nếu đã chuyển, hãy liên hệ bếp để đối soát.`,
    `/orders/${o.id}`,
  );
  await notify(
    db,
    o.chef_user_id,
    "order",
    "Đơn hết hạn",
    `Kiểm tra giao dịch tới trễ nếu khách đã chuyển cho đơn ${o.code}.`,
    `/chef?order=${o.id}`,
  );
  o.status = "EXPIRED";
  o.payment_status = ["PARTIAL", "PAYMENT_REVIEW"].includes(o.payment_status)
    ? "REFUND_PENDING"
    : "EXPIRED";
  return true;
}
export async function createOrder(user: Actor, input: Checkout) {
  let track = true;
  await ensureAnalyticsSchema().catch(() => {
    track = false;
    console.error("Analytics schema unavailable; checkout continues.");
  });
  await expireOrders();
  const existing = (
    await rows<{ id: string }>(
      "SELECT id FROM orders WHERE user_id=? AND idempotency_key=?",
      [user.id, input.idempotencyKey],
    )
  )[0];
  if (existing) return { id: existing.id };
  // External route calls happen before the transaction so row locks stay short.
  const chef = (
    await rows<{ id: string; lat: number; lng: number }>(
      "SELECT c.id,c.lat,c.lng FROM daily_menu m JOIN products p ON p.id=m.product_id JOIN chefs c ON c.id=p.chef_id WHERE m.id=?",
      [input.items[0].menuId],
    )
  )[0];
  if (!chef) throw new AppError("Món không còn trong thực đơn.");
  const route = process.env.GOONG_API_KEY ? await direction(chef, input) : null;
  try {
    return await transaction(async (db) => {
      const retry = (
        await rows<{ id: string }>(
          "SELECT id FROM orders WHERE user_id=? AND idempotency_key=? FOR UPDATE",
          [user.id, input.idempotencyKey],
          db,
        )
      )[0];
      if (retry) return { id: retry.id };
      const active = (
        await rows<{ active: number }>(
          "SELECT active FROM users WHERE id=? FOR UPDATE",
          [user.id],
          db,
        )
      )[0];
      if (!active?.active)
        throw new AppError("Tài khoản không được phép đặt đơn.", 403);
      const chefs = await rows<Record<string, unknown>>(
        "SELECT c.*,u.active owner_active FROM chefs c JOIN users u ON u.id=c.user_id WHERE c.id=? FOR UPDATE",
        [chef.id],
        db,
      );
      const c = chefs[0];
      if (c.status !== "approved" || !c.owner_active)
        throw new AppError("Bếp hiện không nhận đơn.");
      if (
        Number(c.lat) !== Number(chef.lat) ||
        Number(c.lng) !== Number(chef.lng)
      )
        throw new AppError(
          "Vị trí bếp vừa thay đổi. Hãy xem lại phí giao và đặt lại đơn.",
          409,
        );
      if (!c.bank_bin || !c.account_no || !c.account_name)
        throw new AppError(
          "Bếp chưa cấu hình tài khoản nhận tiền. Vui lòng chọn bếp khác.",
        );
      const distance = haversine(input, {
        lat: Number(c.lat),
        lng: Number(c.lng),
      });
      if (distance > Number(c.radius_km))
        throw new AppError("Địa chỉ nằm ngoài bán kính giao của bếp.");
      const selected = [];
      let subtotal = 0,
        meal = "",
        session = "",
        deadline = Date.now() + 10 * 60000;
      for (const item of [...input.items].sort((a, b) =>
        a.menuId.localeCompare(b.menuId),
      )) {
        const m = (
          await rows<Record<string, unknown>>(
            "SELECT m.*,p.name,p.image_url,p.price,p.active,p.chef_id,k.is_open,ca.name campaign_name,ca.active campaign_active,ca.starts_at,ca.ends_at FROM daily_menu m JOIN products p ON p.id=m.product_id JOIN kitchen_sessions k ON k.id=m.session_id LEFT JOIN campaigns ca ON ca.id=m.campaign_id WHERE m.id=? FOR UPDATE",
            [item.menuId],
            db,
          )
        )[0];
        if (
          !m ||
          m.chef_id !== chef.id ||
          !m.active ||
          !m.is_open ||
          !m.enabled ||
          parseUTC(String(m.cutoff_at)).getTime() <= Date.now()
        )
          throw new AppError("Một món đã ngừng nhận đơn hoặc hết giờ bữa.");
        if (meal && (meal !== m.meal_id || session !== m.session_id))
          throw new AppError(
            "Giỏ hàng chỉ được gồm một bếp và một bữa của cùng ngày.",
          );
        meal = String(m.meal_id);
        session = String(m.session_id);
        if (Number(m.stock) < item.quantity)
          throw new AppError(`${m.name} không còn đủ suất.`);
        const campaign =
          Boolean(m.campaign_active) &&
          parseUTC(String(m.starts_at)).getTime() <= Date.now() &&
          parseUTC(String(m.ends_at)).getTime() > Date.now();
        const price = effectivePrice(
          Number(m.price),
          m.sale_price === null ? null : Number(m.sale_price),
          campaign,
        );
        subtotal += price * item.quantity;
        deadline = Math.min(deadline, parseUTC(String(m.cutoff_at)).getTime());
        selected.push({ ...item, m, price });
      }
      let voucherId: string | null = null,
        discount = 0;
      if (input.voucher) {
        const v = (
          await rows<Record<string, unknown>>(
            "SELECT * FROM vouchers WHERE code=? FOR UPDATE",
            [input.voucher.toUpperCase()],
            db,
          )
        )[0];
        if (
          !v ||
          !v.active ||
          v.chef_id !== chef.id ||
          Number(v.min_subtotal) > subtotal ||
          Number(v.used_count) >= Number(v.max_uses) ||
          parseUTC(String(v.expires_at)).getTime() <= Date.now()
        )
          throw new AppError("Voucher không áp dụng được cho đơn này.");
        if (
          (
            await rows(
              "SELECT * FROM voucher_redemptions WHERE voucher_id=? AND user_id=?",
              [v.id, user.id],
              db,
            )
          ).length
        )
          throw new AppError("Bạn đã sử dụng voucher này.");
        voucherId = String(v.id);
        discount = Math.min(subtotal, Number(v.discount_amount));
      }
      const setting = (
        await rows<{ value: unknown }>(
          'SELECT value FROM platform_settings WHERE id="delivery"',
          [],
          db,
        )
      )[0];
      const fee =
        typeof setting?.value === "string"
          ? JSON.parse(setting.value)
          : setting?.value || { baseFee: 15000, perKm: 0 };
      if (fee.perKm > 0 && !route)
        throw new AppError(
          "Chưa tính được tuyến đường để xác định phí giao. Vui lòng thử lại.",
          503,
        );
      const deliveryFee =
          Number(fee.baseFee) +
          Math.ceil(route?.distanceKm || 0) * Number(fee.perKm),
        total = subtotal - discount + deliveryFee;
      if (input.expectedTotal !== undefined && input.expectedTotal !== total)
        throw new AppError(
          "Giá hoặc phí giao đã thay đổi. Hãy xem lại tổng tiền trước khi đặt.",
        );
      const id = randomUUID(),
        code = randomBytes(5).toString("hex").toUpperCase(),
        content = `TGBD${code}`,
        now = sqlDate();
      await exec(
        `INSERT INTO orders (id,code,user_id,chef_id,meal_id,subtotal,discount,delivery_fee,total,recipient,phone,address,lat,lng,chef_lat,chef_lng,distance_km,route_distance_km,route_duration_seconds,route_polyline,bank_bin,bank_name,account_no,account_name,transfer_content,note,idempotency_key,voucher_id,expires_at,created_at,updated_at) VALUES (${Array(31).fill("?").join(",")})`,
        [
          id,
          code,
          user.id,
          chef.id,
          meal,
          subtotal,
          discount,
          deliveryFee,
          total,
          input.recipient,
          input.phone,
          input.address,
          input.lat,
          input.lng,
          c.lat,
          c.lng,
          distance,
          route?.distanceKm || null,
          route?.durationSeconds || null,
          route?.polyline || null,
          c.bank_bin,
          c.bank_name || "",
          c.account_no,
          c.account_name,
          content,
          input.note || "",
          input.idempotencyKey,
          voucherId,
          sqlDate(new Date(deadline)),
          now,
          now,
        ],
        db,
      );
      const automatic = await automaticPayment(chef.id, db);
      await exec(
        "INSERT INTO sepay_order_settings VALUES (?,?)",
        [id, automatic],
        db,
      );
      for (const { menuId, quantity, m, price } of selected) {
        await exec(
          "UPDATE daily_menu SET stock=stock-? WHERE id=?",
          [quantity, menuId],
          db,
        );
        await exec(
          "INSERT INTO order_items VALUES (?,?,?,?,?,?,?,?)",
          [
            randomUUID(),
            id,
            menuId,
            m.product_id,
            m.name,
            m.image_url,
            price,
            quantity,
          ],
          db,
        );
      }
      if (voucherId) {
        await exec(
          "INSERT INTO voucher_redemptions VALUES (?,?,?)",
          [voucherId, user.id, id],
          db,
        );
        await exec(
          "UPDATE vouchers SET used_count=used_count+1 WHERE id=?",
          [voucherId],
          db,
        );
      }
      await event(db, { id }, user.id, "PLACED");
      if (track) {
        const sale = selected.filter((x) => x.price < Number(x.m.price));
        await exec(
          "INSERT INTO analytics_order_context VALUES (?,?,?,?,?,?,?,?)",
          [
            id,
            input.analytics?.sessionId || null,
            input.analytics?.source || "",
            sale[0]?.m.campaign_id || null,
            sale[0]?.m.campaign_name || null,
            sale.reduce(
              (n, x) => n + (Number(x.m.price) - x.price) * x.quantity,
              0,
            ),
            "chef",
            sqlDate(),
          ],
          db,
        );
        if (input.analytics && user.role !== "admin")
          await exec(
            "INSERT INTO analytics_events (id,session_id,user_id,event_name,chef_id,meal_id,region,source,order_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            [
              randomUUID(),
              input.analytics.sessionId,
              user.id,
              "order_created",
              chef.id,
              meal,
              regionCell(input.lat, input.lng),
              input.analytics.source,
              id,
              sqlDate(),
            ],
            db,
          );
      }
      await notify(
        db,
        String(c.user_id),
        "order",
        "Đơn mới chờ thanh toán",
        automatic
          ? `Đơn ${code}. SePay sẽ tự xác nhận khi nhận đủ tiền.`
          : `Đơn ${code}. Kiểm tra giao dịch nhận tiền hoặc bật SePay trong cài đặt.`,
        `/chef?order=${id}`,
      );
      await notify(
        db,
        user.id,
        "order",
        "Đơn đã tạo",
        `Chuyển khoản đúng số tiền và nội dung cho đơn ${code}.`,
        `/orders/${id}`,
      );
      return { id };
    });
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
      const retry = (
        await rows<{ id: string }>(
          "SELECT id FROM orders WHERE user_id=? AND idempotency_key=?",
          [user.id, input.idempotencyKey],
        )
      )[0];
      if (retry) return { id: retry.id };
    }
    throw error;
  }
}
export async function listOrders(
  user: Actor,
  chefMode = false,
  activeOnly = false,
) {
  await expireOrders();
  const conditions: string[] = [],
    values: unknown[] = [];
  if (!(user.role === "admin" && chefMode)) {
    conditions.push(chefMode ? "c.user_id=?" : "o.user_id=?");
    values.push(user.id);
  }
  if (activeOnly) {
    const statuses =
      chefMode && user.role === "chef"
        ? CHEF_PROCESSING_ORDER_STATUSES
        : ACTIVE_ORDER_STATUSES;
    conditions.push(`o.status IN (${statuses.map(() => "?").join(",")})`);
    values.push(...statuses);
  }
  const orders = await rows<OrderRecord>(
    orderSQL +
      (conditions.length ? " WHERE " + conditions.join(" AND ") : "") +
      " ORDER BY o.created_at DESC LIMIT 100",
    values,
  );
  const items = orders.length
    ? await rows<{
        order_id: string;
        product_id: string;
        name: string;
        image_url: string;
        quantity: number;
      }>(
        `SELECT order_id,product_id,name,image_url,quantity FROM order_items WHERE order_id IN (${orders.map(() => "?").join(",")}) ORDER BY id`,
        orders.map((o) => o.id),
      )
    : [];
  return attachPaymentRequestSummaries(
    orders.map((o) => {
      const dishes = items.filter((i) => i.order_id === o.id);
      return {
        ...o,
        dish_image: dishes.find((i) => i.image_url)?.image_url || null,
        dish_names: [...new Set(dishes.map((i) => i.name))],
        dish_count: new Set(dishes.map((i) => i.product_id)).size,
        item_quantity: dishes.reduce((sum, i) => sum + Number(i.quantity), 0),
      };
    }),
  );
}
export async function transition(
  user: Actor,
  id: string,
  action: string,
  note = "",
) {
  await ensureSePaySchema();
  if (action === "DELIVERED" || TERMINAL.includes(action))
    await ensureDeliveryReminderSchema();
  if (action === "CANCELLED" || action === "REJECTED")
    await ensurePaymentRequestSchema();
  return transaction(async (db) => {
    const o = await getOrder(id, user, db, true),
      isChef = o.chef_user_id === user.id,
      isUser = o.user_id === user.id,
      isAdmin = user.role === "admin";
    if (action === "report-payment") {
      if (!isUser)
        throw new AppError("Chỉ khách đặt được báo chuyển khoản.", 403);
      if (
        o.status !== "PLACED" ||
        parseUTC(o.expires_at).getTime() <= Date.now()
      )
        throw new AppError("Đơn đã hết hạn; hãy liên hệ bếp để đối soát.");
      await exec(
        "UPDATE orders SET payment_reported=TRUE,updated_at=? WHERE id=?",
        [sqlDate(), id],
        db,
      );
      await event(db, o, user.id, "PAYMENT_REPORTED");
      await notify(
        db,
        o.chef_user_id,
        "order",
        "Khách đã báo chuyển khoản",
        `Kiểm tra tiền thực nhận cho đơn ${o.code}.`,
        `/chef?order=${id}`,
      );
      return { ok: true };
    }
    let target = action,
      refundRequested = false;
    if (target === "ACCEPTED") {
      if (!isChef && !isAdmin)
        throw new AppError("Chỉ bếp phụ trách được xác nhận tiền.", 403);
      if (o.status === "PAID" && o.payment_status === "PAID_AUTO") {
        // Accepting a paid order is a kitchen decision, not a payment confirmation.
      } else {
        if (o.automatic_payment && !isAdmin)
          throw new AppError(
            "SePay sẽ tự xác nhận thanh toán. Hãy chờ webhook báo tiền vào.",
          );
        if (
          o.status !== "PLACED" ||
          parseUTC(o.expires_at).getTime() <= Date.now()
        )
          throw new AppError("Đơn không còn chờ thanh toán.");
        await exec(
          'UPDATE orders SET payment_status="PAID_MANUAL",payment_confirmed_at=? WHERE id=?',
          [sqlDate(), id],
          db,
        );
        await exec(
          "INSERT INTO audit_logs VALUES (?,?,?,?,?,?)",
          [
            randomUUID(),
            user.id,
            "order.payment.manual",
            id,
            JSON.stringify({
              previousPayment: o.payment_status,
              previousStatus: o.status,
              source: "manual",
            }),
            sqlDate(),
          ],
          db,
        );
      }
    } else if (target === "CANCELLED" || target === "REJECTED") {
      if (target === "REJECTED" && !isChef && !isAdmin)
        throw new AppError("Không có quyền từ chối.", 403);
      if (target === "CANCELLED" && !isUser && !isAdmin)
        throw new AppError("Không có quyền hủy.", 403);
      if (
        !["PLACED", "PAID"].includes(o.status) &&
        !(isAdmin && o.status === "ACCEPTED")
      )
        throw new AppError("Đơn đang được xử lý. Vui lòng liên hệ hỗ trợ.");
      if (!note.trim()) throw new AppError("Vui lòng nhập lý do.");
      await release(db, o);
      if (
        ["PAID_MANUAL", "PAID_AUTO", "PARTIAL", "PAYMENT_REVIEW"].includes(
          o.payment_status,
        )
      ) {
        await exec(
          'UPDATE orders SET payment_status="REFUND_PENDING" WHERE id=?',
          [id],
          db,
        );
        await createCancellationRefundRequest(db, o, note, user.id);
        refundRequested = true;
      }
    } else if (target === "COMPLETED") {
      if (!isUser && !isAdmin)
        throw new AppError("Khách xác nhận đã nhận món.", 403);
      if (o.status !== "DELIVERED") throw new AppError("Đơn chưa báo đã giao.");
      await exec(
        "UPDATE chefs SET completed_orders=completed_orders+1 WHERE id=?",
        [o.chef_id],
        db,
      );
    } else {
      if (!isChef && !isAdmin)
        throw new AppError("Không có quyền cập nhật.", 403);
      if (ORDER_NEXT[o.status] !== target)
        throw new AppError("Trạng thái chuyển chưa hợp lệ.");
    }
    if (TERMINAL.includes(o.status)) throw new AppError("Đơn đã kết thúc.");
    await exec(
      "UPDATE orders SET status=?,cancellation_reason=?,updated_at=? WHERE id=?",
      [target, note || null, sqlDate(), id],
      db,
    );
    const eventAt = await event(db, o, user.id, target, note);
    if (target === "DELIVERED") await queueDeliveryReminder(db, id, eventAt);
    else if (TERMINAL.includes(target)) await cancelDeliveryReminder(db, id);
    if (isAdmin)
      await exec(
        "INSERT INTO audit_logs VALUES (?,?,?,?,?,?)",
        [
          randomUUID(),
          user.id,
          "order.admin.transition",
          id,
          JSON.stringify({
            previousStatus: o.status,
            status: target,
            reason: note,
          }),
          sqlDate(),
        ],
        db,
      );
    await notify(
      db,
      o.user_id,
      "order",
      refundRequested ? "Yêu cầu hoàn tiền đã gửi" : "Đơn hàng cập nhật",
      refundRequested
        ? `Đơn ${o.code} đã hủy / từ chối. Yêu cầu hoàn tiền đã gửi tới bếp.`
        : `Đơn ${o.code} đã cập nhật trạng thái.`,
      `/orders/${id}`,
    );
    if ((isUser || isAdmin) && !refundRequested && o.chef_user_id !== user.id)
      await notify(
        db,
        o.chef_user_id,
        "order",
        isAdmin ? "Quản trị cập nhật đơn" : "Khách cập nhật đơn",
        `Đơn ${o.code} đã cập nhật.`,
        `/chef?order=${id}`,
      );
    return { ok: true, refundRequested };
  });
}
