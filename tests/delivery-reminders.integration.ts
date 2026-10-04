import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import mysql from "mysql2/promise";
import webpush from "web-push";
import { exec, rows, pool, transaction, sqlDate } from "../src/lib/db";
import { listOrders, transition } from "../src/lib/orders";
import { chefOverview } from "../src/lib/manage";
import { ACTIVE_ORDER_STATUSES, parseUTC, type Actor } from "../src/lib/domain";
import {
  ensureDeliveryReminderSchema,
  queueDeliveryReminder,
  processDeliveryReminders,
  DELIVERY_CONFIRMATION_DELAY_MS,
} from "../src/lib/delivery-reminders";

// Entirely isolated local database: jobs may scan all orders without touching local demo data.
const original = new URL(
  process.env.DELIVERY_TEST_DATABASE_URL || process.env.DATABASE_URL!,
);
assert.equal(original.hostname, "127.0.0.1");
assert.equal(original.port, "3307");
const name = "tgbd_delivery_test_" + randomUUID().replaceAll("-", "");
assert.match(name, /^tgbd_delivery_test_[a-f0-9]{32}$/);
const setup = await mysql.createConnection({
  host: original.hostname,
  port: Number(original.port),
  user: decodeURIComponent(original.username),
  password: decodeURIComponent(original.password),
  multipleStatements: true,
});
const fixtureUrl = new URL(original);
fixtureUrl.pathname = "/" + name;
process.env.DATABASE_URL = fixtureUrl.toString();
const vapid = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
process.env.VAPID_SUBJECT = "https://toigibanthe.vercel.app";
const actors: Actor[] = ["user", "chef", "admin", "user"].map((role, i) => ({
  id: randomUUID(),
  role: role as Actor["role"],
  name: "Delivery fixture " + i,
  email: randomUUID() + "@fixture.local",
  phone: "0901234567",
  active: 1,
}));
const chefId = randomUUID(),
  orderIds: string[] = [];
