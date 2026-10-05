// Browser regression for large phone photos. All API/storage writes are mocked.
// Requires Playwright; PLAYWRIGHT_MODULE can point to a bundled installation.
const assert = require("node:assert/strict");
const { randomFillSync, randomUUID } = require("node:crypto");
const { mkdir } = require("node:fs/promises");
const sharp = require("sharp");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));

(async () => {
  const width = 4032,
    height = 3024;
  const source = await sharp(randomFillSync(Buffer.alloc(width * height * 3)), {
    raw: { width, height, channels: 3 },
  })
    .jpeg({ quality: 92 })
    .toBuffer();
  assert.ok(source.length > 4.5 * 1024 * 1024);
  assert.ok(source.length < 20 * 1024 * 1024);
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    let uploaded = [],
      saved = null,
      rejectUpload = false;
    let user = {
      id: randomUUID(),
      name: "Avatar fixture",
      email: "avatar@example.invalid",
      phone: "",
      role: "user",
      active: 1,
      avatar_url: null,
      avatar_asset_id: null,
    };
    let displayedUrl = null;
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      let data = {};
      if (path === "/api/auth/me") data = { user, chef: null };
      else if (path === "/api/auth/google/config") data = { configured: false };
      else if (path === "/api/notifications")
        data = {
          notifications: [],
          unreadCounts: { total: 0, news: 0, order: 0 },
        };
      else if (path === "/api/push/config")
        data = { configured: false, publicKey: "" };
      else if (path === "/api/upload") {
        if (rejectUpload)
          return route.fulfill({
            status: 413,
            contentType: "text/plain",
            body: "FUNCTION_PAYLOAD_TOO_LARGE",
          });
        const body = request.postDataBuffer();
        const form = await new Request(request.url(), {
          method: "POST",
          headers: request.headers(),
          body,
        }).formData();
        const file = form.get("file");
        const bytes = Buffer.from(await file.arrayBuffer());
        const meta = await sharp(bytes).metadata();
        assert.ok(body.length < 1024 * 1024);
        assert.ok(["image/webp", "image/jpeg"].includes(file.type));
        assert.equal(meta.width, 512);
        assert.equal(meta.height, 512);
        assert.equal(form.get("purpose"), "avatar");
        uploaded.push({
          bytes: bytes.length,
          type: file.type,
          width: meta.width,
          height: meta.height,
        });
        displayedUrl = `data:${file.type};base64,${bytes.toString("base64")}`;
        data = { id: randomUUID(), url: displayedUrl };
      } else if (path === "/api/profile" && request.method() === "PATCH") {
        saved = request.postDataJSON();
        user = {
          ...user,
          name: saved.name,
          phone: saved.phone,
          avatar_asset_id: saved.avatarAssetId,
          avatar_url: displayedUrl,
        };
        data = { ok: true };
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    });
    await page.goto(base + "/me/settings");
    const picker = page.getByLabel("Chọn ảnh đại diện");
    await picker.setInputFiles({
      name: "IMG_phone.jpeg",
      mimeType: "image/jpeg",
      buffer: source,
    });
    await page.waitForFunction(
      () => !!document.querySelector(".account-avatar-preview img"),
    );
    assert.equal(uploaded.length, 1);
    assert.equal(uploaded[0].type, "image/webp");
    await page
      .getByRole("button", { name: "Lưu thông tin", exact: true })
      .click();
    await page.getByText("Đã lưu thông tin.", { exact: true }).waitFor();
    assert.ok(saved.avatarAssetId);
    const layout = await page.evaluate(() => ({
      width: innerWidth,
      contentWidth: document.documentElement.scrollWidth,
    }));
    assert.ok(
      layout.contentWidth <= layout.width,
      "Mobile layout must not overflow horizontally",
    );
    await mkdir(".local/avatar-upload-check", { recursive: true });
    await page.screenshot({
      path: ".local/avatar-upload-check/mobile.png",
      fullPage: true,
    });

    await picker.setInputFiles({
      name: "too-large.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.alloc(21 * 1024 * 1024),
    });
    await page
      .getByText("Ảnh gốc vượt quá 20 MB. Hãy chọn ảnh nhỏ hơn.", {
        exact: true,
      })
      .waitFor();
    assert.equal(uploaded.length, 1);
    await picker.setInputFiles({
      name: "broken.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("not an image"),
    });
    await page
      .getByText("Không đọc được ảnh. Hãy chọn ảnh JPG, PNG hoặc WebP khác.", {
        exact: true,
      })
      .waitFor();
    assert.equal(uploaded.length, 1);

    // Emulate the browser returning PNG instead of WebP (older Safari).
    await page.evaluate(() => {
      const original = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
        return original.call(
          this,
          callback,
          type === "image/webp" ? "image/png" : type,
          quality,
        );
      };
    });
    await picker.setInputFiles({
      name: "IMG_phone.jpeg",
      mimeType: "image/jpeg",
      buffer: source,
    });
    await page.waitForFunction(
      () =>
        document.querySelector(".file-picker").getAttribute("data-disabled") !==
        "true",
    );
    assert.equal(uploaded.length, 2);
    assert.equal(uploaded[1].type, "image/jpeg");

    rejectUpload = true;
    await picker.setInputFiles({
      name: "IMG_phone.jpeg",
      mimeType: "image/jpeg",
      buffer: source,
    });
    await page
      .getByText(
        "Tệp tải lên quá lớn. Hãy chọn tệp nhỏ hơn hoặc giảm dung lượng ảnh rồi thử lại.",
        { exact: true },
      )
      .waitFor();
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        pass: true,
        originalBytes: source.length,
        uploads: uploaded,
        checked: [
          "large phone photo resized before request",
          "512 square preview",
          "save avatar",
          "mobile layout",
          "oversize/corrupt rejected without upload",
          "JPEG fallback when WebP encoding unsupported",
          "host 413 has readable message",
        ],
      }),
    );
    await context.close();
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
