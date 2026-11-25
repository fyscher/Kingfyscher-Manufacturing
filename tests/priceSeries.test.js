const { test, describe } = require("node:test");
const assert = require("node:assert");

const { weekStart, bucketOf, withoutOutliers, priceSeries } = require("../utils/priceSeries");

const DAY_MS = 86_400_000;
const at = (day, hour = 12) => `${day}T${String(hour).padStart(2, "0")}:00:00.000Z`;
const plus = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

describe("price chart series", () => {
  test("periods: weeks start on Monday (UTC), months on the 1st, across month and year ends", () => {
    assert.strictEqual(weekStart("2026-11-23"), "2026-11-23", "a Monday is its own week");
    assert.strictEqual(weekStart("2026-11-29"), "2026-11-23", "Sunday ends the week");
    assert.strictEqual(weekStart("2026-12-02"), "2026-11-30");
    assert.strictEqual(weekStart("2027-01-01"), "2026-12-28", "across a year end");
    assert.deepStrictEqual(["day", "week", "month"].map(i => bucketOf("2026-11-25", i)), ["2026-11-25", "2026-11-23", "2026-11-01"]);
  });

  test("a point: median and middle half for the default view, open/high/low/close for candles, and the count", () => {
    const sales = [
      { ts: at("2026-11-24"), price: 100 },
      { ts: at("2026-11-23"), price: 90 }, // out of order on purpose: it opens the week
      { ts: at("2026-11-27"), price: 150 },
      { ts: at("2026-11-29", 23), price: 120 }, // Sunday night: still this week
      { ts: at("2026-11-30", 0), price: 80 }, // Monday: next week, still November
    ];
    assert.deepStrictEqual(priceSeries(sales, "week"), [
      { time: "2026-11-23", open: 90, high: 150, low: 90, close: 120, median: 110, p25: 97.5, p75: 127.5, volume: 4 },
      { time: "2026-11-30", open: 80, high: 80, low: 80, close: 80, median: 80, p25: 80, p75: 80, volume: 1 },
    ]);
    assert.deepStrictEqual(priceSeries(sales, "month").map(p => [p.time, p.volume, p.median]), [["2026-11-01", 5, 100]]);
    assert.deepStrictEqual(priceSeries(sales, "day").map(p => p.time), ["2026-11-23", "2026-11-24", "2026-11-27", "2026-11-29", "2026-11-30"]);
    assert.deepStrictEqual(priceSeries([], "week"), []);
  });

  test("outliers: a dump at a tenth of the price and a one-off 4,500 trade are left out", () => {
    const sales = [];
    for (let d = 0; d < 56; d++) sales.push({ ts: at(plus("2026-09-07", d)), price: 350 + (d % 5) * 10 });
    for (let i = 0; i < 40; i++) sales.push({ ts: at("2026-09-23", i % 24), price: 31 }); // a bulk dump (Aug 17 on Weeping Willow Tree)
    sales.push({ ts: at("2026-10-19"), price: 4500 });
    const { kept, excluded } = withoutOutliers(sales);
    assert.strictEqual(excluded, 41);
    assert.ok(kept.every(s => s.price >= 350 && s.price <= 390));
  });

  test("outliers are judged against the weeks around each sale, so a real move over months is kept", () => {
    const sales = [];
    for (let d = 0; d < 120; d++) sales.push({ ts: at(plus("2025-06-02", d)), price: 100 }); // 100 for four months
    for (let d = 0; d < 120; d++) sales.push({ ts: at(plus("2026-03-02", d)), price: 600 }); // then 600 for four months
    assert.strictEqual(withoutOutliers(sales).excluded, 0, "one median for all history would drop one side");
  });

  test("with fewer than 3 sales around it, a sale is kept", () => {
    const sales = [{ ts: at("2026-01-05"), price: 10 }, { ts: at("2026-01-06"), price: 5000 }];
    assert.strictEqual(withoutOutliers(sales).excluded, 0);
  });
});
