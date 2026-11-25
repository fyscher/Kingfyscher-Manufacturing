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

// The moving average over the median covers about a month of trend whatever the
// period: 7 days, 4 weeks or 3 months (a 3-day average on daily points only
// traces the noise; Fyscher asked for one, 2026-11-24).
const AVERAGE_PERIODS = { day: 7, week: 4, month: 3 };

const round2 = n => Math.round(n * 100) / 100;

/** The first day of the period `n` periods after `time` (negative: before). */
function periodsAfter(time, interval, n) {
  const d = new Date(`${time}T00:00:00Z`);
  if (interval === "month") d.setUTCMonth(d.getUTCMonth() + n);
  else d.setUTCDate(d.getUTCDate() + n * (interval === "week" ? 7 : 1));
  return d.toISOString().slice(0, 10);
}

/**
 * One point per day, week or month that had sales. `avg` is the mean of the
 * medians over the last 7 days / 4 weeks / 3 months, once there's that much history.
 */
function priceSeries(sales, interval) {
  const buckets = new Map();
  for (const s of [...sales].sort((a, b) => (a.ts < b.ts ? -1 : 1))) {
    const time = bucketOf(s.ts.slice(0, 10), interval);
    if (!buckets.has(time)) buckets.set(time, []);
    buckets.get(time).push(s.price);
  }
  const points = [...buckets].map(([time, prices]) => {
    const sorted = [...prices].sort((a, b) => a - b);
    return {
      time, open: prices[0], high: sorted[sorted.length - 1], low: sorted[0], close: prices[prices.length - 1],
      median: round2(quantile(sorted, 0.5)), p25: round2(quantile(sorted, 0.25)), p75: round2(quantile(sorted, 0.75)),
      volume: prices.length,
    };
  });
  for (const p of points) {
    const from = periodsAfter(p.time, interval, 1 - AVERAGE_PERIODS[interval]);
    const window = points.filter(q => q.time >= from && q.time <= p.time);
    p.avg = points.length && from >= points[0].time ? round2(window.reduce((t, q) => t + q.median, 0) / window.length) : null;
  }
  return points;
}

/**
 * How many of a design's NFTs were listed for sale at the end of each period,
 * one point per period from its first escrow move to now. From its escrow moves
 * (oldest first): a listing puts one in; any move out (delisted, sold) or any
 * other move in (escrowed with a property listing) takes it out. Listings made
 * before the stored escrow history starts aren't seen, so the start can read low.
 */
function listedOverTime(events, interval, nowMs = Date.now()) {
  if (!events.length) return [];
  const listed = new Set();
  const points = [];
  const last = bucketOf(new Date(nowMs).toISOString().slice(0, 10), interval);
  let i = 0;
  for (let time = bucketOf(events[0].ts.slice(0, 10), interval); time <= last; time = periodsAfter(time, interval, 1)) {
    const next = periodsAfter(time, interval, 1);
    for (; i < events.length && events[i].ts < next; i++) {
      const e = events[i];
      if (e.direction === "in" && e.kind === "listing") listed.add(e.dgood_id);
      else listed.delete(e.dgood_id);
    }
    points.push({ time, listed: listed.size });
  }
  return points;
}

module.exports = { weekStart, bucketOf, quantile, withoutOutliers, priceSeries, listedOverTime, AVERAGE_PERIODS };
