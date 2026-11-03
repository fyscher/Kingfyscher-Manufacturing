/* Map asset browser: one dense, sortable list of designs; each opens its own page. */
const state = {
  q: '', category: '', min: '', max: '', sort: 'listed', size: '100', listed: false, page: 1, total: 0,
};

// Filters live in the URL, so reloading, the back button and bookmarks keep them.
function readUrl() {
  const p = new URLSearchParams(location.search);
  Object.assign(state, {
    q: p.get('q') || '', category: p.get('category') || '', min: p.get('min') || '', max: p.get('max') || '',
    sort: p.get('sort') || 'listed', size: p.get('size') || '100', listed: p.get('listed') === '1',
    page: Math.max(Number(p.get('page')) || 1, 1),
  });
}

function writeUrl() {
  const p = new URLSearchParams();
  for (const k of ['q', 'category', 'min', 'max']) if (state[k]) p.set(k, state[k]);
  if (state.sort !== 'listed') p.set('sort', state.sort);
  if (state.size !== '100') p.set('size', state.size);
  if (state.listed) p.set('listed', '1');
  if (state.page > 1) p.set('page', String(state.page));
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

function syncForm() {
  mk.$('mk-q').value = state.q;
  mk.$('mk-category').value = state.category;
  mk.$('mk-min').value = state.min;
  mk.$('mk-max').value = state.max;
  mk.$('mk-sort').value = state.sort;
  mk.$('mk-size').value = state.size;
  mk.$('mk-listed').checked = state.listed;
  for (const th of document.querySelectorAll('th[data-sort]')) {
    const s = th.dataset.sort;
    th.classList.toggle('sorted', s === state.sort || (s === 'cheapest' && state.sort === 'priciest'));
  }
}

async function loadCategories() {
  const d = await mk.get('/api/upland/market/summary');
  const sel = mk.$('mk-category');
  sel.innerHTML = '<option value="">All categories</option>' + d.categories.map(c =>
    `<option value="${mk.esc(c.category)}">${mk.esc(c.label)} (${Number(c.designs).toLocaleString()})</option>`).join('');
  sel.value = state.category;
}

let loadSeq = 0;
async function load() {
  const seq = ++loadSeq;
  writeUrl();
  syncForm();
  const qs = new URLSearchParams({ sort: state.sort, page: String(state.page), pageSize: state.size });
  if (state.q) qs.set('q', state.q);
  if (state.category) qs.set('category', state.category);
  if (state.min) qs.set('minPrice', state.min);
  if (state.max) qs.set('maxPrice', state.max);
  if (state.listed) qs.set('listed', '1');
  try {
    const d = await mk.get(`/api/upland/market/assets?${qs}`);
    if (seq !== loadSeq) return; // a newer search already went out
    mk.$('mk-error').classList.add('hidden');
    render(d);
  } catch (err) {
    if (seq !== loadSeq) return;
    mk.showError(mk.$('mk-error'), err);
    mk.$('mk-body').innerHTML = '<tr class="table-empty"><td colspan="9">Nothing to show</td></tr>';
  }
}

function render(d) {
  state.total = d.total;
  const pages = Math.max(Math.ceil(d.total / d.pageSize), 1);
  const first = d.total ? (d.page - 1) * d.pageSize + 1 : 0;
  mk.$('mk-count').textContent = `${d.total.toLocaleString()} designs` + (d.total ? `, showing ${first.toLocaleString()}-${(first + d.assets.length - 1).toLocaleString()}` : '');
  mk.$('mk-fresh').textContent = mk.freshness(d);
  mk.$('mk-page').textContent = `Page ${d.page.toLocaleString()} of ${pages.toLocaleString()}`;
  mk.$('mk-prev').disabled = d.page <= 1;
  mk.$('mk-next').disabled = d.page >= pages;

  mk.$('mk-body').innerHTML = d.assets.length
    ? d.assets.map(a => `
      <tr>
        <td><a href="${mk.assetUrl(a)}" target="_blank" rel="noopener">${mk.esc(a.display_name || a.token_name)}</a></td>
        <td class="muted">${mk.esc(a.categoryLabel)}</td>
        <td class="num ${a.listed ? 'forsale' : 'muted'}">${a.listed ? Number(a.listed).toLocaleString() : '0'}</td>
        <td class="num">${mk.int(a.escrow)}</td>
        <td class="num" title="${mk.esc(mk.when(a.last_sale_at))}">${a.last_sale_at ? `${mk.price(a.last_price)} <span class="muted" style="font-size:0.72rem">${mk.ago(a.last_sale_at)}</span>` : '<span class="muted">-</span>'}</td>
        <td class="num">${mk.price(a.median_30d)}</td>
        <td class="num">${a.low_30d == null ? '<span class="muted">-</span>' : `${mk.price(a.low_30d)} - ${mk.price(a.high_30d)}`}</td>
        <td class="num">${a.sales_7d} / ${a.sales_30d}</td>
        <td class="num">${mk.int(a.issued)} / ${mk.int(a.max_supply)}</td>
      </tr>`).join('')
    : '<tr class="table-empty"><td colspan="9">No designs match these filters</td></tr>';
}

const refilter = () => { state.page = 1; load(); };
let searchTimer;
mk.$('mk-q').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.q = e.target.value.trim(); refilter(); }, 300);
});
mk.$('mk-filters').addEventListener('submit', e => e.preventDefault());
mk.$('mk-category').addEventListener('change', e => { state.category = e.target.value; refilter(); });
mk.$('mk-min').addEventListener('change', e => { state.min = e.target.value; refilter(); });
mk.$('mk-max').addEventListener('change', e => { state.max = e.target.value; refilter(); });
mk.$('mk-sort').addEventListener('change', e => { state.sort = e.target.value; refilter(); });
mk.$('mk-size').addEventListener('change', e => { state.size = e.target.value; refilter(); });
mk.$('mk-listed').addEventListener('change', e => { state.listed = e.target.checked; refilter(); });
mk.$('mk-prev').addEventListener('click', () => { if (state.page > 1) { state.page--; load(); window.scrollTo(0, 0); } });
mk.$('mk-next').addEventListener('click', () => { state.page++; load(); window.scrollTo(0, 0); });
for (const th of document.querySelectorAll('th[data-sort]')) {
  th.addEventListener('click', () => {
    const s = th.dataset.sort;
    // The price column flips between cheapest and priciest.
    state.sort = s === 'cheapest' && state.sort === 'cheapest' ? 'priciest' : s;
    refilter();
  });
}

readUrl();
syncForm();
loadCategories().catch(err => mk.showError(mk.$('mk-error'), err));
load();
