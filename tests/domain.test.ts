import { test } from "node:test";
import assert from "node:assert/strict";
import {
  haversine,
  cutoffAt,
  effectivePrice,
  serviceDate,
} from "../src/lib/domain";
test("Bán kính địa lý phân biệt đúng phía trong và phía ngoài 5km", () => {
  const p = { lat: 10.7817, lng: 106.6809 };
  assert.ok(haversine(p, { lat: 10.7917, lng: 106.6809 }) < 5);
  assert.ok(haversine(p, { lat: 10.8417, lng: 106.6809 }) > 5);
  assert.equal(haversine(p, p), 0);
});
test("Quẩy đêm qua ngày giữ đúng hạn theo giờ Việt Nam", () => {
  assert.equal(
    cutoffAt("2026-10-03", "01:00", 1).toISOString(),
    "2026-10-03T18:00:00.000Z",
  );
  assert.equal(serviceDate(new Date("2026-10-03T17:30:00Z")), "2026-10-04");
});
test("Tắt chiến dịch hoặc giá sale không hợp lệ luôn trả giá gốc", () => {
  assert.equal(effectivePrice(50000, 40000, true), 40000);
  assert.equal(effectivePrice(50000, 40000, false), 50000);
  assert.equal(effectivePrice(50000, 60000, true), 50000);
});
