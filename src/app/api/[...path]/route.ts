import { randomUUID, createHash } from "node:crypto";
import { cookies } from "next/headers";
import { SignJWT } from "jose";
import { z } from "zod";
import { put, get } from "@vercel/blob";
import sharp from "sharp";
import { api, AppError } from "@/lib/http";
import { dispatchPushAfterResponse } from "@/lib/push-dispatch";
import { ensurePushSchema } from "@/lib/push-schema";
import {
  pushConfig,
  savePushSubscription,
  pushDeviceStatus,
  removePushSubscription,
  queuePushTest,
  processPushQueue,
} from "@/lib/push";
import {
  actor,
  requireRole,
  signIn,
  signUp,
  signOut,
  COOKIE,
  digest,
} from "@/lib/auth";
import { rows, exec, transaction, sqlDate } from "@/lib/db";
import { feed } from "@/lib/catalog";
import {
  checkoutSchema,
  loginSchema,
  signupSchema,
  addressSchema,
  kitchenSettingsSchema,
  point,
} from "@/lib/validation";
import {
  createOrder,
  getOrder,
  listOrders,
  transition,
  expireOrders,
} from "@/lib/orders";
import {
  chefOverview,
  applyChef,
  saveBank,
  saveProduct,
  saveMenu,
  setKitchen,
  ownedChef,
  adminOverview,
  adminChefDetail,
  audit,
} from "@/lib/manage";
import {
  notify,
  readNotification,
  unreadNotificationCounts,
} from "@/lib/notifications";
import {
  listPaymentRequests,
  submitPaymentRequest,
  submitPaymentResolution,
  reviewPaymentException,
  canReadPaymentEvidence,
} from "@/lib/payment-requests";
import { cutoffAt, serviceDate } from "@/lib/domain";
import { goong } from "@/lib/goong";
import { queueBroadcast, processBroadcasts } from "@/lib/jobs";
import { processDeliveryReminders } from "@/lib/delivery-reminders";
import { quoteOrder } from "@/lib/quote";
import { getReorderOptions } from "@/lib/reorder";
import { getProductReviews } from "@/lib/product-reviews";
import { getChefReviews } from "@/lib/chef-reviews";
import { sepayBanks, sepayQR } from "@/lib/sepay-qr";
import {
  adminAnalytics,
  mutateAnalytics,
  recordAnalyticsEvent,
  analyticsLive,
} from "@/lib/analytics";
import {
  adminUsersReport,
  adminUsersList,
  adminUserDetail,
} from "@/lib/admin-users";
import {
  adminChefAnalytics,
  adminChefDetailReport,
  saveChefThresholds,
  clearChefReports,
} from "@/lib/admin-chefs";
import {
  adminProductAnalytics,
  adminProductDetail,
  saveProductThresholds,
  clearProductReports,
} from "@/lib/admin-products";
import {
  adminOrderAnalytics,
  adminOrderDetail,
  saveOrderThresholds,
  clearOrderReports,
} from "@/lib/admin-orders";
import {
  generateWebhookKey,
  sepayConfig,
  saveSePayConfig,
} from "@/lib/sepay-config";
export const runtime = "nodejs";
async function authThrottle(req: Request, email: string) {
  const key = createHash("sha256")
    .update(email.toLowerCase())
    .digest("hex")
    .slice(0, 40);
  await transaction(async (db) => {
    await exec(
      "INSERT INTO platform_settings VALUES (?,?) ON DUPLICATE KEY UPDATE id=VALUES(id)",
      [
        `login:${key}`,
        JSON.stringify({ count: 0, until: Date.now() + 900000 }),
      ],
      db,
    );
    const r = (
      await rows<{ value: unknown }>(
        "SELECT value FROM platform_settings WHERE id=? FOR UPDATE",
        [`login:${key}`],
        db,
      )
    )[0];
    let v =
      typeof r.value === "string"
        ? JSON.parse(r.value)
        : (r.value as { count: number; until: number });
    if (v.until < Date.now()) v = { count: 0, until: Date.now() + 900000 };
    if (v.count >= 15)
      throw new AppError("Bạn đã thử quá nhiều lần. Thử lại sau 15 phút.", 429);
    v.count++;
    await exec(
      "UPDATE platform_settings SET value=? WHERE id=?",
      [JSON.stringify(v), `login:${key}`],
      db,
    );
  });
}
async function dispatch(req: Request) {
  const url = new URL(req.url),
    path = url.pathname.slice(5).split("/"),
    [section, action, id] = path,
    method = req.method;
  if (section === "analytics" && action === "events" && method === "POST") {
    if (Number(req.headers.get("content-length") || 0) > 4096)
      throw new AppError("Sự kiện quá lớn.", 413);
    return recordAnalyticsEvent(await req.json(), await actor(false));
  }
  if (section === "auth") {
    if (action === "me" && method === "GET") {
      const user = await actor(false);
      return {
        user,
        chef: user
          ? (
              await rows(
                "SELECT id,name,status,rejection_reason FROM chefs WHERE user_id=?",
                [user.id],
              )
            )[0] || null
          : null,
      };
    }
    if (action === "login" && method === "POST") {
      const input = loginSchema.parse(await req.json());
      await authThrottle(req, input.email);
      return { user: await signIn(input.email, input.password) };
    }
    if (action === "register" && method === "POST") {
      const input = signupSchema.parse(await req.json());
      await authThrottle(req, input.email);
      return { user: await signUp(input.name, input.email, input.password) };
    }
    if (action === "logout" && method === "POST") {
      await signOut();
      return { ok: true };
    }
  }
  if (section === "push") {
    const user = (await actor())!;
    if (action === "config" && method === "GET") {
      const { configured, publicKey } = pushConfig();
      return { configured, publicKey };
    }
    if (method === "POST") {
      const sessionHash = digest((await cookies()).get(COOKIE)!.value);
      const input = await req.json();
      if (input?.userId !== user.id)
        throw new AppError("Tài khoản đã thay đổi. Hãy tải lại trang.", 409);
      if (action === "subscribe")
        return savePushSubscription(user, sessionHash, input);
      if (action === "status")
        return pushDeviceStatus(user.id, sessionHash, input);
      if (action === "unsubscribe")
        return removePushSubscription(user.id, sessionHash, input);
      if (action === "test") return queuePushTest(user.id, sessionHash, input);
    }
  }
  if (section === "catalog" && method === "GET") {
    const user = await actor(false),
      lat = Number(url.searchParams.get("lat") || 10.7817),
      lng = Number(url.searchParams.get("lng") || 106.6809);
    point.parse({ lat, lng });
    return feed(
      { lat, lng, address: "" },
      {
        userId: user?.id,
        productId: url.searchParams.get("product")?.slice(0, 36),
        chefId: url.searchParams.get("chef")?.slice(0, 36),
        meal: url.searchParams.get("meal") || undefined,
        search: url.searchParams.get("q")?.slice(0, 100),
        offset: z.coerce
          .number()
          .int()
          .min(0)
          .max(10000)
          .parse(url.searchParams.get("cursor") || 0),
        limit: z.coerce
          .number()
          .int()
          .min(1)
          .max(100)
          .parse(url.searchParams.get("limit") || 60),
        sale: url.searchParams.get("sale") === "true",
        favorite: url.searchParams.get("favorite") === "true",
      },
    );
  }
  if (section === "chefs" && method === "GET") {
    if (action && id === "reviews")
      return getChefReviews(
        z.string().min(1).max(36).parse(action),
        z
          .enum(["highest", "lowest", "recent"])
          .parse(url.searchParams.get("sort") || "highest"),
        z.coerce
          .number()
          .int()
          .min(0)
          .max(10000)
          .parse(url.searchParams.get("cursor") || 0),
      );
    const c = (
      await rows(
        'SELECT id,name,bio,area,avatar_url,cover_url,rating,rating_count,completed_orders FROM chefs WHERE id=? AND status="approved"',
        [action],
      )
    )[0];
    if (!c) throw new AppError("Bếp chưa hoạt động.", 404);
    return {
      chef: c,
    };
  }
  if (
    section === "products" &&
    action &&
    id === "reviews" &&
    method === "GET"
  ) {
    return getProductReviews(
      z.string().min(1).max(36).parse(action),
      z.coerce
        .number()
        .int()
        .min(0)
        .max(10000)
        .parse(url.searchParams.get("cursor") || 0),
    );
  }
  if (section === "banks" && method === "GET") return { banks: sepayBanks };
  if (section === "location" && method === "GET") {
    const mode = url.searchParams.get("mode");
    if (mode === "search")
      return goong("place/autocomplete", {
        input: z
          .string()
          .trim()
          .min(3)
          .max(500)
          .parse(url.searchParams.get("q")),
      });
    if (mode === "detail")
      return goong("place/detail", {
        place_id: z.string().min(1).max(1000).parse(url.searchParams.get("id")),
      });
    const lat = z.coerce
        .number()
        .min(-90)
        .max(90)
        .parse(url.searchParams.get("lat")),
      lng = z.coerce
        .number()
        .min(-180)
        .max(180)
        .parse(url.searchParams.get("lng"));
    return goong("geocode", { latlng: `${lat},${lng}` });
  }
  if (section === "favorites") {
    const user = (await actor())!;
    if (method === "GET")
      return {
        favorites: await rows(
          "SELECT p.*,c.name chef_name FROM favorites f JOIN products p ON p.id=f.product_id JOIN chefs c ON c.id=p.chef_id WHERE f.user_id=? ORDER BY f.created_at DESC",
          [user.id],
        ),
      };
    if (method === "POST") {
      const body = z
        .object({ productId: z.string().max(36), liked: z.boolean() })
        .parse(await req.json());
      if (
        !(await rows("SELECT id FROM products WHERE id=?", [body.productId]))
          .length
      )
        throw new AppError("Món không tồn tại.", 404);
      if (body.liked)
        await exec("INSERT IGNORE INTO favorites VALUES (?,?,?)", [
          user.id,
          body.productId,
          sqlDate(),
        ]);
      else
        await exec("DELETE FROM favorites WHERE user_id=? AND product_id=?", [
          user.id,
          body.productId,
        ]);
      return { ok: true };
    }
  }
  if (section === "notifications") {
    const user = (await actor())!;
    if (action && id === "read" && method === "POST")
      return readNotification(user.id, z.string().min(1).max(36).parse(action));
    if (!action && method === "GET")
      return {
        notifications: await rows(
          "SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100",
          [user.id],
        ),
        unreadCounts: await unreadNotificationCounts(user.id),
      };
    if (!action && method === "POST") {
      await exec("UPDATE notifications SET is_read=TRUE WHERE user_id=?", [
        user.id,
      ]);
      return { ok: true };
    }
  }
  if (section === "addresses") {
    const user = (await actor())!;
    if (method === "GET")
      return {
        addresses: await rows(
          "SELECT * FROM addresses WHERE user_id=? ORDER BY is_default DESC",
          [user.id],
        ),
      };
    if (method === "POST" || method === "PATCH") {
      const b = addressSchema.parse(await req.json());
      const addressId =
        method === "PATCH" ? z.uuid().parse(action) : randomUUID();
      await transaction(async (db) => {
        // Serialize default changes for this user, including concurrent new addresses.
        await rows("SELECT id FROM users WHERE id=? FOR UPDATE", [user.id], db);
        if (method === "PATCH") {
          const owned = await rows(
            "SELECT id FROM addresses WHERE id=? AND user_id=? FOR UPDATE",
            [addressId, user.id],
            db,
          );
          if (!owned.length) throw new AppError("Không tìm thấy địa chỉ.", 404);
        }
        if (b.isDefault)
          await exec(
            "UPDATE addresses SET is_default=FALSE WHERE user_id=?",
            [user.id],
            db,
          );
        if (method === "PATCH") {
          await exec(
            "UPDATE addresses SET label=?,address=?,lat=?,lng=?,recipient=?,phone=?,is_default=? WHERE id=? AND user_id=?",
            [
              b.label,
              b.address,
              b.lat,
              b.lng,
              b.recipient,
              b.phone,
              b.isDefault,
              addressId,
              user.id,
            ],
            db,
          );
        } else
          await exec(
            "INSERT INTO addresses VALUES (?,?,?,?,?,?,?,?,?)",
            [
              addressId,
              user.id,
              b.label,
              b.address,
              b.lat,
              b.lng,
              b.recipient,
              b.phone,
              b.isDefault,
            ],
            db,
          );
      });
      return { id: addressId };
    }
    if (method === "DELETE") {
      await exec("DELETE FROM addresses WHERE id=? AND user_id=?", [
        action,
        user.id,
      ]);
      return { ok: true };
    }
  }
  if (section === "profile" && method === "PATCH") {
    const user = (await actor())!,
      b = z
        .object({ name: z.string().min(2).max(100), phone: z.string().max(30) })
        .parse(await req.json());
    await exec("UPDATE users SET name=?,phone=? WHERE id=?", [
      b.name,
      b.phone,
      user.id,
    ]);
    return { ok: true };
  }
  if (section === "vouchers" && method === "GET") {
    return {
      vouchers: await rows(
        "SELECT v.id,v.code,v.title,v.min_subtotal,v.discount_amount,v.expires_at,c.name chef_name FROM vouchers v JOIN chefs c ON c.id=v.chef_id WHERE v.active=TRUE AND v.expires_at>? AND v.used_count<v.max_uses",
        [sqlDate()],
      ),
    };
  }
  if (section === "orders") {
    const user = (await actor())!;
    if (action === "quote" && method === "POST")
      return quoteOrder(
        user,
        point
          .extend({
            items: checkoutSchema.shape.items,
            voucher: z.string().max(30).optional(),
          })
          .parse(await req.json()),
      );
    if (!action && method === "GET") return { orders: await listOrders(user) };
    if (!action && method === "POST")
      return createOrder(user, checkoutSchema.parse(await req.json()));
    if (action && id === "reorder" && method === "GET") {
      const location = point.parse({
        lat: url.searchParams.has("lat")
          ? Number(url.searchParams.get("lat"))
          : undefined,
        lng: url.searchParams.has("lng")
          ? Number(url.searchParams.get("lng"))
          : undefined,
      });
      return getReorderOptions(user, action, location);
    }
    if (action && id === "qr" && method === "GET") {
      const order = await getOrder(action, user);
      if (
        order.status !== "PLACED" ||
        new Date(order.expires_at.replace(" ", "T") + "Z").getTime() <=
          Date.now()
      )
        throw new AppError("Đơn không còn chờ thanh toán.");
      if (order.payment_status === "PAYMENT_REVIEW")
        throw new AppError(
          "Giao dịch cần đối soát. Không chuyển thêm, hãy liên hệ bếp.",
        );
      return {
        qr: sepayQR({
          bankBin: order.bank_bin,
          accountNo: order.account_no,
          accountName: order.account_name,
          amount: Math.max(0, order.total - Number(order.received_amount)),
          content: order.transfer_content,
          store: order.chef_name,
        }),
      };
    }
    if (action && id === "action" && method === "POST") {
      const b = z
        .object({
          action: z.string().max(30),
          note: z.string().max(500).default(""),
        })
        .parse(await req.json());
      return transition(user, action, b.action, b.note);
    }
    if (action && id === "exception" && method === "POST") {
      return submitPaymentRequest(user, action, await req.json());
    }
    if (action && id === "exception-resolution" && method === "POST") {
      return submitPaymentResolution(user, action, await req.json());
    }
    if (action && id === "review" && method === "POST") {
      const b = z
        .object({
          rating: z.number().int().min(1).max(5),
          body: z.string().max(1000).default(""),
        })
        .parse(await req.json());
      await transaction(async (db) => {
        const o = await getOrder(action, user, db, true);
        if (o.user_id !== user.id || o.status !== "COMPLETED")
          throw new AppError("Chỉ đánh giá đơn đã hoàn thành của bạn.");
        if (
          (await rows("SELECT id FROM reviews WHERE order_id=?", [o.id], db))
            .length
        )
          throw new AppError("Bạn đã đánh giá đơn này.");
        await exec(
          "INSERT INTO reviews VALUES (?,?,?,?,?,?,?)",
          [randomUUID(), o.id, user.id, o.chef_id, b.rating, b.body, sqlDate()],
          db,
        );
        await exec(
          "UPDATE chefs SET rating=(rating*rating_count+?)/(rating_count+1),rating_count=rating_count+1 WHERE id=?",
          [b.rating, o.chef_id],
          db,
        );
        for (const item of await rows<{ product_id: string }>(
          "SELECT DISTINCT product_id FROM order_items WHERE order_id=?",
          [o.id],
          db,
        ))
          await exec(
            "UPDATE products SET rating=(rating*rating_count+?)/(rating_count+1),rating_count=rating_count+1 WHERE id=?",
            [b.rating, item.product_id],
            db,
          );
      });
      return { ok: true };
    }
    if (action && method === "GET") {
      await expireOrders();
      const order = await getOrder(action, user);
      return {
        order,
        paymentRequests: await listPaymentRequests(action),
        items: await rows("SELECT * FROM order_items WHERE order_id=?", [
          action,
        ]),
        events: await rows(
          "SELECT status,note,created_at FROM order_events WHERE order_id=? ORDER BY created_at",
          [action],
        ),
        review:
          (
            await rows("SELECT rating,body FROM reviews WHERE order_id=?", [
              action,
            ])
          )[0] || null,
      };
    }
  }
  if (section === "chef") {
    const user = (await actor())!;
    if (action === "application" && method === "POST")
      return applyChef(user, await req.json());
    if (action === "application" && method === "GET")
      return {
        chef:
          (await rows("SELECT * FROM chefs WHERE user_id=?", [user.id]))[0] ||
          null,
      };
    await requireRole("chef");
    if (!action && method === "GET") return chefOverview(user);
    if (action === "orders" && method === "GET")
      return {
        orders: await listOrders(
          user,
          true,
          url.searchParams.get("filter") === "active",
        ),
      };
    if (action === "sepay") {
      const c = await ownedChef(user);
      if (!id && method === "GET")
        return sepayConfig(
          String(c.id),
          new URL(process.env.SITE_URL || req.url).origin,
        );
      if (id === "key" && method === "POST")
        return { apiKey: generateWebhookKey() };
      if (!id && method === "POST")
        return saveSePayConfig(String(c.id), user.id, await req.json());
      if (id === "qr" && method === "POST") {
        if (!c.bank_bin || !c.account_no || !c.account_name)
          throw new AppError("Lưu thông tin ngân hàng trước khi tạo QR mẫu.");
        return {
          qr: sepayQR({
            bankBin: String(c.bank_bin),
            accountNo: String(c.account_no),
            accountName: String(c.account_name),
            amount: 1000,
            content: "TGBDTEST",
            store: String(c.name),
          }),
        };
      }
    }
    if (action === "bank" && method === "POST")
      return saveBank(user, await req.json());
    if (action === "settings" && method === "POST") {
      const c = await ownedChef(user),
        b = kitchenSettingsSchema.parse(await req.json());
      await exec(
        "UPDATE chefs SET address=?,area=?,lat=?,lng=?,radius_km=?,bio=? WHERE id=?",
        [b.address, b.area, b.lat, b.lng, b.radiusKm, b.bio, c.id],
      );
      return { ok: true };
    }
    if (action === "products" && (method === "POST" || method === "PATCH"))
      return saveProduct(user, await req.json(), id);
    if (action === "kitchen" && method === "POST")
      return setKitchen(
        user,
        z.object({ isOpen: z.boolean() }).parse(await req.json()).isOpen,
      );
    if (action === "menu" && method === "POST")
      return saveMenu(
        user,
        z
          .object({
            productId: z.string().max(36),
            mealId: z.enum(["breakfast", "lunch", "dinner", "late"]),
            stock: z.number().int().min(0).max(1000),
            salePrice: z.number().int().min(1000).nullable(),
            enabled: z.boolean(),
          })
          .parse(await req.json()),
      );
  }
  if (section === "admin") {
    const user = await requireRole("admin");
    if (action === "order-analytics" && method === "GET") {
      if (id === "detail")
        return adminOrderDetail(path[3] || "", url.searchParams);
      return adminOrderAnalytics(id || "summary", url.searchParams);
    }
    if (action === "order-analytics" && id === "settings" && method === "POST")
      return saveOrderThresholds(user, await req.json());
    if (
      action === "order-analytics" &&
      id === "transition" &&
      method === "POST"
    ) {
      const b = z
        .object({
          action: z.enum([
            "ACCEPTED",
            "PREPARING",
            "DELIVERING",
            "DELIVERED",
            "COMPLETED",
            "CANCELLED",
          ]),
          reason: z.string().trim().min(5).max(500),
        })
        .parse(await req.json());
      const result = await transition(user, path[3] || "", b.action, b.reason);
      clearOrderReports();
      return result;
    }
    if (action === "product-analytics" && method === "GET") {
      if (id === "detail")
        return adminProductDetail(path[3] || "", url.searchParams);
      return adminProductAnalytics(id || "summary", url.searchParams);
    }
    if (
      action === "product-analytics" &&
      id === "settings" &&
      method === "POST"
    )
      return saveProductThresholds(user, await req.json());
    if (action === "chef-analytics" && method === "GET") {
      if (id === "detail")
        return adminChefDetailReport(path[3] || "", url.searchParams);
      return adminChefAnalytics(id || "summary", url.searchParams);
    }
    if (action === "chef-analytics" && id === "settings" && method === "POST")
      return saveChefThresholds(user, await req.json());
    if (action === "users" && method === "GET") {
      if (id === "report") return adminUsersReport(url.searchParams);
      if (id) return adminUserDetail(id, url.searchParams);
      return adminUsersList(url.searchParams);
    }
    if (action === "analytics" && method === "GET")
      return adminAnalytics(id || "summary", url.searchParams);
    if (action === "analytics" && method === "POST")
      return mutateAnalytics(user, id || "", await req.json());
    if (action === "analytics" && method === "DELETE")
      return mutateAnalytics(
        user,
        id === "goals" ? "delete-goal" : id === "costs" ? "delete-cost" : "",
        {},
        path[3],
      );
    if (!action && method === "GET") return adminOverview();
    if (action === "orders" && method === "GET")
      return {
        orders: await listOrders(
          user,
          true,
          url.searchParams.get("filter") === "active",
        ),
      };
    if (action === "chefs" && id && method === "GET")
      return adminChefDetail(id);
    if (action === "chefs" && method === "POST") {
      const b = z
        .object({
          status: z.enum([
            "approved",
            "rejected",
            "needs_changes",
            "suspended",
          ]),
          reason: z.string().trim().max(1000).default(""),
        })
        .parse(await req.json());
      if (b.status !== "approved" && b.reason.length < 3)
        throw new AppError("Nhập lý do ít nhất 3 ký tự.");
      await transaction(async (db) => {
        const c = (
          await rows<{ id: string; user_id: string; name: string }>(
            "SELECT id,user_id,name FROM chefs WHERE id=? FOR UPDATE",
            [id],
            db,
          )
        )[0];
        if (!c) throw new AppError("Không tìm thấy bếp.", 404);
        await exec(
          "UPDATE chefs SET status=?,rejection_reason=? WHERE id=?",
          [b.status, b.reason, id],
          db,
        );
        if (b.status === "approved")
          await exec(
            'UPDATE users SET role="chef" WHERE id=? AND role<>"admin"',
            [c.user_id],
            db,
          );
        if (b.status === "suspended")
          await exec(
            "UPDATE kitchen_sessions SET is_open=FALSE WHERE chef_id=?",
            [id],
            db,
          );
        await notify(
          db,
          c.user_id,
          "system",
          "Hồ sơ bếp cập nhật",
          `${c.name}: ${b.status === "approved" ? "Đã được duyệt" : b.reason || "Vui lòng kiểm tra hồ sơ."}`,
          "/chef",
        );
        await audit(db, user, "chef.status", id!, b);
        await analyticsLive(db, id!);
      });
      clearChefReports();
      return { ok: true };
    }
    if (action === "users" && method === "POST") {
      const b = z.object({ active: z.boolean() }).parse(await req.json());
      if (id === user.id)
        throw new AppError("Không thể khóa tài khoản quản trị đang dùng.");
      await transaction(async (db) => {
        await exec("UPDATE users SET active=? WHERE id=?", [b.active, id], db);
        if (!b.active)
          await exec("DELETE FROM sessions WHERE user_id=?", [id], db);
        await audit(db, user, "user.active", id!, b);
      });
      return { ok: true };
    }
    if (action === "products" && method === "POST") {
      const b = z
        .object({
          active: z.boolean(),
          reason: z.string().trim().min(3).max(500),
        })
        .parse(await req.json());
      await transaction(async (db) => {
        const p = (
          await rows<{ user_id: string; name: string }>(
            "SELECT c.user_id,p.name FROM products p JOIN chefs c ON c.id=p.chef_id WHERE p.id=?",
            [id],
            db,
          )
        )[0];
        if (!p) throw new AppError("Món không tồn tại.", 404);
        await exec(
          "UPDATE products SET active=? WHERE id=?",
          [b.active, id],
          db,
        );
        await notify(
          db,
          p.user_id,
          "system",
          "Món cập nhật",
          `${p.name}: ${b.reason}`,
          "/chef?tab=products",
        );
        await audit(db, user, "product.active", id!, b);
        await analyticsLive(db, id!);
      });
      clearProductReports();
      clearChefReports();
      return { ok: true };
    }
    if (action === "meals" && method === "POST") {
      const b = z
        .object({
          cutoff: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          dayOffset: z.number().int().min(0).max(1),
        })
        .parse(await req.json());
      await transaction(async (db) => {
        await exec(
          "UPDATE meal_settings SET cutoff_time=?,day_offset=? WHERE id=?",
          [b.cutoff, b.dayOffset, id],
          db,
        );
        for (const m of await rows<{ id: string; service_date: string }>(
          "SELECT m.id,k.service_date FROM daily_menu m JOIN kitchen_sessions k ON k.id=m.session_id WHERE m.meal_id=? AND m.cutoff_at>?",
          [id, sqlDate()],
          db,
        ))
          await exec(
            "UPDATE daily_menu SET cutoff_at=? WHERE id=?",
            [sqlDate(cutoffAt(m.service_date, b.cutoff, b.dayOffset)), m.id],
            db,
          );
        await audit(db, user, "meal.cutoff", id!, b);
      });
      return { ok: true };
    }
    if (action === "campaigns" && method === "POST") {
      const b = z
        .object({
          name: z.string().min(3).max(150),
          active: z.boolean(),
          startsAt: z.iso.datetime(),
          endsAt: z.iso.datetime(),
        })
        .refine(
          (x) => new Date(x.endsAt) > new Date(x.startsAt),
          "Ngày kết thúc phải sau ngày bắt đầu.",
        )
        .parse(await req.json());
      await transaction(async (db) => {
        if (b.active) await exec("UPDATE campaigns SET active=FALSE", [], db);
        const campaignId = id || randomUUID();
        await exec(
          "INSERT INTO campaigns VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),active=VALUES(active),starts_at=VALUES(starts_at),ends_at=VALUES(ends_at)",
          [
            campaignId,
            b.name,
            b.active,
            sqlDate(new Date(b.startsAt)),
            sqlDate(new Date(b.endsAt)),
            sqlDate(),
          ],
          db,
        );
        await queueBroadcast(
          db,
          "chef",
          "promotion",
          b.active ? "Sự kiện sale đang mở" : "Sự kiện sale đã tắt",
          b.active
            ? `${b.name}: hãy cập nhật giá sale trong thực đơn.`
            : b.name,
          "/chef?tab=menu",
        );
        await audit(db, user, "campaign.saved", campaignId, b);
      });
      return { ok: true };
    }
    if (action === "news" && method === "POST") {
      const b = z
        .object({
          title: z.string().min(3).max(150),
          body: z.string().min(5).max(2000),
          audience: z.enum(["user", "chef", "all"]),
        })
        .parse(await req.json());
      await transaction(async (db) => {
        await queueBroadcast(
          db,
          b.audience,
          "news",
          b.title,
          b.body,
          "/notifications",
        );
        await audit(db, user, "news.queued", null, {
          title: b.title,
          audience: b.audience,
        });
      });
      return { ok: true };
    }
    if (action === "banners" && method === "POST") {
      const b = z
        .object({
          title: z.string().min(3).max(150),
          body: z.string().max(500),
          imageUrl: z.url().nullable(),
          href: z
            .string()
            .max(255)
            .refine((x) => x.startsWith("/") && !x.startsWith("//")),
          active: z.boolean(),
        })
        .parse(await req.json());
      const bannerId = id || randomUUID();
      await exec(
        "INSERT INTO banners VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE title=VALUES(title),body=VALUES(body),image_url=VALUES(image_url),href=VALUES(href),active=VALUES(active)",
        [bannerId, b.title, b.body, b.imageUrl, b.href, b.active, 0],
      );
      return { ok: true };
    }
    if (action === "vouchers" && method === "POST") {
      const b = z
        .object({
          code: z.string().regex(/^[A-Z0-9]{3,30}$/),
          title: z.string().min(3).max(150),
          chefId: z.string().max(36),
          discountAmount: z.number().int().min(1000).max(1000000),
          minSubtotal: z.number().int().min(0),
          maxUses: z.number().int().min(1).max(100000),
          expiresAt: z.iso.datetime(),
          active: z.boolean(),
        })
        .parse(await req.json());
      await exec("INSERT INTO vouchers VALUES (?,?,?,?,?,?,?,?,?,?)", [
        randomUUID(),
        b.code,
        b.title,
        b.chefId,
        b.discountAmount,
        b.minSubtotal,
        b.maxUses,
        0,
        sqlDate(new Date(b.expiresAt)),
        b.active,
      ]);
      return { ok: true };
    }
    if (action === "delivery" && method === "POST") {
      const b = z
        .object({
          baseFee: z.number().int().min(0).max(100000),
          perKm: z.number().int().min(0).max(20000),
        })
        .parse(await req.json());
      await exec(
        'INSERT INTO platform_settings VALUES ("delivery",?) ON DUPLICATE KEY UPDATE value=VALUES(value)',
        [JSON.stringify(b)],
      );
      return { ok: true };
    }
    if (action === "exceptions" && method === "POST") {
      if (!id) throw new AppError("Thiếu mã yêu cầu.");
      return reviewPaymentException(user, id, await req.json());
    }
  }
  if (section === "upload" && method === "POST") {
    const user = (await actor())!,
      form = await req.formData(),
      file = form.get("file"),
      kind = form.get("kind") === "document" ? "document" : "image";
    if (
      !(file instanceof File) ||
      file.size > 3 * 1024 * 1024 ||
      file.size === 0
    )
      throw new AppError("Chọn tệp tối đa 3 MB.");
    if (
      ![
        "image/jpeg",
        "image/png",
        "image/webp",
        ...(kind === "document" ? ["application/pdf"] : []),
      ].includes(file.type)
    )
      throw new AppError("Định dạng tệp chưa hỗ trợ.");
    const bytes = new Uint8Array(await file.arrayBuffer()),
      magic = Array.from(bytes.slice(0, 4))
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
    if (!(
      magic === "89504e47" ||
      magic.startsWith("ffd8ff") ||
      (magic === "52494646" &&
        new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") ||
      (kind === "document" && magic === "25504446")
    ))
      throw new AppError("Nội dung tệp không đúng định dạng.");
    const token =
      kind === "document"
        ? process.env.BLOB_PRIVATE_READ_WRITE_TOKEN
        : process.env.BLOB_PUBLIC_READ_WRITE_TOKEN;
    if (!token) throw new AppError("Vercel Blob chưa được cấu hình.", 503);
    const isImage = file.type.startsWith("image/");
    let storedBytes = Buffer.from(bytes),
      storedContentType = file.type,
      storedName = file.name,
      extension =
        file.type === "application/pdf" ? "pdf" : file.type.split("/")[1];
    if (isImage) {
      try {
        storedBytes = await sharp(bytes)
          .rotate()
          .webp({ quality: 82, effort: 4 })
          .toBuffer();
      } catch {
        throw new AppError("Không thể chuyển đổi ảnh đã tải lên.");
      }
      storedContentType = "image/webp";
      storedName = file.name.replace(/\.[^.]+$/, "") + ".webp";
      extension = "webp";
    }
    const assetId = randomUUID(),
      pathname = `${kind}/${user.id}/${assetId}.${extension}`;
    const blob = await put(pathname, storedBytes, {
      access: kind === "document" ? "private" : "public",
      token,
      contentType: storedContentType,
    });
    await exec("INSERT INTO assets VALUES (?,?,?,?,?,?,?,?)", [
      assetId,
      user.id,
      kind,
      blob.url,
      blob.pathname,
      storedContentType,
      storedName,
      sqlDate(),
    ]);
    return {
      id: assetId,
      url: kind === "document" ? `/api/files/${assetId}` : blob.url,
    };
  }
  if (section === "files" && method === "GET") {
    const user = (await actor())!,
      asset = (
        await rows<{ user_id: string; url: string; content_type: string }>(
          "SELECT * FROM assets WHERE id=?",
          [action],
        )
      )[0];
    if (
      !asset ||
      (asset.user_id !== user.id &&
        user.role !== "admin" &&
        !(await canReadPaymentEvidence(user.id, action)))
    )
      throw new AppError("Không có quyền xem tệp.", 403);
    const r = await get(asset.url, {
      access: "private",
      token: process.env.BLOB_PRIVATE_READ_WRITE_TOKEN,
    });
    if (!r || r.statusCode !== 200)
      throw new AppError("Không đọc được tệp.", 404);
    return new Response(r.stream, {
      headers: {
        "content-type": asset.content_type,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  if (section === "realtime" && action === "ticket" && method === "GET") {
    const user = (await actor())!,
      token = (await cookies()).get(COOKIE)!.value,
      secret = process.env.AUTH_SECRET;
    if (!secret || secret.length < 32)
      throw new AppError("Cấu hình realtime chưa hợp lệ.", 503);
    return {
      ticket: await new SignJWT({ sid: digest(token) })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(user.id)
        .setIssuedAt()
        .setExpirationTime("60s")
        .sign(new TextEncoder().encode(secret)),
    };
  }
  if (section === "cron" && method === "GET") {
    if (
      !process.env.CRON_SECRET ||
      req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
    )
      throw new AppError("Không có quyền.", 401);
    await expireOrders();
    const deliveryReminders = await processDeliveryReminders();
    await processBroadcasts();
    await processPushQueue();
    await exec("DELETE FROM sessions WHERE expires_at<?", [sqlDate()]);
    await exec(
      "DELETE FROM outbox_receipts WHERE created_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 7 DAY)",
    );
    return { ok: true, deliveryReminders };
  }
  throw new AppError("Không tìm thấy chức năng.", 404);
}
const handle = api(async (req) => {
  // Initialize before business transactions acquire pool connections.
  if (pushConfig().configured) await ensurePushSchema();
  const result = await dispatch(req);
  const path = new URL(req.url).pathname;
  if (
    (["POST", "PATCH", "DELETE"].includes(req.method) &&
      !path.startsWith("/api/analytics/") &&
      path !== "/api/push/status") ||
    (req.method === "GET" && path.startsWith("/api/orders"))
  )
    dispatchPushAfterResponse(path.startsWith("/api/admin/"));
  return result;
});
export const GET = handle,
  POST = handle,
  PATCH = handle,
  DELETE = handle;