async function makeOrder(status = "DELIVERING") {
  const id = randomUUID(),
    code = randomUUID().replaceAll("-", "").slice(0, 10);
  orderIds.push(id);
  await exec(
    `INSERT INTO orders (id,code,user_id,chef_id,meal_id,status,payment_status,
    subtotal,delivery_fee,total,recipient,phone,address,lat,lng,chef_lat,chef_lng,distance_km,
    bank_bin,bank_name,account_no,account_name,transfer_content,idempotency_key,expires_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      code,
      actors[0].id,
      chefId,
      "lunch",
      status,
      "PAID_MANUAL",
      50000,
      10000,
      60000,
      "Fixture",
      "0901234567",
      "Fixture address",
      10.78,
      106.68,
      10.78,
      106.68,
      0,
      "970436",
      "Vietcombank",
      "000123",
      "FIXTURE",
      "TGBD" + code,
      randomUUID(),
      sqlDate(new Date(Date.now() + 3600000)),
      sqlDate(),
      sqlDate(),
    ],
  );
  return id;
}
async function reminder(id: string) {
  return (
    await rows<any>("SELECT * FROM order_delivery_reminders WHERE order_id=?", [
      id,
    ])
  )[0];
}
async function order(id: string) {
  return (await rows<any>("SELECT * FROM orders WHERE id=?", [id]))[0];
}
let created = false;
try {
  await setup.query(
    `CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  created = true;
  await setup.query(`USE \`${name}\``);
  for (const file of (await readdir(new URL("../database/", import.meta.url)))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await setup.query(
      await readFile(new URL("../database/" + file, import.meta.url), "utf8"),
    );
  for (const a of actors)
    await exec(
      "INSERT INTO users (id,name,email,password_hash,role,phone,created_at) VALUES (?,?,?,?,?,?,?)",
      [a.id, a.name, a.email, "fixture-only", a.role, a.phone, sqlDate()],
    );
  await exec(
    "INSERT INTO chefs (id,user_id,name,bio,address,area,lat,lng,status,bank_bin,bank_name,account_no,account_name,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      chefId,
      actors[1].id,
      "Fixture chef",
      "Fixture",
      "Fixture",
      "Fixture",
      10.78,
      106.68,
      "approved",
      "970436",
      "Vietcombank",
      "000123",
      "FIXTURE",
      sqlDate(),
    ],
  );
  const sid = createHash("sha256").update(randomUUID()).digest("hex"),
    deviceId = randomUUID();
  await exec("INSERT INTO sessions VALUES (?,?,?)", [
    sid,
    actors[0].id,
    sqlDate(new Date(Date.now() + 86400000)),
  ]);
  await exec(
    `INSERT INTO push_subscriptions (id,endpoint_hash,user_id,session_hash,endpoint,p256dh,auth,vapid_hash,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      deviceId,
      createHash("sha256").update(deviceId).digest("hex"),
      actors[0].id,
      sid,
      "https://fcm.googleapis.com/fcm/send/fixture-" + deviceId,
      "fixture-key",
      "fixture-auth",
      createHash("sha256").update(vapid.publicKey).digest("hex"),
      sqlDate(),
      sqlDate(),
    ],
  );
  await ensureDeliveryReminderSchema();
  const id = await makeOrder();
  await transition(actors[1], id, "DELIVERED");
  const scheduled = await reminder(id);
  const [event] = await rows<any>(
    "SELECT created_at FROM order_events WHERE order_id=? AND status='DELIVERED'",
    [id],
  );
  assert.equal(
    parseUTC(scheduled.due_at).getTime() - parseUTC(event.created_at).getTime(),
    DELIVERY_CONFIRMATION_DELAY_MS,
  );
  await transaction((db) =>
    queueDeliveryReminder(db, id, new Date(Date.now() + 86400000)),
  );
  assert.equal(
    (await reminder(id)).due_at,
    scheduled.due_at,
    "A retry never postpones the reminder",
  );
  assert.ok(
    !(await listOrders(actors[1], true, true)).some((o) => o.id === id),
  );
  assert.ok((await listOrders(actors[1], true)).some((o) => o.id === id));
  assert.ok(
    (await listOrders(actors[0], false, true)).some((o) => o.id === id),
  );
  assert.ok((await listOrders(actors[2], true, true)).some((o) => o.id === id));
  assert.ok(
    ACTIVE_ORDER_STATUSES.includes("DELIVERED"),
    "Admin/customer confirmation tracking is preserved",
  );
  for (const status of [
    "PLACED",
    "PAID",
    "ACCEPTED",
    "PREPARING",
    "DELIVERING",
    "COMPLETED",
    "CANCELLED",
  ])
    await makeOrder(status);
  assert.equal((await listOrders(actors[1], true, true)).length, 5);
  assert.equal((await chefOverview(actors[1])).stats.active_orders, 5);
  assert.deepEqual(
    await processDeliveryReminders(
      new Date(parseUTC(scheduled.due_at).getTime() - 1),
    ),
    { sent: 0, cancelled: 0 },
  );
  const batches = await Promise.all([
    processDeliveryReminders(parseUTC(scheduled.due_at)),
    processDeliveryReminders(parseUTC(scheduled.due_at)),
  ]);
  assert.equal(
    batches.reduce((n, b) => n + b.sent, 0),
    1,
    "Concurrent instances send once",
  );
  const sent = await reminder(id);
  const [notification] = await rows<any>(
    "SELECT * FROM notifications WHERE id=?",
    [sent.notification_id],
  );
  assert.equal(notification.user_id, actors[0].id);
  assert.equal(notification.category, "order");
  assert.equal(notification.href, "/orders/" + id);
  assert.ok(notification.body.includes("Tôi đã nhận món"));
  assert.equal(
    (
      await rows<any>(
        "SELECT id FROM realtime_outbox WHERE JSON_UNQUOTE(JSON_EXTRACT(payload,'$.id'))=?",
        [sent.notification_id],
      )
    ).length,
    1,
  );
  assert.equal(
    (
      await rows<any>(
        "SELECT id FROM push_deliveries WHERE notification_id=?",
        [sent.notification_id],
      )
    ).length,
    1,
  );
  assert.deepEqual(await processDeliveryReminders(parseUTC(scheduled.due_at)), {
    sent: 0,
    cancelled: 0,
  });
  assert.equal((await order(id)).status, "DELIVERED");
  await assert.rejects(() => transition(actors[3], id, "COMPLETED"));
  await transition(actors[0], id, "COMPLETED");
  assert.equal((await order(id)).status, "COMPLETED");
  await assert.rejects(() => transition(actors[0], id, "COMPLETED"));

  const early = await makeOrder();
  await transition(actors[1], early, "DELIVERED");
  await transition(actors[0], early, "COMPLETED");
  assert.equal((await reminder(early)).state, "CANCELLED");
  assert.deepEqual(
    await processDeliveryReminders(parseUTC((await reminder(early)).due_at)),
    { sent: 0, cancelled: 0 },
  );

  const legacy = await makeOrder("DELIVERED"),
    legacyAt = new Date(Date.now() - 2 * 3600000);
  await exec("INSERT INTO order_events VALUES (?,?,?,?,?,?)", [
    randomUUID(),
    legacy,
    actors[1].id,
    "DELIVERED",
    "Fixture",
    sqlDate(legacyAt),
  ]);
  await exec("UPDATE orders SET updated_at=? WHERE id=?", [sqlDate(), legacy]);
  assert.equal(
    (await processDeliveryReminders()).sent,
    1,
    "Legacy orders use the real delivery event",
  );
  assert.equal(
    parseUTC((await reminder(legacy)).due_at).getTime(),
    legacyAt.getTime() + DELIVERY_CONFIRMATION_DELAY_MS,
  );
  const orphan = randomUUID();
  await transaction((db) => queueDeliveryReminder(db, orphan, legacyAt));
  assert.equal(
    (await processDeliveryReminders()).cancelled,
    1,
    "Removed orders never receive reminders",
  );
  const rolledBack = randomUUID();
  await assert.rejects(() =>
    transaction(async (db) => {
      await queueDeliveryReminder(db, rolledBack);
      throw Error("Fixture rollback");
    }),
  );
  assert.equal(await reminder(rolledBack), undefined);
  const race = await makeOrder();
  await transition(actors[1], race, "DELIVERED");
  const raceAt = parseUTC((await reminder(race)).due_at);
  await Promise.all([
    transition(actors[0], race, "COMPLETED"),
    processDeliveryReminders(raceAt),
  ]);
  assert.equal((await order(race)).status, "COMPLETED");
  assert.ok(["SENT", "CANCELLED"].includes((await reminder(race)).state));
  assert.deepEqual(await processDeliveryReminders(raceAt), {
    sent: 0,
    cancelled: 0,
  });
  console.log(
    "PASS: chef processing list/count excludes delivered; exact 1h boundary; once under concurrency/retry; inbox/WebSocket/push atomic queue; early confirmation cancels; legacy delivery timestamp; owner-only completion; race/rollback/orphan safety. Isolated local DB, no real push sent.",
  );
} finally {
  try {
    if (created) {
      await pool().end();
      await setup.query(`DROP DATABASE IF EXISTS \`${name}\``);
    }
  } finally {
    await setup.end();
  }
}
