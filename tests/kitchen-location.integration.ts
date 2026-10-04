import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { rows, exec, pool, sqlDate } from "../src/lib/db";
import { haversine, serviceDate } from "../src/lib/domain";
import { createOrder } from "../src/lib/orders";
import { AppError } from "../src/lib/http";

// Uses the existing local dev server and isolated, temporary fixtures.
const database = new URL(process.env.DATABASE_URL!);
assert.equal(database.hostname, "127.0.0.1");
assert.equal(database.port, "3307");
const base = "http://127.0.0.1:3000";
const ids = {
  chef: randomUUID(),
  product: randomUUID(),
  session: randomUUID(),
  menu: randomUUID(),
};
const users: string[] = [],
  emails: string[] = [],
  cookies: string[] = [];
const next = {
  address: "91 Trung Kính, Yên Hòa, Hà Nội",
  area: "Yên Hòa, Hà Nội",
  lat: 21.013693996,
  lng: 105.79826308,
  radiusKm: 1,
  bio: "Bếp kiểm thử vị trí Goong",
};
async function call(path: string, body?: unknown, who = 0) {
  const response = await fetch(base + "/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      origin: base,
      "content-type": "application/json",
      ...(cookies[who] ? { cookie: cookies[who] } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    data: await response.json(),
    headers: response.headers,
  };
}
try {
  for (let i = 0; i < 2; i++) {
    const email = `kitchen-location-${randomUUID()}@local.test`;
    emails.push(email);
    const r = await call("auth/register", {
      name: "Kiểm thử vị trí",
      email,
      password: randomUUID(),
    });
    assert.equal(r.status, 200);
    users.push(r.data.user.id);
    cookies.push(r.headers.get("set-cookie")!.split(";")[0]);
  }
  await exec('UPDATE users SET role="chef" WHERE id=?', [users[0]]);
  await exec(
    "INSERT INTO chefs (id,user_id,name,bio,address,area,lat,lng,status,bank_bin,bank_name,account_no,account_name,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      ids.chef,
      users[0],
      "Kitchen location test",
      next.bio,
      "Địa chỉ bếp trước thay đổi",
      "Khu vực cũ",
      10.7817,
      106.6809,
      "approved",
      "970436",
      "Vietcombank",
      "0000000000000000000",
      "LOCAL TEST",
      sqlDate(),
    ],
  );
  await exec(
    "INSERT INTO products (id,chef_id,name,description,price,image_url,created_at) VALUES (?,?,?,?,?,?,?)",
    [
      ids.product,
      ids.chef,
      "Món kiểm thử vị trí",
      "Chỉ dùng kiểm thử local",
      40000,
      "https://images.unsplash.com/photo-1511690743698-d9d85f2fbf38",
      sqlDate(),
    ],
  );
  await exec("INSERT INTO kitchen_sessions VALUES (?,?,?,?,?)", [
    ids.session,
    ids.chef,
    serviceDate(),
    true,
    sqlDate(),
  ]);
  await exec("INSERT INTO daily_menu VALUES (?,?,?,?,?,?,?,?,?)", [
    ids.menu,
    ids.session,
    ids.product,
    "late",
    sqlDate(new Date(Date.now() + 3600000)),
    5,
    null,
    null,
    true,
  ]);
  assert.equal((await call("chef/settings", next, 1)).status, 403);
  assert.equal(
    (await call("chef/settings", { ...next, lat: 100 })).status,
    400,
  );
  assert.equal(
    (await call("chef/settings", { ...next, address: "" })).status,
    400,
  );
  assert.equal((await call("chef/settings", next)).status, 200);
  const saved = (
    await rows<any>("SELECT * FROM chefs WHERE id=?", [ids.chef])
  )[0];
  assert.equal(saved.address, next.address);
  assert.equal(saved.area, next.area);
  assert.equal(saved.lat, next.lat);
  assert.equal(saved.lng, next.lng);
  console.log(
    "PASS: chỉ chef sở hữu được lưu; địa chỉ, khu vực và tọa độ được cập nhật cùng nhau",
  );
  const inside = { lat: next.lat + 0.005, lng: next.lng },
    outside = { lat: next.lat + 0.0091, lng: next.lng };
  assert.ok(haversine(next, inside) < 1);
  assert.ok(haversine(next, outside) > 1);
  const feed = await call(
    `catalog?lat=${inside.lat}&lng=${inside.lng}&chef=${ids.chef}`,
  );
  const dish = feed.data.dishes.find((d: any) => d.menuId === ids.menu);
  assert.ok(dish);
  assert.ok(Math.abs(dish.distance - haversine(next, inside)) < 0.0001);
  assert.equal(
    (
      await call(
        `catalog?lat=${outside.lat}&lng=${outside.lng}&chef=${ids.chef}`,
      )
    ).data.dishes.length,
    0,
  );
  assert.equal(
    (
      await call(
        "orders/quote",
        { ...outside, items: [{ menuId: ids.menu, quantity: 1 }] },
        1,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        "orders/quote",
        { ...inside, items: [{ menuId: ids.menu, quantity: 1 }] },
        1,
      )
    ).status,
    200,
  );
  console.log(
    "PASS: catalog và checkout dùng đúng tọa độ mới; trong 1km thấy/đặt được, ngoài 1km bị chặn",
  );
  const order = await call(
    "orders",
    {
      ...inside,
      address: "Địa chỉ khách kiểm thử local",
      recipient: "Khách kiểm thử",
      phone: "0901234567",
      items: [{ menuId: ids.menu, quantity: 1 }],
      idempotencyKey: randomUUID(),
    },
    1,
  );
  assert.equal(order.status, 200, JSON.stringify(order.data));
  const before = (
    await rows<any>(
      "SELECT chef_lat,chef_lng,distance_km FROM orders WHERE id=?",
      [order.data.id],
    )
  )[0];
  assert.equal(before.chef_lat, next.lat);
  assert.equal(before.chef_lng, next.lng);
  assert.ok(Math.abs(before.distance_km - haversine(next, inside)) < 0.0001);
  assert.equal(
    (
      await call("chef/settings", {
        ...next,
        lat: next.lat + 0.01,
        address: "Địa chỉ bếp mới hơn, Yên Hòa, Hà Nội",
      })
    ).status,
    200,
  );
  const after = (
    await rows<any>(
      "SELECT chef_lat,chef_lng,distance_km FROM orders WHERE id=?",
      [order.data.id],
    )
  )[0];
  assert.deepEqual(after, before);
  console.log(
    "PASS: đơn đã tạo giữ nguyên vị trí bếp và khoảng cách khi chef đổi vị trí",
  );
  const originalFetch = globalThis.fetch,
    originalKey = process.env.GOONG_API_KEY;
  process.env.GOONG_API_KEY = "local-test-only";
  try {
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith("https://rsapi.goong.io/v2/direction"))
        return originalFetch(url, options);
      const params = new URL(String(url)).searchParams;
      assert.equal(params.get("origin"), `${next.lat + 0.01},${next.lng}`);
      assert.equal(params.get("destination"), `${inside.lat},${inside.lng}`);
      // Simulate a kitchen move while Goong is calculating the old route.
      await exec("UPDATE chefs SET lat=lat+0.001 WHERE id=?", [ids.chef]);
      return Response.json({
        routes: [
          {
            legs: [{ distance: { value: 1000 }, duration: { value: 60 } }],
            overview_polyline: { points: "" },
          },
        ],
      });
    };
    await assert.rejects(
      createOrder(
        {
          id: users[1],
          name: "Khách kiểm thử",
          email: emails[1],
          phone: "0901234567",
          role: "user",
          active: 1,
        },
        {
          ...inside,
          address: "Địa chỉ khách kiểm thử local",
          recipient: "Khách kiểm thử",
          phone: "0901234567",
          items: [{ menuId: ids.menu, quantity: 1 }],
          idempotencyKey: randomUUID(),
        },
      ),
      (error: unknown) => error instanceof AppError && error.status === 409,
    );
    assert.equal(
      (
        await rows<any>("SELECT COUNT(*) n FROM orders WHERE chef_id=?", [
          ids.chef,
        ])
      )[0].n,
      1,
    );
    assert.equal(
      (
        await rows<any>("SELECT stock FROM daily_menu WHERE id=?", [ids.menu])
      )[0].stock,
      4,
    );
    console.log(
      "PASS: Goong nhận lat,lng đúng thứ tự; chặn tuyến cũ nếu chef đổi vị trí lúc đang tính đường",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GOONG_API_KEY;
    else process.env.GOONG_API_KEY = originalKey;
  }
} finally {
  const orders = await rows<{ id: string }>(
    "SELECT id FROM orders WHERE chef_id=?",
    [ids.chef],
  );
  for (const order of orders) {
    for (const table of [
      "order_items",
      "order_events",
      "payment_exceptions",
      "reviews",
      "sepay_order_settings",
    ])
      await exec(`DELETE FROM ${table} WHERE order_id=?`, [order.id]);
    await exec("DELETE FROM orders WHERE id=?", [order.id]);
  }
  await exec("DELETE FROM daily_menu WHERE id=?", [ids.menu]);
  await exec("DELETE FROM kitchen_sessions WHERE id=?", [ids.session]);
  await exec("DELETE FROM products WHERE id=?", [ids.product]);
  await exec("DELETE FROM chefs WHERE id=?", [ids.chef]);
  for (const id of users) {
    await exec("DELETE FROM notifications WHERE user_id=?", [id]);
    await exec("DELETE FROM sessions WHERE user_id=?", [id]);
    const events = await rows<{ id: string }>(
      "SELECT id FROM realtime_outbox WHERE user_id=?",
      [id],
    );
    for (const event of events)
      await exec("DELETE FROM outbox_receipts WHERE event_id=?", [event.id]);
    await exec("DELETE FROM realtime_outbox WHERE user_id=?", [id]);
    await exec("DELETE FROM users WHERE id=?", [id]);
  }
  for (const email of emails)
    await exec("DELETE FROM platform_settings WHERE id=?", [
      "login:" + createHash("sha256").update(email).digest("hex").slice(0, 40),
    ]);
  await pool().end();
}
