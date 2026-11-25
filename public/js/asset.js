/* One map asset design: the serials up for sale, how to find them, and what it sells for. */
const params = new URLSearchParams(location.search);
const category = params.get('c') || '';
const tokenName = params.get('t') || '';

// The weekly median over all history by default (Fyscher, 2026-11-24); the
// buttons switch to candles, daily or monthly points, and a shorter period.
const chartView = { view: 'median', interval: 'week', range: 0, data: null, handle: null };

function drawChart(points) {
  const el = mk.$('as-chart');
  if (chartView.handle) {
    chartView.handle.remove();
    chartView.handle = null;
  }
  el.innerHTML = '';
  el.style.minHeight = '';
  if (!points.length || typeof LightweightCharts === 'undefined') {
    el.innerHTML = '<p class="market-note" style="padding:2rem 0;text-align:center">No sales in this period of the history we have.</p>';
    el.style.minHeight = '0';
    return;
  }
  chartView.handle = PriceChart.draw(el, points, { view: chartView.view, height: 340 });
}

function showChart() {
  const d = chartView.data;
  const { view, interval, range } = chartView;
  const points = PriceChart.within(d.series[interval], interval, range);
  for (const b of document.querySelectorAll('[data-chart]')) b.classList.toggle('active', String(chartView[b.dataset.chart]) === b.dataset.value);
  mk.$('as-chart-days').textContent = PriceChart.count(points.length, interval);
  const left = [
    d.giveaways ? `${d.giveaways} giveaway${d.giveaways === 1 ? '' : 's'} at 1 UPX` : null,
    d.outliers ? `${d.outliers} sale${d.outliers === 1 ? '' : 's'} far off the price around ${d.outliers === 1 ? 'it' : 'them'} (gifts, dumps, one-off trades)` : null,
  ].filter(Boolean);
  mk.$('as-chart-note').textContent = d.salesFrom
    ? `${PriceChart.describe(view, interval)}${left.length ? ` Left out: ${left.join(' and ')}.` : ''} History starts ${mk.day(d.salesFrom)}.`
    : '';
  drawChart(points);
}

for (const b of document.querySelectorAll('[data-chart]')) {
  b.addEventListener('click', () => {
    if (!chartView.data) return;
    const key = b.dataset.chart;
    chartView[key] = key === 'range' ? Number(b.dataset.value) : b.dataset.value;
    showChart();
  });
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

  mk.$('as-content').classList.remove('hidden');
  chartView.data = d;
  showChart();
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
