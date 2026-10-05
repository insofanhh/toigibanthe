import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultHomePopupSettings,
  popupDue,
  popupEligible,
  promotionActive,
  safePopupHref,
} from "../src/lib/home-popup-domain";
import { homePopupSchema } from "../src/lib/home-popups";

test("popup defaults are off; promotions honor start and exclusive end, install excludes installed/desktop", () => {
  const settings = structuredClone(defaultHomePopupSettings);
  const now = Date.now();
  assert.equal(popupEligible("install", settings, now, true), false);
  assert.equal(promotionActive(settings, now), false);
  settings.install.enabled = true;
  assert.equal(popupEligible("install", settings, now, false), false);
  assert.equal(popupEligible("install", settings, now, true), true);
  settings.promotion.enabled = true;
  settings.promotion.startsAt = new Date(now).toISOString();
  settings.promotion.endsAt = new Date(now + 1000).toISOString();
  assert.equal(promotionActive(settings, now - 1), false);
  assert.equal(promotionActive(settings, now), true);
  assert.equal(promotionActive(settings, now + 1000), false);
});
test("daily/weekly frequency has exact cooldown and corrupt storage does not block", () => {
  const now = Date.now();
  assert.equal(popupDue("session", String(now), now + 7 * 86400000), false);
  assert.equal(popupDue("daily", String(now), now + 86400000 - 1), false);
  assert.equal(popupDue("daily", String(now), now + 86400000), true);
  assert.equal(popupDue("weekly", String(now), now + 6 * 86400000), false);
  assert.equal(popupDue("weekly", String(now), now + 7 * 86400000), true);
  assert.equal(popupDue("daily", "invalid", now), true);
});
test("promotion settings reject missing art, invalid schedule and unsafe links", () => {
  const settings = structuredClone(defaultHomePopupSettings);
  settings.promotion.enabled = true;
  assert.equal(homePopupSchema.safeParse(settings).success, false);
  settings.promotion.title = "Ưu đãi hôm nay";
  settings.promotion.imageUrl = "https://example.invalid/banner.webp";
  assert.equal(homePopupSchema.safeParse(settings).success, true);
  settings.promotion.startsAt = "2026-10-05T12:00:00.000Z";
  settings.promotion.endsAt = "2026-10-05T11:00:00.000Z";
  assert.equal(homePopupSchema.safeParse(settings).success, false);
  for (const href of [
    "//evil.invalid",
    "/\\evil.invalid",
    "javascript:alert(1)",
    "https://evil.invalid",
    "/\n/evil.invalid",
    "/%5cevil.invalid",
  ])
    assert.equal(safePopupHref(href), false, href);
  assert.equal(safePopupHref("/offers?meal=breakfast"), true);
});
