import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { hash } from "bcryptjs";
import WebSocket from "ws";
import { rows, exec, transaction, sqlDate, pool } from "../src/lib/db";
import { cutoffAt, serviceDate } from "../src/lib/domain";
const base = "http://127.0.0.1:3000",
  suffix = randomUUID().slice(0, 8),
  password = "LocalTestOnly!2026";
const ids = {
  admin: randomUUID(),
  chef: randomUUID(),
  user1: randomUUID(),
  user2: randomUUID(),
  kitchen: randomUUID(),
  product: randomUUID(),
  menu: randomUUID(),
  c: randomUUID(),
};
const cookies: Record<string, string> = {},
  orderIds: string[] = [];
async function call(
  path: string,
  body?: unknown,
  who = "user1",
  method = body === undefined ? "GET" : "POST",
) {
  const r = await fetch(base + "/api/" + path, {
    method,
    headers: {
      origin: base,
      "content-type": "application/json",
      ...(cookies[who] ? { cookie: cookies[who] } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json();
  return { status: r.status, json, headers: r.headers };
}
async function login(who: string, email: string) {
  const r = await call("auth/login", { email, password }, who);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  cookies[who] = r.headers.get("set-cookie")!.split(";")[0];
}
let socket: WebSocket | undefined;
try {
  await transaction(async (db) => {
    const passwordHash = await hash(password, 10);
    for (const role of ["admin", "chef", "user1", "user2"] as const)
      await exec(
        "INSERT INTO users (id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)",
        [
          ids[role],
          `Test ${role}`,
          `${role}-${suffix}@local.test`,
          passwordHash,
          role.startsWith("user") ? "user" : role,
          sqlDate(),
        ],
        db,
      );
    await exec(
      "INSERT INTO chefs (id,user_id,name,bio,address,area,lat,lng,status,bank_bin,bank_name,account_no,account_name,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        ids.c,
        ids.chef,
        "Test kitchen " + suffix,
        "Test local only",
        "Địa chỉ thử nghiệm local",
        "Local",
        10.7817,
        106.6809,
        "approved",
        "970436",
        "Vietcombank",
        "0000000000000000000",
        "TEST LOCAL ONLY",
        sqlDate(),
      ],
      db,
    );
    await exec(
      "INSERT INTO products (id,chef_id,name,description,price,image_url,created_at) VALUES (?,?,?,?,?,?,?)",
      [
        ids.product,
        ids.c,
        "Món test " + suffix,
        "Test only",
        40000,
        "https://images.unsplash.com/photo-1511690743698-d9d85f2fbf38",
        sqlDate(),
      ],
      db,
    );
    await exec(
      "INSERT INTO kitchen_sessions VALUES (?,?,?,?,?)",
      [ids.kitchen, ids.c, serviceDate(), true, sqlDate()],
      db,
    );
    await exec(
      "INSERT INTO daily_menu VALUES (?,?,?,?,?,?,?,?,?)",
      [
        ids.menu,
        ids.kitchen,
        ids.product,
        "late",
        sqlDate(new Date(Date.now() + 3600000)),
        1,
        null,
        null,
        true,
      ],
      db,
    );
  });
  for (const who of ["admin", "chef", "user1", "user2"])
    await login(who, `${who}-${suffix}@local.test`);
  console.log("PASS: đăng nhập và cookie session MySQL");
  const ticket = await call("realtime/ticket", undefined, "chef");
  assert.equal(ticket.status, 200);
  socket = new WebSocket(
    "ws://127.0.0.1:3001/socket?ticket=" + ticket.json.ticket,
    { origin: base },
  );
  await new Promise<void>((resolve, reject) => {
    socket!.once("open", resolve);
    socket!.once("error", reject);
  });
  let received = false;
  socket.on("message", (data) => {
    const p = JSON.parse(data.toString());
    if (p.type === "notification" && p.title.includes("Đơn mới"))
      received = true;
  });
  const payload = {
    items: [{ menuId: ids.menu, quantity: 1 }],
    address: "Địa chỉ thử nghiệm local",
    lat: 10.7817,
    lng: 106.6809,
    recipient: "Test local",
    phone: "0900000000",
    idempotencyKey: randomUUID(),
  };
  const quote = await call("orders/quote", {
    items: payload.items,
    lat: payload.lat,
    lng: payload.lng,
  });
  assert.equal(quote.status, 200, JSON.stringify(quote.json));
  assert.equal(quote.json.subtotal, 40000);
  assert.equal(
    quote.json.total,
    quote.json.subtotal - quote.json.discount + quote.json.deliveryFee,
  );
  assert.equal(
    (await call("orders", { ...payload, expectedTotal: quote.json.total + 1 }))
      .status,
    400,
  );
  assert.equal(
    (
      await rows<{ stock: number }>("SELECT stock FROM daily_menu WHERE id=?", [
        ids.menu,
      ])
    )[0].stock,
    1,
  );
  console.log(
    "PASS: báo giá server, chặn tổng tiền thay đổi và giữ nguyên suất",
  );
  assert.equal(
    (await call("admin/chefs/" + ids.c, undefined, "user1")).status,
    403,
  );
  const chefProfile = await call("admin/chefs/" + ids.c, undefined, "admin");
  assert.equal(chefProfile.status, 200);
  assert.equal(chefProfile.json.chef.id, ids.c);
  console.log("PASS: chỉ admin đọc hồ sơ riêng tư của chef");
  const secondPayload = { ...payload, idempotencyKey: randomUUID() };
  const race = await Promise.all([
    call("orders", payload, "user1"),
    call("orders", secondPayload, "user2"),
  ]);
  for (const r of race) if (r.status === 200) orderIds.push(r.json.id);
  assert.equal(
    race.filter((r) => r.status === 200).length,
    1,
    JSON.stringify(race),
  );
  assert.equal(
    race.filter((r) => r.status === 400).length,
    1,
    JSON.stringify(race),
  );
  const winner = race[0].status === 200 ? "user1" : "user2",
    placed = race.find((r) => r.status === 200)!.json.id;
  console.log("PASS: hai người mua suất cuối, không bán vượt suất");
  {
    const winnerPayload = winner === "user1" ? payload : secondPayload;
    const retry = await call("orders", winnerPayload, winner);
    assert.equal(retry.json.id, placed);
    assert.equal(
      (
        await rows(
          "SELECT id FROM orders WHERE user_id=? AND idempotency_key=?",
          [ids[winner], winnerPayload.idempotencyKey],
        )
      ).length,
      1,
    );
    console.log("PASS: request lặp trả cùng đơn");
  }
  assert.equal(
    (
      await call(
        "orders/" + placed,
        undefined,
        winner === "user1" ? "user2" : "user1",
      )
    ).status,
    403,
  );
  assert.equal((await call("admin", undefined, "user1")).status, 403);
  console.log("PASS: user không đọc đơn người khác hoặc gọi admin API");
  assert.equal(
    (
      await call(
        "orders/" + placed + "/action",
        { action: "report-payment" },
        winner,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await rows<{ payment_status: string }>(
        "SELECT payment_status FROM orders WHERE id=?",
        [placed],
      )
    )[0].payment_status,
    "PENDING",
  );
  assert.equal(
    (await call("orders/" + placed + "/action", { action: "ACCEPTED" }, winner))
      .status,
    403,
  );
  for (const action of ["ACCEPTED", "PREPARING", "DELIVERING", "DELIVERED"])
    assert.equal(
      (await call("orders/" + placed + "/action", { action }, "chef")).status,
      200,
      action,
    );
  assert.equal(
    (
      await call(
        "orders/" + placed + "/action",
        { action: "COMPLETED" },
        winner,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        "orders/" + placed + "/review",
        { rating: 5, body: "Test review" },
        winner,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        "orders/" + placed + "/review",
        { rating: 5, body: "Duplicate" },
        winner,
      )
    ).status,
    400,
  );
  console.log(
    "PASS: báo chuyển không tự xác nhận, chef nhận tiền, giao, khách hoàn thành, chống đánh giá trùng",
  );
  await exec("UPDATE daily_menu SET stock=2 WHERE id=?", [ids.menu]);
  const tooFar = await call(
    "orders",
    { ...payload, lat: 11.1, idempotencyKey: randomUUID() },
    "user1",
  );
  assert.equal(tooFar.status, 400);
  console.log("PASS: chặn ngoài bán kính tại server");
  await exec("UPDATE daily_menu SET cutoff_at=? WHERE id=?", [
    sqlDate(new Date(Date.now() - 1000)),
    ids.menu,
  ]);
  assert.equal(
    (
      await call(
        "orders",
        { ...payload, idempotencyKey: randomUUID() },
        "user1",
      )
    ).status,
    400,
  );
  console.log("PASS: chặn bữa hết giờ tại server");
  assert.equal(
    (
      await call(
        "chef/bank",
        {
          bankBin: "970436",
          bankName: "VCB",
          accountNo: "0000000000000000000",
          accountName: "TEST LOCAL ONLY",
        },
        "user1",
      )
    ).status,
    403,
  );
  // Wait only for the real WebSocket event with a short bounded deadline.
  await new Promise<void>((resolve) => {
    const until = Date.now() + 3500;
    const t = setInterval(() => {
      if (received || Date.now() > until) {
        clearInterval(t);
        resolve();
      }
    }, 100);
  });
  assert.ok(received, "WebSocket chef phải nhận thông báo đơn thật");
  console.log("PASS: thông báo đơn qua WebSocket có session hợp lệ");
  const invalidSocket = new WebSocket(
    "ws://127.0.0.1:3001/socket?ticket=invalid",
    { origin: base },
  );
  await new Promise<void>((resolve) => {
    invalidSocket.once("unexpected-response", (_req, res) => {
      assert.equal(res.statusCode, 401);
      res.resume();
      invalidSocket.terminate();
      resolve();
    });
    invalidSocket.once("error", () => resolve());
  });
  console.log("PASS: WebSocket từ chối ticket sai");
} finally {
  socket?.close();
  // Remove only rows with the unique identifiers created by this test.
  for (const id of orderIds) {
    await exec("DELETE FROM order_events WHERE order_id=?", [id]);
    await exec("DELETE FROM order_items WHERE order_id=?", [id]);
    await exec("DELETE FROM reviews WHERE order_id=?", [id]);
    await exec("DELETE FROM orders WHERE id=?", [id]);
  }
  for (const id of [ids.admin, ids.chef, ids.user1, ids.user2]) {
    await exec("DELETE FROM sessions WHERE user_id=?", [id]);
    await exec("DELETE FROM notifications WHERE user_id=?", [id]);
    const events = await rows<{ id: string }>(
      "SELECT id FROM realtime_outbox WHERE user_id=?",
      [id],
    );
    for (const e of events)
      await exec("DELETE FROM outbox_receipts WHERE event_id=?", [e.id]);
    await exec("DELETE FROM realtime_outbox WHERE user_id=?", [id]);
    await exec("DELETE FROM users WHERE id=?", [id]);
    await exec("DELETE FROM platform_settings WHERE id=?", [
      "login:" +
        createHash("sha256")
          .update(
            `${Object.entries(ids).find((x) => x[1] === id)?.[0]}-${suffix}@local.test`,
          )
          .digest("hex")
          .slice(0, 40),
    ]);
  }
  await exec("DELETE FROM daily_menu WHERE id=?", [ids.menu]);
  await exec("DELETE FROM kitchen_sessions WHERE id=?", [ids.kitchen]);
  await exec("DELETE FROM products WHERE id=?", [ids.product]);
  await exec("DELETE FROM chefs WHERE id=?", [ids.c]);
  await pool().end();
}
