import { createHash, randomUUID, ECDH, createECDH } from "node:crypto";
import webpush from "web-push";
import { z } from "zod";
import { exec, rows, transaction, sqlDate, type DB } from "./db";
import { AppError } from "./http";
import { ensurePushSchema } from "./push-schema";
import type { Actor } from "./domain";
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
export function pushConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() || "",
    privateKey = process.env.VAPID_PRIVATE_KEY?.trim() || "",
    subject = process.env.VAPID_SUBJECT?.trim() || "";
  let configured = false;
  try {
    const u = new URL(subject),
      ec = createECDH("prime256v1");
    ec.setPrivateKey(Buffer.from(privateKey, "base64url"));
    configured =
      ["mailto:", "https:"].includes(u.protocol) &&
      !!u.pathname &&
      publicKey.length === 87 &&
      privateKey.length === 43 &&
      ec.getPublicKey().toString("base64url") === publicKey;
  } catch {}
  return {
    configured,
    publicKey: configured ? publicKey : "",
    subject,
    privateKey,
  };
}
export function safePushEndpoint(value: string) {
  try {
    const u = new URL(value),
      host = u.hostname.toLowerCase();
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      !u.hash &&
      (host === "fcm.googleapis.com" ||
        host === "updates.push.services.mozilla.com" ||
        host.endsWith(".push.services.mozilla.com") ||
        host === "web.push.apple.com" ||
        host.endsWith(".push.apple.com") ||
        host.endsWith(".notify.windows.com"))
    );
  } catch {
    return false;
  }
}
export function safePushHref(value: unknown) {
  return typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !/[\\\u0000-\u001f]/.test(value)
    ? value
    : "/notifications";
}
const endpointSchema = z
  .string()
  .max(2048)
  .refine(safePushEndpoint, "Địa chỉ nhận thông báo không hợp lệ.");
