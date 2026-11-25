/* Map asset price chart, shared by the dashboard's Price History and the asset
   page. The server builds the points (utils/priceSeries.js): one per day, week or
   month, with gifts, dumps and one-off trades already left out.
   - Median view (default): the typical price per period, the middle half of
     sales (25th to 75th percentile) as dashed lines, sales count underneath.
   - Candles view: open, high, low and close, sales count underneath. */
const PriceChart = (() => {
  const DAY_MS = 86_400_000;
  const INTERVAL_NAMES = { day: ['Daily', 'day'], week: ['Weekly (Monday to Sunday, UTC)', 'week'], month: ['Monthly', 'month'] };

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
    return `${n} ${INTERVAL_NAMES[interval][1]}${n === 1 ? '' : 's'}`;
  }

  /** What the chart shows, for the note under it. */
  function describe(view, interval) {
    const name = INTERVAL_NAMES[interval][0];
    return view === 'candles'
      ? `${name} open, high, low and close of what sellers received, with the number of sales underneath.`
      : `${name} median of what sellers received, the middle half of sales between the dashed lines, and the number of sales underneath.`;
  }

  /** Draw `points` into `el`; returns a handle whose remove() tears it down. */
  function draw(el, points, { view = 'median', height = 320, background = 'transparent' } = {}) {
    const chart = LightweightCharts.createChart(el, {
      width: el.clientWidth,
      height,
      layout: { background: { color: background }, textColor: '#94a3b8' },
      grid: { vertLines: { color: '#1c1c30' }, horzLines: { color: '#1c1c30' } },
      rightPriceScale: { borderColor: '#1c1c30', scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { borderColor: '#1c1c30', timeVisible: false },
      crosshair: { mode: 1 },
    });
    if (view === 'candles') {
      chart.addCandlestickSeries({
        upColor: '#10b981', downColor: '#ef4444', borderVisible: false, wickUpColor: '#10b981', wickDownColor: '#ef4444',
      }).setData(points.map(p => ({ time: p.time, open: p.open, high: p.high, low: p.low, close: p.close })));
    } else {
      const band = {
        color: 'rgba(148, 163, 184, 0.55)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      };
      chart.addLineSeries(band).setData(points.map(p => ({ time: p.time, value: p.p75 })));
      chart.addLineSeries(band).setData(points.map(p => ({ time: p.time, value: p.p25 })));
      chart.addLineSeries({ color: '#a78bfa', lineWidth: 2, priceLineVisible: false })
        .setData(points.map(p => ({ time: p.time, value: p.median })));
    }
    const volume = chart.addHistogramSeries({
      priceScaleId: 'vol', color: 'rgba(124, 58, 237, 0.35)', priceFormat: { type: 'volume' },
      priceLineVisible: false, lastValueVisible: false,
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volume.setData(points.map(p => ({ time: p.time, value: p.volume })));
    chart.timeScale().fitContent();
    const obs = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
    obs.observe(el);
    return { remove() { obs.disconnect(); chart.remove(); } };
  }

  return { bucketOf, within, count, describe, draw };
})();
