import assert from "node:assert/strict";
import test from "node:test";
import {
  analyticsFilter,
  previousFilter,
  dateBounds,
  csvDocument,
  regionCell,
  ratio,
  metricDelta,
} from "../src/lib/analytics-domain";
test("Vietnam date boundaries and equal-length prior periods", () => {
  const f = analyticsFilter(
    new URLSearchParams({ from: "2026-09-28", to: "2026-10-04" }),
    new Date("2026-10-04T01:00:00Z"),
  );
  assert.deepEqual(previousFilter(f), {
    ...f,
    from: "2026-09-21",
    to: "2026-09-27",
  });
  const b = dateBounds(f.from, f.to);
  assert.equal(b.start.toISOString(), "2026-09-27T17:00:00.000Z");
  assert.equal(b.end.toISOString(), "2026-10-04T17:00:00.000Z");
});
test("Reject impossible, future, reversed and excessive report windows", () => {
  const now = new Date("2026-10-04T01:00:00Z");
  for (const p of [
    { from: "2026-02-30", to: "2026-10-04" },
    { from: "2026-10-04", to: "2026-10-03" },
    { from: "2026-10-04", to: "2026-10-05" },
    { from: "2025-01-01", to: "2026-10-04" },
    { meal: "invalid" },
    { region: "'; DROP TABLE orders" },
  ])
    assert.throws(() =>
      analyticsFilter(
        new URLSearchParams(
          Object.entries(p).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        ),
        now,
      ),
    );
});
test("CSV quotes Unicode/newlines and neutralizes spreadsheet formulas", () => {
  const csv = csvDocument([
    ["Món, ngon", 'Bếp "An"', "=HYPERLINK(1)", "\n+SUM(1)", 12000],
  ]);
  assert.ok(csv.startsWith("\ufeff"));
  assert.ok(csv.includes('"Món, ngon"'));
  assert.ok(csv.includes('"Bếp ""An"""'));
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes("'\n+SUM"));
});
test("No denominator or prior baseline means unavailable, not invented growth", () => {
  assert.equal(ratio(0, 0), null);
  assert.equal(metricDelta(10, 0), null);
  assert.equal(metricDelta(12, 10), 20);
  assert.equal(regionCell(10.7817, 106.6809), "539:5334");
});