const preferences = z.object({
  orders: z.boolean().default(true),
  news: z.boolean().default(true),
  promotions: z.boolean().default(false),
});
export const pushSubscriptionSchema = z.object({
  subscription: z.object({
    endpoint: endpointSchema,
    expirationTime: z.number().nullable().optional(),
    keys: z.object({
      p256dh: z.string().regex(/^[\w-]{87}$/),
      auth: z.string().regex(/^[\w-]{22}$/),
    }),
  }),
  preferences: preferences.default({
    orders: true,
    news: true,
    promotions: false,
  }),
});
export const pushDeviceSchema = z.object({ endpoint: endpointSchema });
export async function savePushSubscription(
  user: Actor,
  sessionHash: string,
  input: unknown,
) {
  const c = pushConfig();
  if (!c.configured)
    throw new AppError("Hệ thống chưa cấu hình thông báo đẩy.", 503);
  const b = pushSubscriptionSchema.parse(input),
    s = b.subscription;
  try {
    ECDH.convertKey(Buffer.from(s.keys.p256dh, "base64url"), "prime256v1");
  } catch {
    throw new AppError("Khóa nhận thông báo không hợp lệ.");
  }
  if (s.expirationTime != null && s.expirationTime <= Date.now())
    throw new AppError("Đăng ký thông báo đã hết hạn. Hãy bật lại.");
  await ensurePushSchema();
  await transaction(async (db) => {
    // Serialize devices per account and verify that this is still the authenticated session.
    const [valid] = await rows(
      "SELECT u.id FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=? AND u.active=TRUE AND s.token_hash=? AND s.expires_at>? FOR UPDATE",
      [user.id, sessionHash, sqlDate()],
      db,
    );
    if (!valid) throw new AppError("Phiên đăng nhập đã hết hạn.", 401);
    const [old] = await rows<any>(
      "SELECT * FROM push_subscriptions WHERE endpoint_hash=? FOR UPDATE",
      [hash(s.endpoint)],
      db,
    );
    if (old && (old.auth !== s.keys.auth || old.p256dh !== s.keys.p256dh))
      throw new AppError("Đăng ký thông báo không khớp thiết bị.", 403);
    if (!old || !old.active || old.user_id !== user.id) {
      const [n] = await rows<{ n: number }>(
        "SELECT COUNT(*) n FROM push_subscriptions p JOIN sessions s ON s.token_hash=p.session_hash WHERE p.user_id=? AND p.active=TRUE AND s.expires_at>?",
        [user.id, sqlDate()],
        db,
      );
      if (Number(n.n) >= 10)
        throw new AppError(
          "Đã bật trên 10 thiết bị. Hãy tắt một thiết bị trước.",
          409,
        );
    }
    const id = old?.id || randomUUID(),
      now = sqlDate();
    // A shared browser cannot deliver the previous account's queued messages after switching accounts.
    if (old && (old.user_id !== user.id || old.session_hash !== sessionHash))
      await exec(
        "DELETE FROM push_deliveries WHERE subscription_id=?",
        [id],
        db,
      );
    await exec(
      `INSERT INTO push_subscriptions (id,endpoint_hash,user_id,session_hash,endpoint,p256dh,auth,vapid_hash,orders,news,promotions,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,TRUE,?,?) ON DUPLICATE KEY UPDATE user_id=VALUES(user_id),session_hash=VALUES(session_hash),vapid_hash=VALUES(vapid_hash),orders=VALUES(orders),news=VALUES(news),promotions=VALUES(promotions),active=TRUE,updated_at=VALUES(updated_at)`,
      [
        id,
        hash(s.endpoint),
        user.id,
        sessionHash,
        s.endpoint,
        s.keys.p256dh,
        s.keys.auth,
        hash(c.publicKey),
        b.preferences.orders,
        b.preferences.news,
        b.preferences.promotions,
        now,
        now,
      ],
      db,
    );
  });
  return { ok: true, preferences: b.preferences };
}
export async function pushDeviceStatus(
  userId: string,
  sessionHash: string,
  input: unknown,
) {
  await ensurePushSchema();
  const b = pushDeviceSchema.parse(input),
    [s] = await rows<any>(
      "SELECT active,orders,news,promotions,vapid_hash FROM push_subscriptions WHERE endpoint_hash=? AND user_id=? AND session_hash=?",
      [hash(b.endpoint), userId, sessionHash],
    );
  return {
    active: !!s?.active && s.vapid_hash === hash(pushConfig().publicKey),
    preferences: {
      orders: s ? !!s.orders : true,
      news: s ? !!s.news : true,
      promotions: s ? !!s.promotions : false,
    },
  };
}
export async function removePushSubscription(
  userId: string,
  sessionHash: string,
  input: unknown,
) {
  await ensurePushSchema();
  const b = pushDeviceSchema.parse(input);
  await transaction(async (db) => {
    await exec(
      "DELETE d FROM push_deliveries d JOIN push_subscriptions s ON s.id=d.subscription_id WHERE s.endpoint_hash=? AND s.user_id=? AND s.session_hash=?",
      [hash(b.endpoint), userId, sessionHash],
      db,
    );
    await exec(
      "UPDATE push_subscriptions SET active=FALSE,updated_at=? WHERE endpoint_hash=? AND user_id=? AND session_hash=?",
      [sqlDate(), hash(b.endpoint), userId, sessionHash],
      db,
    );
  });
  return { ok: true };
}
export async function revokeSessionPush(sessionHash: string) {
  await ensurePushSchema();
  await transaction(async (db) => {
    await exec(
      "DELETE d FROM push_deliveries d JOIN push_subscriptions s ON s.id=d.subscription_id WHERE s.session_hash=?",
      [sessionHash],
      db,
    );
    await exec(
      "UPDATE push_subscriptions SET active=FALSE,updated_at=? WHERE session_hash=?",
      [sqlDate(), sessionHash],
      db,
    );
  });
}
export async function queueNotificationPush(
  db: DB,
  userId: string,
  notificationId: string,
  category: string,
) {
  if (!pushConfig().configured) return;
  await ensurePushSchema();
  const setting =
      category === "order"
        ? "orders"
        : category === "promotion"
          ? "promotions"
          : "news",
    now = sqlDate(),
    expiry = sqlDate(
      new Date(Date.now() + (category === "order" ? 3600 : 86400) * 1000),
    );
  await exec(
    `INSERT INTO push_deliveries (id,notification_id,subscription_id,user_id,next_at,expires_at,created_at) SELECT UUID(),?,p.id,p.user_id,?,?,? FROM push_subscriptions p JOIN users u ON u.id=p.user_id JOIN sessions s ON s.token_hash=p.session_hash AND s.user_id=p.user_id WHERE p.user_id=? AND p.active=TRUE AND p.${setting}=TRUE AND u.active=TRUE AND s.expires_at>?`,
    [notificationId, now, expiry, now, userId, now],
    db,
  );
}
// Self-test never creates an inbox notification or increments unread totals.
export async function queuePushTest(
  userId: string,
  sessionHash: string,
  input: unknown,
) {
  await ensurePushSchema();
  const b = pushDeviceSchema.parse(input);
  await transaction(async (db) => {
    const [s] = await rows<any>(
      "SELECT id,last_test_at FROM push_subscriptions WHERE endpoint_hash=? AND user_id=? AND session_hash=? AND active=TRUE FOR UPDATE",
      [hash(b.endpoint), userId, sessionHash],
      db,
    );
    if (!s) throw new AppError("Hãy bật thông báo trên thiết bị trước.", 409);
    if (
      s.last_test_at &&
      Date.now() - new Date(s.last_test_at.replace(" ", "T") + "Z").getTime() <
        30000
    )
      throw new AppError("Chờ 30 giây trước khi gửi lại thông báo thử.", 429);
    const now = sqlDate();
    await exec(
      "UPDATE push_subscriptions SET last_test_at=? WHERE id=?",
      [now, s.id],
      db,
    );
    await exec(
      "INSERT INTO push_deliveries (id,notification_id,subscription_id,user_id,next_at,expires_at,created_at) VALUES (?,?,?,?,?,?,?)",
      [
        randomUUID(),
        "test-" + randomUUID().slice(0, 30),
        s.id,
        userId,
        now,
        sqlDate(new Date(Date.now() + 300000)),
        now,
      ],
      db,
    );
  });
  return { ok: true };
}
type Job = Record<string, any>;
export type PushSender = (
  subscription: webpush.PushSubscription,
  payload: string,
  options: webpush.RequestOptions,
) => Promise<unknown>;
let running: Promise<{
  sent: number;
  cancelled: number;
  retry: number;
}> | null = null;
export function processPushQueue(
  options: { limit?: number; budgetMs?: number; send?: PushSender } = {},
) {
  if (!pushConfig().configured)
    return Promise.resolve({ sent: 0, cancelled: 0, retry: 0 });
  if (!running)
    running = drain(options).finally(() => {
      running = null;
    });
  return running;
}
async function drain({
  limit = 100,
  budgetMs = 8000,
  send = webpush.sendNotification,
}: {
  limit?: number;
  budgetMs?: number;
  send?: PushSender;
}) {
  await ensurePushSchema();
  const c = pushConfig(),
    stats = { sent: 0, cancelled: 0, retry: 0 },
    deadline = Date.now() + budgetMs;
  let claimed = 0;
  while (Date.now() < deadline && claimed < limit) {
    const token = randomUUID(),
      ids = await transaction(async (db) => {
        const a = await rows<{ id: string }>(
          `SELECT id FROM push_deliveries WHERE (state='PENDING' AND next_at<=? OR state='SENDING' AND lease_until<=?) ORDER BY next_at,id LIMIT ? FOR UPDATE`,
          [sqlDate(), sqlDate(), Math.min(20, limit - claimed)],
          db,
        );
        for (const j of a)
          await exec(
            "UPDATE push_deliveries SET state='SENDING',attempts=attempts+1,lease_token=?,lease_until=? WHERE id=?",
            [token, sqlDate(new Date(Date.now() + 60000)), j.id],
            db,
          );
        return a.map((j) => j.id);
      });
    if (!ids.length) break;
    claimed += ids.length;
    const jobs = await rows<Job>(
      `SELECT d.*,p.endpoint,p.p256dh,p.auth,p.active,p.vapid_hash,p.user_id device_user,p.orders,p.news,p.promotions,n.title,n.body,n.href,n.category,n.is_read,u.active user_active,s.expires_at session_expiry FROM push_deliveries d LEFT JOIN push_subscriptions p ON p.id=d.subscription_id LEFT JOIN users u ON u.id=d.user_id LEFT JOIN sessions s ON s.token_hash=p.session_hash AND s.user_id=p.user_id LEFT JOIN notifications n ON n.id=d.notification_id WHERE d.lease_token=? AND d.state='SENDING'`,
      [token],
    );
    const deliver = async (j: Job) => {
      const test = j.notification_id.startsWith("test-"),
        expiry = new Date(j.expires_at.replace(" ", "T") + "Z").getTime(),
        enabled =
          j.category === "order"
            ? j.orders
            : j.category === "promotion"
              ? j.promotions
              : j.news;
      let state = "SENT",
        code: string | null = null;
      if (
        !j.active ||
        !j.user_active ||
        j.device_user !== j.user_id ||
        !j.session_expiry ||
        new Date(j.session_expiry.replace(" ", "T") + "Z").getTime() <=
          Date.now() ||
        j.vapid_hash !== hash(c.publicKey) ||
        expiry <= Date.now() ||
        !safePushEndpoint(j.endpoint) ||
        (!test && (!j.title || j.is_read || !enabled))
      ) {
        state = "CANCELLED";
        code = "INACTIVE_OR_EXPIRED";
      } else
        try {
          await send(
            { endpoint: j.endpoint, keys: { p256dh: j.p256dh, auth: j.auth } },
            JSON.stringify({
              id: j.notification_id,
              userId: j.user_id,
              category: j.category || "test",
              title: test
                ? "Thông báo đã được bật"
                : String(j.title).slice(0, 100),
              body: test
                ? "Thiết bị này có thể nhận thông báo đơn hàng và tin mới."
                : String(j.body).slice(0, 240),
              href: test ? "/me/settings" : safePushHref(j.href),
            }),
            {
              vapidDetails: {
                subject: c.subject,
                publicKey: c.publicKey,
                privateKey: c.privateKey,
              },
              TTL: Math.max(
                1,
                Math.min(86400, Math.floor((expiry - Date.now()) / 1000)),
              ),
              urgency: j.category === "order" ? "high" : "normal",
              topic: hash(j.notification_id).slice(0, 32),
              timeout: 2500,
            },
          );
        } catch (e) {
          const status = Number((e as any).statusCode || 0);
          code = status ? "HTTP_" + status : "NETWORK";
          if ([404, 410].includes(status)) {
            state = "CANCELLED";
            await exec(
              "UPDATE push_subscriptions SET active=FALSE,updated_at=? WHERE id=? AND endpoint=?",
              [sqlDate(), j.subscription_id, j.endpoint],
            );
          } else state = j.attempts >= 5 ? "FAILED" : "PENDING";
        }
      const next = sqlDate(
        new Date(
          Date.now() +
            Math.min(900000, 30000 * 2 ** Math.min(j.attempts - 1, 5)),
        ),
      );
      await exec(
        "UPDATE push_deliveries SET state=?,next_at=?,lease_token=NULL,lease_until=NULL,sent_at=?,last_error=? WHERE id=? AND lease_token=?",
        [state, next, state === "SENT" ? sqlDate() : null, code, j.id, token],
      );
      if (state === "SENT") stats.sent++;
      else if (state === "PENDING") stats.retry++;
      else stats.cancelled++;
    };
    // Bound parallel HTTPS sends so push cannot exhaust database or request duration.
    for (let i = 0; i < jobs.length; i += 4)
      await Promise.all(jobs.slice(i, i + 4).map(deliver));
  }
  await exec(
    "DELETE FROM push_deliveries WHERE expires_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 7 DAY)",
  );
  return stats;
}
