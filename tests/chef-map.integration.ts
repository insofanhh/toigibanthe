import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { nearbyMapChefs, feed } from "../src/lib/catalog";
import { exec, pool, rows, sqlDate } from "../src/lib/db";
import { haversine, serviceDate } from "../src/lib/domain";

const url = new URL(process.env.DATABASE_URL!);
assert.ok(
  ["localhost", "127.0.0.1"].includes(url.hostname),
  "Local database only",
);
const point = { lat: 21.013694, lng: 105.798263, address: "Địa chỉ kiểm thử" };
const owners: string[] = [],
  chefs: string[] = [],
  sessions: string[] = [],
  products: string[] = [];
const menus: string[] = [];
const date = serviceDate();
const yesterday = serviceDate(new Date(Date.now() - 86400000));
const future = sqlDate(new Date(Date.now() + 3600000));
async function fixture(offset: number, count = 1, day = date, meal = "late") {
  const owner = randomUUID(),
    chef = randomUUID(),
    session = randomUUID();
  owners.push(owner);
  chefs.push(chef);
  sessions.push(session);
  await exec(
    "INSERT INTO users (id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)",
    [owner, "Map test", `${owner}@local.test`, "unused", "chef", sqlDate()],
  );
  await exec(
    "INSERT INTO chefs (id,user_id,name,bio,address,area,lat,lng,radius_km,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [
      chef,
      owner,
      "Bếp map test",
      "",
      "Địa chỉ test",
      "Hà Nội",
      point.lat + offset,
      point.lng,
      5,
      "approved",
      sqlDate(),
    ],
  );
  await exec("INSERT INTO kitchen_sessions VALUES (?,?,?,?,?)", [
    session,
    chef,
    day,
    true,
    sqlDate(),
  ]);
  for (let i = 0; i < count; i++) {
    const product = randomUUID(),
      menu = randomUUID();
    products.push(product);
    menus.push(menu);
    await exec(
      "INSERT INTO products (id,chef_id,name,description,price,image_url,created_at) VALUES (?,?,?,?,?,?,?)",
      [product, chef, "Món map test", "", 30000, "/favicon.ico", sqlDate()],
    );
    await exec("INSERT INTO daily_menu VALUES (?,?,?,?,?,?,?,?,?)", [
      menu,
      session,
      product,
      meal,
      future,
      4,
      null,
      null,
      true,
    ]);
  }
  return {
    owner,
    chef,
    session,
    product: products.at(-1)!,
    menu: menus.at(-1)!,
  };
}
try {
  const late = (
    await rows<{ day_offset: number }>(
      "SELECT day_offset FROM meal_settings WHERE id='late'",
    )
  )[0];
  assert.equal(late?.day_offset, 1);
  const near = await fixture(0.001, 65),
    far = await fixture(0.01);
  const outside = await fixture(0.02);
  await exec("UPDATE chefs SET radius_km=1 WHERE id=?", [outside.chef]);
  const pending = await fixture(0.002);
  await exec("UPDATE chefs SET status='pending' WHERE id=?", [pending.chef]);
  const inactiveOwner = await fixture(0.003);
  await exec("UPDATE users SET active=FALSE WHERE id=?", [inactiveOwner.owner]);
  const closed = await fixture(0.004);
  await exec("UPDATE kitchen_sessions SET is_open=FALSE WHERE id=?", [
    closed.session,
  ]);
  const inactive = await fixture(0.005);
  await exec("UPDATE products SET active=FALSE WHERE id=?", [inactive.product]);
  const disabled = await fixture(0.006);
  await exec("UPDATE daily_menu SET enabled=FALSE WHERE id=?", [disabled.menu]);
  const soldOut = await fixture(0.007);
  await exec("UPDATE daily_menu SET stock=0 WHERE id=?", [soldOut.menu]);
  const expired = await fixture(0.008);
  await exec("UPDATE daily_menu SET cutoff_at=? WHERE id=?", [
    sqlDate(new Date(Date.now() - 1000)),
    expired.menu,
  ]);
  const overnight = await fixture(0.015, 1, yesterday);
  await fixture(0.009, 1, yesterday, "breakfast");
  await fixture(0.009, 1, serviceDate(new Date(Date.now() + 86400000)));
  const result = await nearbyMapChefs(point);
  const own = result.chefs.filter((c) => chefs.includes(c.id));
  assert.deepEqual(
    own.map((c) => c.id),
    [near.chef, far.chef, overnight.chef],
  );
  for (const chef of own) {
    assert.ok(Math.abs(chef.distance - haversine(point, chef)) < 0.0001);
    assert.equal(typeof chef.lat, "number");
    assert.ok(chef.distance <= chef.radiusKm);
  }
  const home = await feed(point, { limit: 60 });
  assert.equal(
    home.chefs.some((c) => c.id === far.chef),
    false,
  );
  assert.equal(
    result.chefs.some((c) => c.id === far.chef),
    true,
  );
  console.log(
    "PASS: radius, distance order, dedup, complete map beyond 60 dishes, all availability conditions and overnight menus",
  );
} finally {
  for (const [table, ids] of [
    ["daily_menu", menus],
    ["products", products],
    ["kitchen_sessions", sessions],
    ["chefs", chefs],
    ["users", owners],
  ] as const) {
    if (ids.length) await exec(`DELETE FROM ${table} WHERE id IN (?)`, [ids]);
  }
  await pool().end();
}
