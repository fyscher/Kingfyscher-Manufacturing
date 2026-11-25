const { test, describe } = require("node:test");
const assert = require("node:assert");

const { dailyCandles, weekStart, weeklyCandles } = require("../utils/candles");

describe("price chart candles", () => {
  test("a week starts on Monday, UTC, across month and year ends", () => {
    assert.strictEqual(weekStart("2026-11-23"), "2026-11-23", "a Monday is its own week");
    assert.strictEqual(weekStart("2026-11-29"), "2026-11-23", "Sunday ends the week");
    assert.strictEqual(weekStart("2026-11-25"), "2026-11-23");
    assert.strictEqual(weekStart("2026-12-02"), "2026-11-30", "across a month end");
    assert.strictEqual(weekStart("2027-01-01"), "2026-12-28", "across a year end");
  });

  test("weekly candles: first open, last close, extremes and the week's sale count", () => {
    const sales = [
      { ts: "2026-11-24T10:00:00Z", price: 100 }, // Tuesday
      { ts: "2026-11-23T09:00:00Z", price: 90 }, // Monday, out of order on purpose
      { ts: "2026-11-27T12:00:00Z", price: 150 },
      { ts: "2026-11-29T23:59:00Z", price: 120 }, // Sunday night: still this week
      { ts: "2026-11-30T00:01:00Z", price: 80 }, // Monday: next week
    ];
    const daily = dailyCandles(sales);
    assert.deepStrictEqual(daily.map(c => c.day), ["2026-11-23", "2026-11-24", "2026-11-27", "2026-11-29", "2026-11-30"]);
    assert.deepStrictEqual(weeklyCandles(daily), [
      { day: "2026-11-23", open: 90, high: 150, low: 90, close: 120, volume: 4 },
      { day: "2026-11-30", open: 80, high: 80, low: 80, close: 80, volume: 1 },
    ]);
  });

  test("no sales, no candles", () => {
    assert.deepStrictEqual(weeklyCandles(dailyCandles([])), []);
  });
});
