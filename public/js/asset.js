/* One map asset design: the serials up for sale, how to find them, and what it sells for. */
const params = new URLSearchParams(location.search);
const category = params.get('c') || '';
const tokenName = params.get('t') || '';

function drawChart(candles) {
  const el = mk.$('as-chart');
  if (!candles.length || typeof LightweightCharts === 'undefined') {
    el.innerHTML = '<p class="market-note" style="padding:2rem 0;text-align:center">No sales in the history we have yet.</p>';
    el.style.minHeight = '0';
    return;
  }
  const chart = LightweightCharts.createChart(el, {
    height: 340,
    layout: { background: { color: 'transparent' }, textColor: '#94a3b8' },
    grid: { vertLines: { color: '#1c1c30' }, horzLines: { color: '#1c1c30' } },
    rightPriceScale: { borderColor: '#1c1c30' },
    timeScale: { borderColor: '#1c1c30' },
  });
  const series = chart.addCandlestickSeries({
    upColor: '#10b981', downColor: '#ef4444', borderVisible: false, wickUpColor: '#10b981', wickDownColor: '#ef4444',
  });
  series.setData(candles.map(c => ({ time: c.day, open: c.open, high: c.high, low: c.low, close: c.close })));
  const volume = chart.addHistogramSeries({ priceScaleId: 'vol', color: 'rgba(124, 58, 237, 0.35)', priceFormat: { type: 'volume' } });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
  volume.setData(candles.map(c => ({ time: c.day, value: c.volume })));
  chart.timeScale().fitContent();
  new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth })).observe(el);
}

function render(d) {
  const a = d.design;
  const name = a.display_name || a.token_name;
  document.title = `${name} · Map Asset · Kingfyscher Manufacturing`;
  mk.$('as-name').textContent = name;
  mk.$('as-sub').textContent = `${a.categoryLabel} · ${a.issued == null ? '?' : a.issued.toLocaleString()} issued of ${a.max_supply == null ? '?' : a.max_supply.toLocaleString()} max · design id ${a.category}/${a.token_name}`;
  mk.$('as-fresh').textContent = mk.freshness(d);
  // Send this asset to the dashboard's Price History chart.
  mk.$('as-dashboard').href = `/?asset=${encodeURIComponent(a.category)}/${encodeURIComponent(a.token_name)}`;
  mk.$('as-dashboard').classList.remove('hidden');

  if (a.image_url) {
    const art = mk.$('as-art');
    art.innerHTML = `<img src="${mk.esc(a.image_url)}" alt="" referrerpolicy="no-referrer">`;
    art.querySelector('img').addEventListener('error', () => art.classList.add('hidden'));
    art.classList.remove('hidden');
  }
  mk.$('as-stat-listed').textContent = d.listed.length.toLocaleString();
  mk.$('as-stat-floor').innerHTML = mk.price(a.floor_30d);
  mk.$('as-stat-last').innerHTML = a.last_price == null ? '-' : `${mk.price(a.last_price)}<span class="market-note" style="display:block;font-size:0.72rem">${mk.ago(a.last_sale_at)}</span>`;
  mk.$('as-stat-median').innerHTML = mk.price(a.median_30d);
  mk.$('as-stat-sales').textContent = `${a.sales_30d} (${a.sales_7d} this week)`;

  mk.$('as-find').innerHTML = d.listed.length
    ? `Open Upland's marketplace, go to <strong>${mk.esc(a.categoryLabel)}</strong>, and search for <strong>${mk.esc(name)}</strong>. `
      + `These serials are listed right now (the asking price shows in Upland). Sellers who listed most recently are first.`
    : `Nothing is listed right now. Search for <strong>${mk.esc(name)}</strong> under <strong>${mk.esc(a.categoryLabel)}</strong> in Upland's marketplace to watch for new listings.`;
  mk.$('as-find-serials').innerHTML = d.listed.slice(0, 60).map(i => `<span class="serial-chip">#${mk.esc(i.serial)}</span>`).join('')
    + (d.listed.length > 60 ? `<span class="market-note">and ${d.listed.length - 60} more</span>` : '');
  mk.$('as-copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(name);
      mk.$('as-copy').textContent = 'Copied';
    } catch {
      mk.$('as-copy').textContent = 'Copy failed';
    }
    setTimeout(() => { mk.$('as-copy').textContent = 'Copy name'; }, 1500);
  };

  mk.$('as-listed-count').textContent = d.listed.length;
  mk.$('as-listed-body').innerHTML = d.listed.length
    ? d.listed.map(i => `
      <tr>
        <td class="num">#${mk.esc(i.serial)}</td>
        <td title="${mk.esc(mk.when(i.since))}">${mk.ago(i.since)}</td>
        <td class="mono" style="font-size:0.78rem">${mk.esc(i.seller)}</td>
      </tr>`).join('')
    : '<tr class="table-empty"><td colspan="3">None listed right now</td></tr>';

  const historyStart = d.salesFrom ? mk.day(d.salesFrom) : 'our history starts';
  mk.$('as-other-count').textContent = d.otherEscrow.length;
  mk.$('as-other-body').innerHTML = d.otherEscrow.length
    ? d.otherEscrow.map(i => `
      <tr>
        <td class="num">#${mk.esc(i.serial)}</td>
        <td class="muted" style="font-size:0.78rem">${i.kind === 'bundle'
          ? `Placed on ${i.address ? `${mk.esc(i.address)}${i.city ? `, ${mk.esc(i.city)}` : ''}` : `property ${mk.esc(i.propertyId)}`}, which went up for sale ${mk.ago(i.since)}: it comes with the property, not on its own`
          : i.kind === 'other'
          ? `Moved in ${mk.ago(i.since)} by <span class="mono">${mk.esc(i.seller)}</span>, not as a listing`
          : `In escrow since before ${mk.esc(historyStart)}: an older listing, or held by Upland`}</td>
      </tr>`).join('')
    : '<tr class="table-empty"><td colspan="2">Nothing else in escrow</td></tr>';

  mk.$('as-sales-count').textContent = d.sales.length;
  mk.$('as-sales-body').innerHTML = d.sales.length
    ? d.sales.map(s => `
      <tr>
        <td title="${mk.esc(mk.when(s.ts))}">${mk.when(s.ts)}</td>
        <td class="num">${mk.price(s.price)}</td>
        <td class="num muted">${mk.price(s.buyerPaid)}</td>
        <td class="num">${s.serial == null ? '<span class="muted">-</span>' : `#${mk.esc(s.serial)}`}</td>
      </tr>`).join('')
    : '<tr class="table-empty"><td colspan="4">No sales in the history we have yet</td></tr>';

  mk.$('as-chart-days').textContent = `${d.candles.length} days`;
  mk.$('as-chart-note').textContent = d.salesFrom
    ? `Daily open, high, low and close of what sellers received, with the number of sales underneath (1 UPX giveaways left out). History starts ${mk.day(d.salesFrom)}.`
    : '';
  mk.$('as-content').classList.remove('hidden');
  drawChart(d.candles);
}

(async () => {
  try {
    if (!category || !tokenName) throw new Error('No map asset picked. Open one from the browser.');
    render(await mk.get(`/api/upland/market/asset/${encodeURIComponent(category)}/${encodeURIComponent(tokenName)}`));
  } catch (err) {
    mk.$('as-name').textContent = 'Map asset';
    mk.showError(mk.$('as-error'), err);
  }
})();
