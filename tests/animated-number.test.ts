import { test } from "node:test";
import assert from "node:assert/strict";
import { animatedNumber } from "../src/lib/animated-number";

test("Numeric interpolation preserves currency, grouping, precision and units", () => {
  for (const [text, value, middle, expected] of [
    ["55.000đ", 55000, 52500, "52.500đ"],
    ["1.234.567", 1234567, 1234000, "1.234.000"],
    ["12,5%", 12.5, 10.25, "10,3%"],
    ["12.50 km", 12.5, 10.25, "10.25 km"],
    ["−25.000đ", -25000, -20000, "−20.000đ"],
    ["+12,5%", 12.5, 0, "+0,0%"],
    ["9+", 9, 8, "8+"],
    ["Còn 5 suất", 5, 3.8, "Còn 4 suất"],
    ["0", 0, 0, "0"],
  ] as const) {
    const parsed = animatedNumber(text);
    assert.ok(parsed, text);
    assert.equal(parsed.value, value);
    assert.equal(parsed.format(middle), expected);
    assert.equal(parsed.format(value), text);
  }
});

test("Dates, account identifiers and missing data are never treated as metrics", () => {
  for (const text of [
    "—",
    "Mới",
    "",
    "0901234567",
    "00001234",
    "TGBD12345",
    "#12345",
    "2026-10-04",
    "10:30",
    "2 / 5",
    "1,2,3",
    "1.2.3",
    "1.2345678",
    "9007199254740992",
  ])
    assert.equal(animatedNumber(text), null, text);
});

test("Values interpolate across zero while retaining explicit signs", () => {
  assert.equal(animatedNumber("−2,5%")!.format(1.5), "1,5%");
  assert.equal(animatedNumber("+2,5%")!.format(-1.5), "-1,5%");
  assert.equal(animatedNumber(42)!.format(40.6), "41");
});
