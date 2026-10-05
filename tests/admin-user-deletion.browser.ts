import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { authenticatedFixture } from "./authenticated-fixture";
import { exec, rows, pool } from "../src/lib/db";
import { ensureSessionRevocationSchema } from "../src/lib/session-revocations";

// Real local API/DB, fixture accounts only. No real users or external storage are changed.
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);
const suffix = "deletion-" + randomUUID();
const ids: string[] = [];
let browser: any;
try {
  await ensureSessionRevocationSchema();
  const admin = await authenticatedFixture(
    `admin-${suffix}@example.invalid`,
    "Admin " + suffix,
  );
  ids.push(admin.user.id);
  await exec("UPDATE users SET role='admin' WHERE id=?", [admin.user.id]);
  const customer = await authenticatedFixture(
    `user-${suffix}@example.invalid`,
    "User " + suffix,
  );
  ids.push(customer.user.id);
  browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const adminContext = await browser.newContext({
    viewport: { width: 1366, height: 900 },
  });
  const userContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  for (const [context, fixture] of [
    [adminContext, admin],
    [userContext, customer],
  ] as const) {
    await context.addCookies([
      {
        name: "tgbd_session",
        value: fixture.cookie.split("=")[1],
        url: base,
        httpOnly: true,
      },
    ]);
    await context.addInitScript(() =>
      localStorage.setItem(
        "tgbd-location",
        JSON.stringify({
          address: "Địa chỉ kiểm thử",
          lat: 10.78,
          lng: 106.68,
        }),
      ),
    );
    await context.route("**/api/analytics/events", (route: any) =>
      route.fulfill({ json: { ok: true } }),
    );
    // Prove the focus fallback works when WebSocket is unavailable.
    await context.route("**/api/realtime/ticket", (route: any) =>
      route.fulfill({
        status: 503,
        json: { error: "Fixture: realtime unavailable" },
      }),
    );
  }
  const adminPage = await adminContext.newPage();
  const userPage = await userContext.newPage();
  const errors: string[] = [];
  adminPage.on("pageerror", (error: Error) => errors.push(error.message));
  userPage.on("pageerror", (error: Error) => errors.push(error.message));
  await userPage.goto(base + "/me/settings");
  await userPage.getByLabel("Tên hiển thị").waitFor();
  await adminPage.goto(base + "/admin?tab=users&uq=" + suffix);
  const row = adminPage
    .getByRole("row")
    .filter({ hasText: customer.user.email });
  const ownRow = adminPage
    .getByRole("row")
    .filter({ hasText: admin.user.email });
  await row.getByRole("button", { name: "Xóa", exact: true }).waitFor();
  assert.equal(
    await ownRow.getByRole("button", { name: "Xóa", exact: true }).isDisabled(),
    true,
  );
  await row.getByRole("button", { name: "Xóa", exact: true }).click();
  const dialog = adminPage.getByRole("dialog", { name: "Xóa tài khoản này?" });
  await dialog.waitFor();
  assert.ok((await dialog.innerText()).includes(customer.user.email));
  await dialog
    .getByRole("button", { name: "Giữ tài khoản", exact: true })
    .click();
  assert.equal(
    (
      await rows<{ active: number }>("SELECT active FROM users WHERE id=?", [
        customer.user.id,
      ])
    )[0].active,
    1,
  );
  await row.getByRole("button", { name: "Xóa", exact: true }).click();
  const deletionResponse = adminPage.waitForResponse(
    (response: any) =>
      new URL(response.url()).pathname ===
        "/api/admin/users/" + customer.user.id &&
      response.request().method() === "DELETE",
  );
  await dialog
    .getByRole("button", { name: "Xác nhận xóa", exact: true })
    .click();
  const result = await deletionResponse;
  assert.equal(result.status(), 200, await result.text());
  await adminPage
    .getByText("Đã xóa tài khoản. Lịch sử đơn hàng được giữ lại.", {
      exact: true,
    })
    .waitFor();
  await row
    .locator(".users-account-status")
    .filter({ hasText: "Đã xóa" })
    .waitFor();
  assert.equal(
    await row.getByRole("button", { name: "Xóa", exact: true }).isDisabled(),
    true,
  );
  await userPage.evaluate(() => window.dispatchEvent(new Event("focus")));
  await userPage.waitForURL(base + "/");
  await userPage
    .getByText(
      "Tài khoản đã bị xóa. Vui lòng liên hệ hỗ trợ nếu cần tra cứu đơn hàng.",
      { exact: true },
    )
    .waitFor();
  assert.equal(await userPage.getByLabel("Tên hiển thị").count(), 0);
  const userState = await userContext.request.get(base + "/api/auth/me");
  assert.equal((await userState.json()).user, null);
  const adminState = await adminContext.request.get(base + "/api/auth/me");
  assert.equal((await adminState.json()).user.id, admin.user.id);
  assert.deepEqual(errors, []);
  await mkdir(".local/admin-user-deletion-check", { recursive: true });
  await adminPage.screenshot({
    path: ".local/admin-user-deletion-check/admin.png",
    fullPage: true,
  });
  await userPage.screenshot({
    path: ".local/admin-user-deletion-check/user.png",
    fullPage: true,
  });
  console.log(
    "PASS real browser: admin delete confirmation/cancel, self-delete disabled, deleted row disabled, user focus fallback notices deletion and returns to Home, admin session preserved, no JS errors.",
  );
} finally {
  await browser?.close();
  if (ids.length) {
    await exec("DELETE FROM audit_logs WHERE actor_id IN (?)", [ids]);
    await exec(
      "DELETE FROM realtime_outbox WHERE user_id IN (?) OR JSON_UNQUOTE(JSON_EXTRACT(payload,'$.entityId')) IN (?)",
      [ids, ids],
    );
    for (const table of [
      "sessions",
      "revoked_sessions",
      "user_account_details",
      "user_email_status",
    ])
      await exec(`DELETE FROM ${table} WHERE user_id IN (?)`, [ids]);
    await exec("DELETE FROM users WHERE id IN (?)", [ids]);
  }
  await pool().end();
}
