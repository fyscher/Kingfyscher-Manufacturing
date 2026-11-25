/* Map asset price chart, shared by the dashboard's Price History and the asset
   page. The server builds the points (utils/priceSeries.js): one per day, week or
   month, with gifts, dumps and one-off trades already left out.
   - Median view (default): the typical price per period, the middle half of
     sales (25th to 75th percentile) as dashed lines, sales count underneath.
   - Candles view: open, high, low and close, sales count underneath.
   Both add the median's moving average (about a month: 7 days, 4 weeks or
   3 months) and how many were listed for sale, on the left axis. */
const PriceChart = (() => {
  const DAY_MS = 86_400_000;
  const INTERVALS = {
    day: { name: 'Daily', unit: 'day', average: '7-day average' },
    week: { name: 'Weekly (Monday to Sunday, UTC)', unit: 'week', average: '4-week average' },
    month: { name: 'Monthly', unit: 'month', average: '3-month average' },
  };
  const COLORS = { median: '#a78bfa', average: '#38bdf8', band: 'rgba(148, 163, 184, 0.55)', listed: '#f59e0b', volume: 'rgba(124, 58, 237, 0.35)' };

  /** The first day of the day's, week's or month's bucket (matches the server's bucketOf). */
  function bucketOf(day, interval) {
    if (interval === 'week') {
      const d = new Date(`${day}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      return d.toISOString().slice(0, 10);
    }
    if (interval === 'month') return `${day.slice(0, 7)}-01`;
    return day;
  }

  /** The points from the last `days` days (0 = all), in whole periods. */
  function within(points, interval, days) {
    if (!days) return points;
    const from = bucketOf(new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10), interval);
    return points.filter(p => p.time >= from);
  }

  /** "12 weeks", "1 month", ... */
  function count(n, interval) {
    return `${n} ${INTERVALS[interval].unit}${n === 1 ? '' : 's'}`;
  }

  /** What the chart shows, for the note under it (the legend names the lines). */
  function describe(view, interval) {
    const { name, average } = INTERVALS[interval];
    return view === 'candles'
      ? `${name} open, high, low and close of what sellers received, with the median's ${average}.`
      : `${name} median of what sellers received, its ${average}, and the middle half of sales between the dashed lines.`;
  }

  function legend(view, interval, hasListed) {
    const line = (color, label, dashed) => `<span style="display:inline-flex;align-items:center;gap:0.35rem"><span style="display:inline-block;width:18px;border-top:2px ${dashed ? 'dashed' : 'solid'} ${color}"></span>${label}</span>`;
    const items = [
      view === 'candles' ? line('#10b981', 'Candles') : line(COLORS.median, 'Median'),
      line(COLORS.average, INTERVALS[interval].average),
      view === 'candles' ? null : line(COLORS.band, 'Middle half', true),
      hasListed ? line(COLORS.listed, 'Listed for sale (left axis)') : null,
      `<span style="display:inline-flex;align-items:center;gap:0.35rem"><span style="display:inline-block;width:10px;height:10px;background:${COLORS.volume}"></span>Sales</span>`,
    ].filter(Boolean);
    const el = document.createElement('div');
    el.className = 'price-chart-legend';
    el.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.4rem 1rem;font-size:0.72rem;color:#94a3b8;margin-bottom:0.4rem';
    el.innerHTML = items.join('');
    return el;
  }

  /**
   * Draw `points` into `el`, with `listed` ({ time, listed }) on the left axis
   * when given; returns a handle whose remove() tears it down.
   */
  function draw(el, points, { view = 'median', interval = 'week', listed = [], height = 320, background = 'transparent' } = {}) {
    const hasListed = listed.length > 0;
    const key = legend(view, interval, hasListed);
    el.before(key);
    const chart = LightweightCharts.createChart(el, {
      width: el.clientWidth,
      height,
      layout: { background: { color: background }, textColor: '#94a3b8' },
      grid: { vertLines: { color: '#1c1c30' }, horzLines: { color: '#1c1c30' } },
      rightPriceScale: { borderColor: '#1c1c30', scaleMargins: { top: 0.08, bottom: 0.24 } },
      leftPriceScale: { visible: hasListed, borderColor: '#1c1c30', scaleMargins: { top: 0.08, bottom: 0 } },
      timeScale: { borderColor: '#1c1c30', timeVisible: false },
      crosshair: { mode: 1 },
    });
    const quiet = { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
    if (view === 'candles') {
      chart.addCandlestickSeries({
        upColor: '#10b981', downColor: '#ef4444', borderVisible: false, wickUpColor: '#10b981', wickDownColor: '#ef4444',
      }).setData(points.map(p => ({ time: p.time, open: p.open, high: p.high, low: p.low, close: p.close })));
    } else {
      const band = { ...quiet, color: COLORS.band, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed };
      chart.addLineSeries(band).setData(points.map(p => ({ time: p.time, value: p.p75 })));
      chart.addLineSeries(band).setData(points.map(p => ({ time: p.time, value: p.p25 })));
      chart.addLineSeries({ color: COLORS.median, lineWidth: 2, priceLineVisible: false })
        .setData(points.map(p => ({ time: p.time, value: p.median })));
    }
    chart.addLineSeries({ ...quiet, color: COLORS.average, lineWidth: 2 })
      .setData(points.filter(p => p.avg != null).map(p => ({ time: p.time, value: p.avg })));
    if (hasListed) {
      // A count never goes below zero: start the left axis there.
      const fromZero = range => (range ? { ...range, priceRange: { ...range.priceRange, minValue: 0 } } : range);
      chart.addLineSeries({
        color: COLORS.listed, lineWidth: 1, priceScaleId: 'left', priceLineVisible: false, priceFormat: { type: 'volume' },
        autoscaleInfoProvider: original => fromZero(original()),
      })
        .setData(listed.map(p => ({ time: p.time, value: p.listed })));
    }
    const volume = chart.addHistogramSeries({ ...quiet, priceScaleId: 'vol', color: COLORS.volume, priceFormat: { type: 'volume' } });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volume.setData(points.map(p => ({ time: p.time, value: p.volume })));
    chart.timeScale().fitContent();
    const obs = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
    obs.observe(el);
    return { remove() { obs.disconnect(); chart.remove(); key.remove(); } };
  }

  return { bucketOf, within, count, describe, draw };
})();
