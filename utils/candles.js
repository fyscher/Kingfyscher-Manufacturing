// OHLC candles for the map asset price charts, built from sales. UTC throughout,
// oldest first: lightweight-charts wants time-ordered bars.

/** Daily candles from sales ({ ts, price }): open, high, low, close and how many sold. */
function dailyCandles(sales) {
  const days = new Map();
  for (const s of [...sales].sort((a, b) => (a.ts < b.ts ? -1 : 1))) {
    const day = s.ts.slice(0, 10);
    const c = days.get(day);
    if (!c) days.set(day, { day, open: s.price, high: s.price, low: s.price, close: s.price, volume: 1 });
    else {
      c.high = Math.max(c.high, s.price);
      c.low = Math.min(c.low, s.price);
      c.close = s.price;
      c.volume++;
    }
  }
  return [...days.values()];
}

/** The Monday (UTC) of the week a "YYYY-MM-DD" day falls in. */
function weekStart(day) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * Weekly candles from daily ones (oldest first), Monday to Sunday like
 * TradingView's; `day` is the week's Monday. The current week is a candle in progress.
 */
function weeklyCandles(daily) {
  const weeks = new Map();
  for (const c of daily) {
    const day = weekStart(c.day);
    const w = weeks.get(day);
    if (!w) weeks.set(day, { ...c, day });
    else {
      w.high = Math.max(w.high, c.high);
      w.low = Math.min(w.low, c.low);
      w.close = c.close;
      w.volume += c.volume;
    }
  }
  return [...weeks.values()];
}

module.exports = { dailyCandles, weekStart, weeklyCandles };
