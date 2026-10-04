import assert from "node:assert/strict";
import { randomUUID, createHash, createECDH, randomBytes } from "node:crypto";
import webpush from "web-push";
import { rows, exec, transaction, pool, sqlDate } from "../src/lib/db";
import {
  notify,
  readNotification,
  unreadNotificationCounts,
} from "../src/lib/notifications";
import { ensurePushSchema } from "../src/lib/push-schema";
import {
  pushConfig,
  safePushEndpoint,
  safePushHref,
  savePushSubscription,
  pushDeviceStatus,
  removePushSubscription,
  revokeSessionPush,
  queuePushTest,
  processPushQueue,
  type PushSender,
} from "../src/lib/push";
import type { Actor } from "../src/lib/domain";

const dbUrl = new URL(process.env.DATABASE_URL!);
assert.equal(dbUrl.hostname, "127.0.0.1", "Only local fixture DB is allowed");
assert.equal(dbUrl.port, "3307");
const vapid = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
process.env.VAPID_SUBJECT = "https://toigibanthe.vercel.app";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const users: Actor[] = Array.from({ length: 2 }, (_, i) => ({
  id: randomUUID(),
  name: "Push fixture",
  email: randomUUID() + "@push.local.test",
  phone: "",
  role: i ? "chef" : "user",
  active: 1,
}));
const sessions = [hash(randomUUID()), hash(randomUUID()), hash(randomUUID())];
const notifications: string[] = [];
function device() {
  const key = createECDH("prime256v1");
  key.generateKeys();
  return {
    endpoint: "https://fcm.googleapis.com/fcm/send/fixture-" + randomUUID(),
    keys: {
      p256dh: key.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  };
}
const devices = [device(), device()];
const prefs = { orders: true, news: true, promotions: false };
async function subscription(
  i: number,
  who = 0,
  session = 0,
  preferences = prefs,
) {
  return savePushSubscription(users[who], sessions[session], {
    subscription: devices[i],
    preferences,
  });
}
async function message(category = "order", who = 0) {
  await transaction((db) =>
    notify(
      db,
      users[who].id,
      category,
      "Đơn mới",
      "Nội dung kiểm tra",
      "/orders/fixture",
    ),
  );
  const [n] = await rows<{ id: string }>(
    "SELECT id FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 1",
    [users[who].id],
  );
  notifications.push(n.id);
  return n.id;
}
const sent: any[] = [];
const sender: PushSender = async (_subscription, payload, options) => {
  sent.push({ payload: JSON.parse(payload), options });
};
async function drain(send: PushSender = sender) {
  return processPushQueue({ send });
}
async function jobs(id: string) {
  return rows<any>("SELECT * FROM push_deliveries WHERE notification_id=?", [
    id,
  ]);
}
try {
  await ensurePushSchema();
  assert.equal(pushConfig().configured, true);
  const oldPrivate = process.env.VAPID_PRIVATE_KEY;
  process.env.VAPID_PRIVATE_KEY = webpush.generateVAPIDKeys().privateKey;
  assert.equal(pushConfig().configured, false);
  process.env.VAPID_PRIVATE_KEY = oldPrivate;
  for (const url of [
    "https://127.0.0.1/test",
    "http://fcm.googleapis.com/test",
    "https://fcm.googleapis.com.evil.test/test",
    "https://user@fcm.googleapis.com/test",
    "https://fcm.googleapis.com:8443/test",
    "https://fcm.googleapis.com/test#frag",
  ])
    assert.equal(safePushEndpoint(url), false, url);
  for (const url of [
    devices[0].endpoint,
    "https://web.push.apple.com/q",
    "https://updates.push.services.mozilla.com/wpush/v2/fixture",
    "https://a.notify.windows.com/w/",
  ])
    assert.equal(safePushEndpoint(url), true);
  assert.equal(safePushHref("//evil.test"), "/notifications");
  assert.equal(safePushHref("/\\evil.test"), "/notifications");
  assert.equal(safePushHref("/orders/a"), "/orders/a");
  for (const user of users)
    await exec(
      "INSERT INTO users (id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)",
      [
        user.id,
        user.name,
        user.email,
        "fixture-never-login",
        user.role,
        sqlDate(),
      ],
    );
  for (let i = 0; i < sessions.length; i++)
    await exec("INSERT INTO sessions VALUES (?,?,?)", [
      sessions[i],
      users[i === 1 ? 1 : 0].id,
      sqlDate(new Date(Date.now() + 3600000)),
    ]);
  await assert.rejects(subscription(0, 0, 1), /Phiên đăng nhập/);
  await subscription(0);
  await subscription(1);
  assert.equal(
    (await pushDeviceStatus(users[0].id, sessions[0], devices[0])).active,
    true,
  );
  assert.equal(
    (await pushDeviceStatus(users[1].id, sessions[1], devices[0])).active,
    false,
  );
  await removePushSubscription(users[1].id, sessions[1], devices[0]);
  assert.equal(
    (await pushDeviceStatus(users[0].id, sessions[0], devices[0])).active,
    true,
  );
  await assert.rejects(
    savePushSubscription(users[1], sessions[1], {
      subscription: { ...devices[0], keys: device().keys },
    }),
    /không khớp/,
  );
  await assert.rejects(
    savePushSubscription(users[0], sessions[0], {
      subscription: {
        ...devices[0],
        keys: { ...devices[0].keys, p256dh: "A".repeat(87) },
      },
    }),
    /không hợp lệ/,
  );
  const before = Number(
    (
      await rows<any>(
        "SELECT COUNT(*) n FROM push_deliveries WHERE user_id=?",
        [users[0].id],
      )
    )[0].n,
  );
  await assert.rejects(
    transaction(async (db) => {
      await notify(db, users[0].id, "order", "Rollback", "Rollback", "/orders");
      throw new Error("rollback");
    }),
    /rollback/,
  );
  assert.equal(
    Number(
      (
        await rows<any>(
          "SELECT COUNT(*) n FROM push_deliveries WHERE user_id=?",
          [users[0].id],
        )
      )[0].n,
    ),
    before,
  );
  const order = await message();
  assert.equal((await jobs(order)).length, 2);
  await Promise.all([drain(), drain()]);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].payload.category, "order");
  assert.equal(sent[0].options.urgency, "high");
  assert.equal(sent[0].options.topic.length, 32);
  await drain();
  assert.equal(sent.length, 2, "No resend of SENT jobs");
  const promo = await message("promotion");
  assert.equal((await jobs(promo)).length, 0);
  await subscription(1, 0, 0, { ...prefs, news: false });
  const news = await message("news");
  assert.equal((await jobs(news)).length, 1);
  await drain();
  const read = await message();
  await readNotification(users[0].id, read);
  assert.equal((await drain()).cancelled, 2);
  const switched = await message();
  await subscription(0, 1, 1);
  assert.equal(
    (await jobs(switched)).length,
    1,
    "Shared-browser rebinding clears old jobs",
  );
  await drain();
  await subscription(0);
  const failed = await message();
  const network: PushSender = async () => {
    throw Object.assign(new Error("no endpoint in logs"), { statusCode: 503 });
  };
  assert.equal((await drain(network)).retry, 2);
  assert.ok(
    (await jobs(failed)).every(
      (j) => j.state === "PENDING" && j.last_error === "HTTP_503",
    ),
  );
  await exec("UPDATE push_deliveries SET next_at=? WHERE notification_id=?", [
    sqlDate(),
    failed,
  ]);
  await drain();
  assert.ok(
    (await jobs(failed)).every((j) => j.state === "SENT" && j.attempts === 2),
  );
  const expired = await message();
  await exec(
    "UPDATE push_deliveries SET expires_at=? WHERE notification_id=?",
    [sqlDate(new Date(Date.now() - 1000)), expired],
  );
  assert.equal((await drain()).cancelled, 2);
  const blocked = await message();
  await exec("UPDATE users SET active=FALSE WHERE id=?", [users[0].id]);
  assert.equal((await drain()).cancelled, 2);
  await exec("UPDATE users SET active=TRUE WHERE id=?", [users[0].id]);
  const sessionExpired = await message();
  await exec("UPDATE sessions SET expires_at=? WHERE token_hash=?", [
    sqlDate(new Date(Date.now() - 1000)),
    sessions[0],
  ]);
  assert.equal((await drain()).cancelled, 2);
  await exec("UPDATE sessions SET expires_at=? WHERE token_hash=?", [
    sqlDate(new Date(Date.now() + 3600000)),
    sessions[0],
  ]);
  const lease = await message();
  await exec(
    "UPDATE push_deliveries SET state='SENDING',lease_token=?,lease_until=? WHERE notification_id=?",
    [randomUUID(), sqlDate(new Date(Date.now() - 1000)), lease],
  );
  assert.equal((await drain()).sent, 2);
  const stopped = await message();
  await subscription(0, 0, 0, { ...prefs, orders: false });
  await drain();
  assert.deepEqual((await jobs(stopped)).map((j) => j.state).sort(), [
    "CANCELLED",
    "SENT",
  ]);
  await subscription(0);
  const gone = await message();
  const goneSender: PushSender = async () => {
    throw Object.assign(new Error("gone"), { statusCode: 410 });
  };
  assert.equal((await drain(goneSender)).cancelled, 2);
  assert.equal(
    (await pushDeviceStatus(users[0].id, sessions[0], devices[0])).active,
    false,
  );
  await subscription(0);
  const counts = await unreadNotificationCounts(users[0].id);
  await queuePushTest(users[0].id, sessions[0], devices[0]);
  assert.deepEqual(await unreadNotificationCounts(users[0].id), counts);
  await assert.rejects(
    queuePushTest(users[0].id, sessions[0], devices[0]),
    /30 giây/,
  );
  assert.equal((await drain()).sent, 1);
  await assert.rejects(
    queuePushTest(users[1].id, sessions[1], devices[0]),
    /bật thông báo/,
  );
  // Sign out this session only; another device's session remains enabled.
  await subscription(1, 0, 2);
  const logout = await message();
  await revokeSessionPush(sessions[0]);
  assert.equal((await jobs(logout)).length, 1);
  assert.equal(
    (await pushDeviceStatus(users[0].id, sessions[2], devices[1])).active,
    true,
  );
  await drain();
  assert.equal(
    (await pushDeviceStatus(users[0].id, sessions[0], devices[0])).active,
    false,
  );
  console.log(
    "PASS Web Push: endpoint/key validation, DB rollback, roles/device ownership, preferences, lease/dedup, retries/410, read/blocked/expired sessions, shared browser, logout and rate-limited self-test.",
  );
} finally {
  for (const user of users) {
    await exec("DELETE FROM push_deliveries WHERE user_id=?", [user.id]);
    await exec("DELETE FROM push_subscriptions WHERE user_id=?", [user.id]);
    await exec("DELETE FROM notifications WHERE user_id=?", [user.id]);
    await exec("DELETE FROM realtime_outbox WHERE user_id=?", [user.id]);
    await exec("DELETE FROM sessions WHERE user_id=?", [user.id]);
    await exec("DELETE FROM users WHERE id=?", [user.id]);
  }
  await pool().end();
}
