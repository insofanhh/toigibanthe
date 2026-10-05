import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { exec, rows, pool, sqlDate } from "../src/lib/db";
import { defaultHomePopupSettings } from "../src/lib/home-popup-domain";
import { cutoffAt, serviceDate } from "../src/lib/domain";

assert.ok(
  ["localhost", "127.0.0.1"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  ),
  "Local database only",
);
const base = process.env.CHECK_URL || "http://127.0.0.1:3000";
assert.ok(
  ["localhost", "127.0.0.1"].includes(new URL(base).hostname),
  "Local API only",
);
const admin = randomUUID(),
  buyer = randomUUID(),
  chef = randomUUID(),
  product = randomUUID(),
  session = randomUUID(),
  menu = randomUUID();
const meal = "qa-" + randomUUID().slice(0, 8);
const adminToken = randomUUID(),
  buyerToken = randomUUID();
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const original = (
  await rows<{ value: unknown }>(
    "SELECT value FROM platform_settings WHERE id='home-popups'",
  )
)[0];
async function call(
  path: string,
  body?: unknown,
  who: "admin" | "user" | "guest" = "admin",
) {
  const response = await fetch(base + "/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      origin: base,
      ...(who !== "guest"
        ? {
            cookie: `tgbd_session=${who === "admin" ? adminToken : buyerToken}`,
          }
        : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}
try {
  for (const [id, role, token] of [
    [admin, "admin", adminToken],
    [buyer, "user", buyerToken],
  ]) {
    await exec(
      "INSERT INTO users (id,name,email,password_hash,role,created_at) VALUES (?,?,?,'unused',?,?)",
      [id, "Popup fixture", `${id}@local.test`, role, sqlDate()],
    );
    await exec("INSERT INTO sessions VALUES (?,?,?)", [
      hash(token),
      id,
      sqlDate(new Date(Date.now() + 3600000)),
    ]);
  }
  assert.equal(
    (await call("admin/home-popups", undefined, "guest")).status,
    401,
  );
  assert.equal(
    (await call("admin/home-popups", undefined, "user")).status,
    403,
  );
  assert.equal(
    (await call("admin/home-popups", defaultHomePopupSettings, "user")).status,
    403,
  );
  const draft = structuredClone(defaultHomePopupSettings);
  draft.install.enabled = true;
  draft.promotion = {
    enabled: true,
    title: "Sự kiện kiểm thử",
    description: "Nội dung fixture",
    imageUrl: "https://example.invalid/popup.webp",
    buttonText: "Xem ưu đãi",
    href: "/offers",
    startsAt: null,
    endsAt: null,
  };
  const saved = await call("admin/home-popups", draft);
  assert.equal(saved.status, 200);
  assert.notEqual(saved.data.settings.version, draft.version);
  assert.deepEqual(
    (await call("home-popups", undefined, "guest")).data.settings,
    saved.data.settings,
  );
  assert.deepEqual(
    (await call("admin/home-popups")).data.settings,
    saved.data.settings,
  );
  const invalid = {
    ...draft,
    promotion: { ...draft.promotion, href: "//evil.invalid" },
  };
  assert.equal((await call("admin/home-popups", invalid)).status, 400);
  assert.equal(
    (await call("admin/home-popups")).data.settings.version,
    saved.data.settings.version,
  );
  console.log(
    "PASS: admin authorization, persistent MySQL config, public feed, validation and no partial overwrite",
  );
  await exec("INSERT INTO meal_settings VALUES (?,?,?,?,?)", [
    meal,
    "Bữa kiểm thử",
    "10:00",
    0,
    99,
  ]);
  await exec(
    "INSERT INTO chefs (id,user_id,name,bio,address,area,lat,lng,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [
      chef,
      buyer,
      "Bếp fixture",
      "",
      "Test",
      "Test",
      21,
      105,
      "approved",
      sqlDate(),
    ],
  );
  await exec(
    "INSERT INTO products (id,chef_id,name,description,price,image_url,created_at) VALUES (?,?,?,?,?,?,?)",
    [product, chef, "Món fixture", "", 30000, "/icon.svg", sqlDate()],
  );
  await exec("INSERT INTO kitchen_sessions VALUES (?,?,?,?,?)", [
    session,
    chef,
    serviceDate(),
    true,
    sqlDate(),
  ]);
  await exec("INSERT INTO daily_menu VALUES (?,?,?,?,?,?,?,?,?)", [
    menu,
    session,
    product,
    meal,
    sqlDate(new Date(Date.now() + 48 * 3600000)),
    4,
    null,
    null,
    true,
  ]);
  assert.equal(
    (
      await call("admin/meals", {
        meals: [
          { id: meal, cutoff: "23:58", dayOffset: 1 },
          { id: "missing-qa", cutoff: "12:00", dayOffset: 0 },
        ],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await rows<any>("SELECT cutoff_time FROM meal_settings WHERE id=?", [
        meal,
      ])
    )[0].cutoff_time,
    "10:00",
  );
  assert.equal(
    (
      await call("admin/meals", {
        meals: [
          { id: meal, cutoff: "23:58", dayOffset: 1 },
          { id: meal, cutoff: "12:00", dayOffset: 0 },
        ],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call("admin/meals", {
        meals: [{ id: meal, cutoff: "23:58", dayOffset: 1 }],
      })
    ).status,
    200,
  );
  assert.equal(
    (await rows<any>("SELECT cutoff_at FROM daily_menu WHERE id=?", [menu]))[0]
      .cutoff_at,
    sqlDate(cutoffAt(serviceDate(), "23:58", 1)),
  );
  console.log(
    "PASS: bulk meal validation, atomic save and existing menu deadlines updated",
  );
} finally {
  if (original)
    await exec(
      "INSERT INTO platform_settings VALUES ('home-popups',?) ON DUPLICATE KEY UPDATE value=VALUES(value)",
      [
        typeof original.value === "string"
          ? original.value
          : JSON.stringify(original.value),
      ],
    );
  else await exec("DELETE FROM platform_settings WHERE id='home-popups'");
  for (const [table, id] of [
    ["daily_menu", menu],
    ["kitchen_sessions", session],
    ["products", product],
    ["chefs", chef],
    ["meal_settings", meal],
  ])
    await exec(`DELETE FROM ${table} WHERE id=?`, [id]);
  await exec("DELETE FROM audit_logs WHERE actor_id IN (?)", [[admin, buyer]]);
  await exec("DELETE FROM sessions WHERE user_id IN (?)", [[admin, buyer]]);
  await exec("DELETE FROM users WHERE id IN (?)", [[admin, buyer]]);
  await pool().end();
}
