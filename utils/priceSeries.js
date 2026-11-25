// What the map asset price charts plot, built from sales ({ ts, price }, 1-UPX
// gifts already out). UTC throughout, oldest first: lightweight-charts wants
// time-ordered points.
//
// Each point is one day, week (Monday to Sunday, like TradingView's) or month:
// the median price with the middle half of sales (25th to 75th percentile) for
// the default view, open/high/low/close for the candles view, and the number of
// sales. Measured on Weeping Willow Tree (2026-11-24): the weekly median told the
// story (452, then ~310, then ~370) that candles buried under 4,500 UPX spikes,
// 2 UPX gifts and a week of 407 sales at ~31.

const DAY_MS = 86_400_000;
const GIFT_SHARE = 0.25; // same rule as the appraiser and the map asset browser
const OVERPAY_MULTIPLE = 4;
const REFERENCE_DAYS = 42; // each side: an outlier is judged against the ~13 weeks around it

/** The Monday (UTC) of the week a "YYYY-MM-DD" day falls in. */
function weekStart(day) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** The first day of the day's, week's or month's bucket. */
function bucketOf(day, interval) {
  if (interval === "week") return weekStart(day);
  if (interval === "month") return `${day.slice(0, 7)}-01`;
  return day;
}

function quantile(sorted, q) {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/**
 * Leave out sales under a quarter or over 4x of the median of the ~13 weeks
 * around them: gifts and dumps at a fraction of the price, and one-off trades
 * that move UPX between players. Judged against the weeks around each sale, not
 * one median for all history, so a design whose price really moved 4x over a
 * year keeps its old sales. Fewer than 3 sales to judge by: kept.
 */
function withoutOutliers(sales) {
  const byWeek = new Map();
  for (const s of sales) {
    const w = weekStart(s.ts.slice(0, 10));
    if (!byWeek.has(w)) byWeek.set(w, []);
    byWeek.get(w).push(s.price);
  }
  const weeks = [...byWeek.keys()].sort();
  const reference = new Map();
  let lo = 0;
  let hi = 0;
  for (const w of weeks) {
    const t = Date.parse(w);
    while (Date.parse(weeks[lo]) < t - REFERENCE_DAYS * DAY_MS) lo++;
    while (hi < weeks.length && Date.parse(weeks[hi]) <= t + REFERENCE_DAYS * DAY_MS) hi++;
    const prices = weeks.slice(lo, hi).flatMap(x => byWeek.get(x)).sort((a, b) => a - b);
    reference.set(w, prices.length >= 3 ? quantile(prices, 0.5) : null);
  }
  const kept = sales.filter(s => {
    const ref = reference.get(weekStart(s.ts.slice(0, 10)));
    return ref == null || (s.price >= ref * GIFT_SHARE && s.price <= ref * OVERPAY_MULTIPLE);
  });
  return { kept, excluded: sales.length - kept.length };
}

/** One point per day, week or month that had sales. */
function priceSeries(sales, interval) {
  const buckets = new Map();
  for (const s of [...sales].sort((a, b) => (a.ts < b.ts ? -1 : 1))) {
    const time = bucketOf(s.ts.slice(0, 10), interval);
    if (!buckets.has(time)) buckets.set(time, []);
    buckets.get(time).push(s.price);
  }
  return [...buckets].map(([time, prices]) => {
    const sorted = [...prices].sort((a, b) => a - b);
    const round = n => Math.round(n * 100) / 100;
    return {
      time, open: prices[0], high: sorted[sorted.length - 1], low: sorted[0], close: prices[prices.length - 1],
      median: round(quantile(sorted, 0.5)), p25: round(quantile(sorted, 0.25)), p75: round(quantile(sorted, 0.75)),
      volume: prices.length,
    };
  });
}

module.exports = { weekStart, bucketOf, quantile, withoutOutliers, priceSeries };
