'use strict';

/* ── API helpers ─────────────────────────────────────────── */
const api = {
  login(creds) {
    return fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creds),
    }).then(r => r.json());
  },

  getUsers(token) {
    return fetch('/api/users', {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => {
      if (r.status === 401) { logout(); throw new Error('Unauthorized'); }
      return r.json();
    });
  },

  createUser(data, token) {
    return fetch('/api/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    }).then(r => r.json());
  },

  deleteUser(id, token) {
    return fetch(`/api/users/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  },

  getCities() {
    return fetch('/api/upland/cities').then(r => r.json());
  },

  getRecentPurchases(limit = 15) {
    return fetch(`/api/upland/appchain/purchases?limit=${limit}`).then(r => r.json());
  },

  searchProperties(cityId, textSearch) {
    const params = new URLSearchParams({ cityId, currentPage: 1, pageSize: 20 });
    if (textSearch) params.set('textSearch', textSearch);
    return fetch(`/api/upland/properties?${params}`).then(r => r.json());
  },

  getPropertyPurchases(propertyId) {
    return fetch(`/api/upland/appchain/purchases/property/${propertyId}?limit=10`).then(r => r.json());
  },
};

/* ── State ───────────────────────────────────────────────── */
const state = {
  token:           localStorage.getItem('kfm_token'),
  username:        localStorage.getItem('kfm_username'),
  users:           [],
  pendingDeleteId: null,
};

/* ── DOM refs ────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const authView          = $('auth-view');
const appView           = $('app-view');
const loginForm         = $('login-form');
const authError         = $('auth-error');
const loginBtn          = $('login-btn');
const logoutBtn         = $('logout-btn');
const sidebarUsername   = $('sidebar-username');
const userAvatar        = $('user-avatar');
const statUsers         = $('stat-users');
const dashboardUsersBody= $('dashboard-users-body');
const usersTableBody    = $('users-table-body');
const usersCount        = $('users-count');
const createUserPanel   = $('create-user-panel');
const createUserForm    = $('create-user-form');
const createUserError   = $('create-user-error');
const toggleCreateUser  = $('toggle-create-user');
const cancelCreateUser  = $('cancel-create-user');
const modalOverlay      = $('modal-overlay');
const modalUsername     = $('modal-username');
const modalConfirm      = $('modal-confirm');
const modalCancel       = $('modal-cancel');
const manageUsersBtn    = $('manage-users-btn');

/* ── Helpers ─────────────────────────────────────────────── */
function showAlert(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideAlert(el) {
  el.classList.add('hidden');
}

function setLoading(btn, on) {
  const text    = btn.querySelector('.btn-text');
  const spinner = btn.querySelector('.btn-spinner');
  if (text)    text.classList.toggle('hidden', on);
  if (spinner) spinner.classList.toggle('hidden', !on);
  btn.disabled = on;
}

function avatar(name) {
  return (name || '?')[0].toUpperCase();
}

/* ── Navigation ──────────────────────────────────────────── */
function navigateTo(section) {
  document.querySelectorAll('.section').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

  const sec = $(`section-${section}`);
  const nav = document.querySelector(`.nav-item[data-section="${section}"]`);

  if (sec) sec.classList.add('active');
  if (nav) nav.classList.add('active');
}

/* ── Auth ────────────────────────────────────────────────── */
function showAuth() {
  authView.classList.remove('hidden');
  appView.classList.add('hidden');
}

function showApp() {
  authView.classList.add('hidden');
  appView.classList.remove('hidden');
  sidebarUsername.textContent = state.username || 'User';
  userAvatar.textContent      = avatar(state.username);
  loadUsers();
  navigateTo('dashboard');
}

function logout() {
  state.token    = null;
  state.username = null;
  localStorage.removeItem('kfm_token');
  localStorage.removeItem('kfm_username');
  showAuth();
}

/* ── Users ───────────────────────────────────────────────── */
async function loadUsers() {
  try {
    const result  = await api.getUsers(state.token);
    state.users   = Array.isArray(result) ? result : [];
  } catch {
    state.users   = [];
  }
  renderUsers();
}

function renderUsers() {
  const count = state.users.length;
  statUsers.textContent  = count;
  usersCount.textContent = count;

  if (count === 0) {
    const empty3 = '<tr class="table-empty"><td colspan="3">No users yet</td></tr>';
    const empty4 = '<tr class="table-empty"><td colspan="4">No users yet</td></tr>';
    dashboardUsersBody.innerHTML = empty3;
    usersTableBody.innerHTML     = empty4;
    return;
  }

  dashboardUsersBody.innerHTML = state.users.map(u => `
    <tr>
      <td>
        <div class="user-cell">
          <div class="user-cell-av">${avatar(u.username)}</div>
          ${escHtml(u.username)}
        </div>
      </td>
      <td>${escHtml(u.name || '—')}</td>
      <td><span class="id-chip">${escHtml(String(u.id || u._id))}</span></td>
    </tr>
  `).join('');

  usersTableBody.innerHTML = state.users.map(u => `
    <tr>
      <td>
        <div class="user-cell">
          <div class="user-cell-av">${avatar(u.username)}</div>
          ${escHtml(u.username)}
        </div>
      </td>
      <td>${escHtml(u.name || '—')}</td>
      <td><span class="id-chip">${escHtml(String(u.id || u._id))}</span></td>
      <td style="text-align:right">
        <button
          class="btn-icon-delete"
          data-del-id="${escHtml(String(u.id || u._id))}"
          data-del-name="${escHtml(u.username)}"
          title="Delete user"
        >
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/>
          </svg>
        </button>
      </td>
    </tr>
  `).join('');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── Event: login ────────────────────────────────────────── */
loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  hideAlert(authError);
  setLoading(loginBtn, true);

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  try {
    const result = await api.login({ username, password });
    if (result.token) {
      state.token    = result.token;
      state.username = result.username;
      localStorage.setItem('kfm_token',    result.token);
      localStorage.setItem('kfm_username', result.username);
      showApp();
    } else {
      showAlert(authError, result.error || 'Invalid credentials. Please try again.');
    }
  } catch {
    showAlert(authError, 'Connection error — please try again.');
  } finally {
    setLoading(loginBtn, false);
  }
});

/* ── Event: logout ───────────────────────────────────────── */
logoutBtn.addEventListener('click', logout);

/* ── Event: nav items ────────────────────────────────────── */
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    navigateTo(item.dataset.section);
  });
});

/* ── Event: manage users shortcut ────────────────────────── */
manageUsersBtn.addEventListener('click', () => navigateTo('users'));

/* ── Event: quick-action buttons ─────────────────────────── */
document.querySelectorAll('.quick-action').forEach(btn => {
  btn.addEventListener('click', () => navigateTo(btn.dataset.section));
});

/* ── Event: toggle create-user panel ─────────────────────── */
toggleCreateUser.addEventListener('click', () => {
  createUserPanel.classList.toggle('hidden');
});

cancelCreateUser.addEventListener('click', () => {
  createUserPanel.classList.add('hidden');
  createUserForm.reset();
  hideAlert(createUserError);
});

/* ── Event: create user ──────────────────────────────────── */
createUserForm.addEventListener('submit', async e => {
  e.preventDefault();
  hideAlert(createUserError);

  const username = document.getElementById('new-username').value.trim();
  const name     = document.getElementById('new-name').value.trim();
  const password = document.getElementById('new-password').value;

  try {
    const result = await api.createUser({ username, name, password }, state.token);
    if (result.error) {
      showAlert(createUserError, result.error);
      return;
    }
    createUserForm.reset();
    createUserPanel.classList.add('hidden');
    await loadUsers();
  } catch {
    showAlert(createUserError, 'Failed to create user. Please try again.');
  }
});

/* ── Event: delete button (delegated) ────────────────────── */
usersTableBody.addEventListener('click', e => {
  const btn = e.target.closest('[data-del-id]');
  if (!btn) return;
  state.pendingDeleteId     = btn.dataset.delId;
  modalUsername.textContent = btn.dataset.delName;
  modalOverlay.classList.remove('hidden');
});

/* ── Event: modal cancel ─────────────────────────────────── */
function closeModal() {
  modalOverlay.classList.add('hidden');
  state.pendingDeleteId = null;
}

modalCancel.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });

/* ── Event: modal confirm delete ─────────────────────────── */
modalConfirm.addEventListener('click', async () => {
  if (!state.pendingDeleteId) return;
  try {
    await api.deleteUser(state.pendingDeleteId, state.token);
    closeModal();
    await loadUsers();
  } catch {
    closeModal();
  }
});

/* ── Upland: DOM refs ────────────────────────────────────── */
const purchasesBody     = $('purchases-body');
const citiesBody        = $('cities-body');
const citiesCount       = $('cities-count');
const searchCity        = $('search-city');
const searchForm        = $('property-search-form');
const propertyResults   = $('property-results');
const refreshPurchases  = $('refresh-purchases');
const statUpland        = $('stat-upland');
const uplandStatusText  = $('upland-status-text');
const uplandStatusPill  = $('upland-status-pill');

/* ── Upland: Load cities ─────────────────────────────────── */
async function loadCities() {
  try {
    const data = await api.getCities();
    const cities = data.cities || [];
    state.cities = cities;
    citiesCount.textContent = cities.length;
    statUpland.textContent = 'Connected';
    uplandStatusText.textContent = 'API Connected';
    uplandStatusPill.className = 'status-pill status-pill--online';

    citiesBody.innerHTML = cities
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(c => `
        <tr>
          <td>${escHtml(c.name)}</td>
          <td>${escHtml(c.stateName || '')}</td>
          <td>${escHtml(c.countryName || '')}</td>
        </tr>
      `).join('');

    searchCity.innerHTML = '<option value="">Select a city</option>' +
      cities
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`)
        .join('');
  } catch {
    statUpland.textContent = 'Error';
    uplandStatusText.textContent = 'Connection Error';
    uplandStatusPill.className = 'status-pill status-pill--warning';
  }
}

/* ── Upland: Load recent purchases ───────────────────────── */
async function loadPurchases() {
  purchasesBody.innerHTML = '<tr class="table-empty"><td colspan="4">Loading...</td></tr>';
  try {
    const data = await api.getRecentPurchases(15);
    const purchases = data.purchases || [];
    if (purchases.length === 0) {
      purchasesBody.innerHTML = '<tr class="table-empty"><td colspan="4">No recent purchases</td></tr>';
      return;
    }
    purchasesBody.innerHTML = purchases.map(p => {
      const time = new Date(p.purchasedAt).toLocaleTimeString();
      const label = p.address || String(p.propertyId);
      return `
        <tr class="purchase-row" data-prop-id="${escHtml(String(p.propertyId))}" style="cursor:pointer" title="Click to view property history">
          <td><span class="id-chip" title="${escHtml(String(p.propertyId))}">${escHtml(label)}</span></td>
          <td data-city="">—</td>
          <td>${Number(p.priceUpx).toLocaleString()}</td>
          <td>${escHtml(time)}</td>
        </tr>
      `;
    }).join('');

    enrichPurchaseRows(purchases);
  } catch {
    purchasesBody.innerHTML = '<tr class="table-empty"><td colspan="4">Failed to load</td></tr>';
  }
}

async function enrichPurchaseRows(purchases) {
  const seen = new Set();
  for (const p of purchases) {
    const pid = String(p.propertyId);
    if (seen.has(pid)) continue;
    seen.add(pid);
    try {
      const prop = await fetch(`/api/upland/properties/${pid}`).then(r => r.json());
      document.querySelectorAll(`tr[data-prop-id="${pid}"]`).forEach(row => {
        const addrCell = row.children[0];
        const cityCell = row.querySelector('[data-city]');
        if (prop.address) addrCell.innerHTML = `<span class="id-chip" title="${escHtml(pid)}">${escHtml(prop.address)}</span>`;
        if (cityCell && prop.city?.name) cityCell.textContent = prop.city.name;
      });
    } catch { /* skip */ }
  }
}

/* ── Upland: Property search ─────────────────────────────── */
searchForm.addEventListener('submit', async e => {
  e.preventDefault();
  const cityId = searchCity.value;
  const text = $('search-address').value.trim();
  if (!cityId) return;

  propertyResults.innerHTML = '<p style="color:var(--text-muted)">Searching...</p>';
  try {
    const data = await api.searchProperties(cityId, text);
    const results = data.results || [];
    if (results.length === 0) {
      propertyResults.innerHTML = '<p style="color:var(--text-muted)">No properties found</p>';
      return;
    }
    propertyResults.innerHTML = `
      <table class="table">
        <thead>
          <tr><th>Address</th><th>Neighborhood</th><th>Status</th><th>Mint Price</th></tr>
        </thead>
        <tbody>
          ${results.map(p => `
            <tr class="purchase-row" data-prop-id="${p.id}" style="cursor:pointer" title="Click to view purchase history">
              <td>${escHtml(p.address)}</td>
              <td>${escHtml(p.neighborhood?.name || '—')}</td>
              <td><span class="badge badge--${p.status === 'Owned' ? 'muted' : p.status === 'For sale' ? 'warning' : 'muted'}">${escHtml(p.status)}</span></td>
              <td>${p.mintPrice ? Number(p.mintPrice).toLocaleString() + ' UPX' : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch {
    propertyResults.innerHTML = '<p style="color:var(--danger)">Search failed</p>';
  }
});

/* ── Upland: Click property row to view history ──────────── */
document.addEventListener('click', async e => {
  const row = e.target.closest('.purchase-row[data-prop-id]');
  if (!row) return;
  const propId = row.dataset.propId;

  propertyResults.innerHTML = `<p style="color:var(--text-muted)">Loading purchase history for property ${escHtml(propId)}...</p>`;
  navigateTo('upland');

  try {
    const data = await api.getPropertyPurchases(propId);
    const prop = data.property;
    const purchases = data.purchases || [];

    let html = '';
    if (prop) {
      html += `<div class="card" style="margin-bottom:1rem"><div class="card-body">
        <strong>${escHtml(prop.address)}</strong> &mdash; ${escHtml(prop.city?.name || '')}${prop.neighborhood?.name ? ', ' + escHtml(prop.neighborhood.name) : ''}
        <br>Status: <span class="badge badge--${prop.status === 'Owned' ? 'muted' : 'warning'}">${escHtml(prop.status)}</span>
        &nbsp; Mint: ${prop.mintPrice ? Number(prop.mintPrice).toLocaleString() + ' UPX' : '—'}
      </div></div>`;
    }

    if (purchases.length === 0) {
      html += '<p style="color:var(--text-muted)">No on-chain purchase records found in recent history</p>';
    } else {
      html += `<table class="table"><thead><tr><th>Buyer (EOS)</th><th>Price</th><th>Date</th></tr></thead><tbody>
        ${purchases.map(p => `
          <tr>
            <td><span class="id-chip">${escHtml(p.buyerEos)}</span></td>
            <td>${Number(p.priceUpx).toLocaleString()} UPX</td>
            <td>${new Date(p.purchasedAt).toLocaleString()}</td>
          </tr>
        `).join('')}
      </tbody></table>`;
    }
    propertyResults.innerHTML = html;
  } catch {
    propertyResults.innerHTML = '<p style="color:var(--danger)">Failed to load property history</p>';
  }
});

/* ── Upland: Refresh purchases ───────────────────────────── */
refreshPurchases.addEventListener('click', loadPurchases);

/* ── Structure Market: API ───────────────────────────────── */
const marketApi = {
  getTypes() {
    return fetch('/api/upland/structures/types').then(r => r.json());
  },
  getMarket(buildingTypeId, cityId) {
    const params = new URLSearchParams({ buildingTypeId });
    if (cityId) params.set('cityId', cityId);
    return fetch(`/api/upland/structures/market?${params}`).then(r => r.json());
  },
  getSalesHistory() {
    return fetch('/api/upland/structures/sales-history?limit=30').then(r => r.json());
  },
};

/* ── Structure Market: DOM refs ──────────────────────────── */
const marketTypeSelect    = $('market-type');
const marketCitySelect    = $('market-city');
const marketSearchForm    = $('market-search-form');
const marketSearchBtn     = $('market-search-btn');
const marketError         = $('market-error');
const marketResults       = $('market-results');
const marketEmptyState    = $('market-empty-state');
const metricFloor         = $('metric-floor');
const metricCount         = $('metric-count');
const metricLastSold      = $('metric-last-sold');
const metricLastSoldDate  = $('metric-last-sold-date');
const listingsBody        = $('listings-body');
const listingsCountBadge  = $('listings-count-badge');
const salesHistoryBody    = $('sales-history-body');
const salesCountBadge     = $('sales-count-badge');

/* ── Structure Market: Load types ────────────────────────── */
async function loadStructureTypes() {
  try {
    const data = await marketApi.getTypes();
    const types = data.types || [];
    if (types.length === 0) {
      marketTypeSelect.innerHTML = '<option value="">No periods available</option>';
      return;
    }
    marketTypeSelect.innerHTML = '<option value="">Select a time period</option>' +
      types.map(t => `<option value="${t.id}">${escHtml(t.name)}</option>`).join('');
  } catch {
    marketTypeSelect.innerHTML = '<option value="">Failed to load types</option>';
  }
}

/* ── Structure Market: Populate city filter ──────────────── */
function populateMarketCities(cities) {
  marketCitySelect.innerHTML = '<option value="">All cities</option>' +
    cities
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`)
      .join('');
}

/* ── Structure Market: Render listings ───────────────────── */
function renderListings(listings) {
  listingsCountBadge.textContent = listings.length;
  if (listings.length === 0) {
    listingsBody.innerHTML = '<tr class="table-empty"><td colspan="5">No listings found for this structure type</td></tr>';
    return;
  }
  listingsBody.innerHTML = listings.map((b, i) => {
    const name = b.address || b.buildingType?.name || b.type?.name || b.name || b.propertyId || '—';
    const city = b.city?.name || b.property?.city?.name || '—';
    const owner = b.owner || b.ownerEosId || b.sellerEosId || '—';
    const price = b.price != null ? Number(b.price).toLocaleString() : '—';
    const isFloor = i === 0;
    return `
      <tr>
        <td style="color:var(--text-muted);font-size:0.75rem">${i + 1}</td>
        <td style="font-weight:${isFloor ? '600' : '400'};color:${isFloor ? 'var(--text)' : 'var(--text-secondary)'}">${escHtml(name)}</td>
        <td>${escHtml(city)}</td>
        <td><span class="id-chip">${escHtml(String(owner))}</span></td>
        <td style="text-align:right;font-weight:${isFloor ? '700' : '500'};color:${isFloor ? 'var(--success)' : 'var(--text-secondary)'}">
          ${price !== '—' ? price + ' UPX' : '—'}
          ${isFloor ? ' <span class="badge badge--warning" style="margin-left:0.4rem;font-size:0.62rem">FLOOR</span>' : ''}
        </td>
      </tr>
    `;
  }).join('');
}

/* ── Structure Market: Render sales history ──────────────── */
function renderSalesHistory(sales) {
  salesCountBadge.textContent = sales.length;
  if (sales.length === 0) {
    salesHistoryBody.innerHTML = '<tr class="table-empty"><td colspan="5">No chain sales found</td></tr>';
    metricLastSold.textContent = '—';
    metricLastSoldDate.textContent = 'no chain data yet';
    return;
  }

  const first = sales[0];
  const lastPrice = first.priceUpx != null ? Number(first.priceUpx).toLocaleString() + ' UPX' : '?';
  const lastDate = first.timestamp ? new Date(first.timestamp).toLocaleDateString() : '—';
  metricLastSold.textContent = lastPrice;
  metricLastSoldDate.textContent = `last sold ${lastDate}`;

  salesHistoryBody.innerHTML = sales.map(s => {
    const price = s.priceUpx != null ? Number(s.priceUpx).toLocaleString() + ' UPX' : '—';
    const date = s.timestamp ? new Date(s.timestamp).toLocaleDateString() : '—';
    const trx = s.trxId ? s.trxId.slice(0, 10) + '…' : '—';
    const addr = s.address || s.propertyId || '—';
    const buyer = s.buyerEos || '—';
    return `
      <tr>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(s.address || '')}">
          <span class="id-chip">${escHtml(addr)}</span>
        </td>
        <td><span class="id-chip">${escHtml(buyer)}</span></td>
        <td style="text-align:right;font-weight:600;color:var(--primary-lt)">${price}</td>
        <td style="color:var(--text-muted);white-space:nowrap">${escHtml(date)}</td>
        <td><span class="id-chip" title="${escHtml(s.trxId || '')}">${escHtml(trx)}</span></td>
      </tr>
    `;
  }).join('');
}

/* ── Structure Market: Search handler ───────────────────────*/
marketSearchForm.addEventListener('submit', async e => {
  e.preventDefault();
  hideAlert(marketError);

  const buildingTypeId = marketTypeSelect.value;
  const cityId = marketCitySelect.value;

  if (!buildingTypeId) {
    showAlert(marketError, 'Please select a time period.');
    return;
  }

  setLoading(marketSearchBtn, true);
  marketResults.classList.add('hidden');
  marketEmptyState.classList.add('hidden');

  try {
    const [marketData, salesData] = await Promise.all([
      marketApi.getMarket(buildingTypeId, cityId),
      marketApi.getSalesHistory(),
    ]);

    const listings = marketData.listings || [];
    const floor = marketData.floor;
    const count = marketData.count || listings.length;
    const sales = salesData.sales || [];

    metricFloor.textContent  = floor != null ? Number(floor).toLocaleString() + ' UPX' : '—';
    metricCount.textContent  = count;

    renderListings(listings);
    renderSalesHistory(sales);

    marketResults.classList.remove('hidden');
  } catch (err) {
    showAlert(marketError, 'Search failed. ' + (err.message || ''));
    marketEmptyState.classList.remove('hidden');
  } finally {
    setLoading(marketSearchBtn, false);
  }
});

/* ── Building Browser: DOM refs ──────────────────────────── */
const buildingSearchForm  = $('building-search-form');
const buildingSearchBtn   = $('building-search-btn');
const buildingCitySelect  = $('building-city');
const buildingAddressInput= $('building-address');
const buildingError       = $('building-error');
const buildingResults     = $('building-results');
const buildingEmptyState  = $('building-empty-state');
const buildingResultsTitle= $('building-results-title');
const buildingCount       = $('building-count');
const buildingBody        = $('building-body');

/* ── Building Browser: Populate city filter ──────────────── */
function populateBuildingCities(cities) {
  buildingCitySelect.innerHTML = '<option value="">All cities</option>' +
    cities
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`)
      .join('');
}

/* ── Building Browser: Render results ────────────────────── */
function renderBuildingResults(properties, searchAddress) {
  buildingCount.textContent = properties.length;
  buildingResultsTitle.textContent = `Properties matching "${searchAddress}"`;

  if (properties.length === 0) {
    buildingBody.innerHTML = '<tr class="table-empty"><td colspan="6">No properties found for that address</td></tr>';
    return;
  }

  const forSale = properties.filter(p => p.currentPrice != null && p.status !== 'Owned');
  const lowestCurrent = forSale.length > 0
    ? Math.min(...forSale.map(p => p.currentPrice))
    : null;

  buildingBody.innerHTML = properties.map(p => {
    const neighborhood = p.neighborhood?.name || '—';
    const isForSale = p.status === 'For sale' || p.status === 'Unlocked';
    const currentPrice = p.currentPrice != null
      ? Number(p.currentPrice).toLocaleString() + ' UPX'
      : '—';
    const isFloorListing = isForSale && p.currentPrice === lowestCurrent;

    const lastSalePrice = p.lastSale?.priceUpx != null
      ? Number(p.lastSale.priceUpx).toLocaleString() + ' UPX'
      : '—';
    const lastSaleDate = p.lastSale?.timestamp
      ? new Date(p.lastSale.timestamp).toLocaleDateString()
      : '—';

    const statusClass = p.status === 'Owned' ? 'muted' : p.status === 'For sale' ? 'warning' : 'success';

    return `
      <tr>
        <td style="font-weight:500">${escHtml(p.address || '—')}</td>
        <td style="color:var(--text-secondary)">${escHtml(neighborhood)}</td>
        <td><span class="badge badge--${statusClass}">${escHtml(p.status || '—')}</span></td>
        <td style="text-align:right;font-weight:${isFloorListing ? '700' : '500'};color:${isFloorListing ? 'var(--success)' : isForSale ? 'var(--text)' : 'var(--text-muted)'}">
          ${currentPrice}
          ${isFloorListing ? ' <span class="badge badge--warning" style="margin-left:0.4rem;font-size:0.62rem">LOWEST</span>' : ''}
        </td>
        <td style="text-align:right;color:var(--primary-lt);font-weight:500">${lastSalePrice}</td>
        <td style="color:var(--text-muted);white-space:nowrap">${escHtml(lastSaleDate)}</td>
      </tr>
    `;
  }).join('');
}

/* ── Building Browser: Search handler ───────────────────── */
buildingSearchForm.addEventListener('submit', async e => {
  e.preventDefault();
  hideAlert(buildingError);

  const cityId = buildingCitySelect.value;
  const address = buildingAddressInput.value.trim();
  if (!address) return;

  setLoading(buildingSearchBtn, true);
  buildingResults.classList.add('hidden');
  buildingEmptyState.classList.add('hidden');

  try {
    const params = new URLSearchParams({ address });
    if (cityId) params.set('cityId', cityId);
    const data = await fetch(`/api/upland/structures/building-search?${params}`).then(r => r.json());
    const properties = data.properties || [];

    renderBuildingResults(properties, address);
    buildingResults.classList.remove('hidden');
  } catch (err) {
    showAlert(buildingError, 'Search failed. ' + (err.message || ''));
    buildingEmptyState.classList.remove('hidden');
  } finally {
    setLoading(buildingSearchBtn, false);
  }
});

/* ── Map Assets: API ─────────────────────────────────────── */
const mapAssetsApi = {
  getActivity(params = {}) {
    return fetch(`/api/upland/map-assets/activity?${new URLSearchParams(params)}`).then(r => r.json());
  },
  getListings(limit = 50) {
    return fetch(`/api/upland/map-assets/listings?limit=${limit}`).then(r => r.json());
  },
};

/* ── Map Assets: State / DOM refs ────────────────────────── */
const maState = { activeTab: 'mints', loading: false };
const maCategorySelect  = $('ma-category');
const maLimitSelect     = $('ma-limit');
const maRefreshBtn      = $('map-assets-refresh');
const maMintsCount      = $('ma-mints-count');
const maSalesCount      = $('ma-sales-count');
const maListingsCount   = $('ma-listings-count');
const maMintsBody       = $('ma-mints-body');
const maSalesBody       = $('ma-sales-body');
const maListingsBody    = $('ma-listings-body');

/* ── Map Assets: Helpers ─────────────────────────────────── */
const CATEGORY_LABELS = {
  outdoordecor: 'Outdoor Decor',
  structornmt:  'Struct. Ornament',
  uppie:        'Uppie',
  seeds:        'Seed',
  vehicle:      'Vehicle',
};

function maCategoryBadge(cat) {
  const label = CATEGORY_LABELS[cat] || (cat || '—');
  const color = cat === 'uppie' ? 'var(--primary-lt)' : cat === 'outdoordecor' ? 'var(--success)' : 'var(--text-muted)';
  return `<span style="font-size:0.72rem;padding:0.15rem 0.5rem;border-radius:4px;background:var(--bg-elevated);color:${color};white-space:nowrap">${escHtml(label)}</span>`;
}

function maRelDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1)  return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24)   return `${diffH}h ago`;
  return d.toLocaleDateString();
}

/* ── Map Assets: Render mints ────────────────────────────── */
function renderMaEvents(events) {
  const mints  = events.filter(e => e.type === 'mint');
  const sales  = events.filter(e => e.type === 'sale');
  maMintsCount.textContent = mints.length;
  maSalesCount.textContent = sales.length;

  maMintsBody.innerHTML = mints.length === 0
    ? '<tr class="table-empty"><td colspan="5">No mints found for this filter</td></tr>'
    : mints.map(e => `
      <tr>
        <td style="font-weight:500">${escHtml(e.displayName || `NFT #${e.nftId}`)}</td>
        <td>${maCategoryBadge(e.category)}</td>
        <td style="text-align:right;color:var(--text-muted)">${e.mint != null ? '#' + e.mint : '—'}</td>
        <td><span class="id-chip" title="${escHtml(e.buyerEos || '')}">${escHtml(e.uplandUser || e.buyerEos || '—')}</span></td>
        <td style="color:var(--text-muted);white-space:nowrap">${maRelDate(e.timestamp)}</td>
      </tr>
    `).join('');

  maSalesBody.innerHTML = sales.length === 0
    ? '<tr class="table-empty"><td colspan="6">No secondary sales found for this filter</td></tr>'
    : sales.map(e => {
      const price = e.priceUpx != null
        ? `<span style="font-weight:700;color:var(--primary-lt)">${Number(e.priceUpx).toLocaleString()} UPX</span>`
        : '<span style="color:var(--text-muted)">—</span>';
      return `
        <tr>
          <td style="font-weight:500">${escHtml(e.displayName || `NFT #${e.nftId}`)}</td>
          <td>${maCategoryBadge(e.category)}</td>
          <td style="text-align:right;color:var(--text-muted)">${e.mint != null ? '#' + e.mint : '—'}</td>
          <td style="text-align:right">${price}</td>
          <td><span class="id-chip" title="${escHtml(e.buyerEos || '')}">${escHtml(e.uplandUser || e.buyerEos || '—')}</span></td>
          <td style="color:var(--text-muted);white-space:nowrap">${maRelDate(e.timestamp)}</td>
        </tr>
      `;
    }).join('');
}

/* ── Map Assets: Render listings ─────────────────────────── */
function renderMaListings(listings) {
  maListingsCount.textContent = listings.length;

  maListingsBody.innerHTML = listings.length === 0
    ? '<tr class="table-empty"><td colspan="5">No active UPX listings found</td></tr>'
    : listings.map(l => {
      const price = l.priceUpx != null
        ? `<span style="font-weight:700;color:var(--primary-lt)">${Number(l.priceUpx).toLocaleString()} UPX</span>`
        : '—';
      const trx = l.trxId ? l.trxId.slice(0, 10) + '…' : '—';
      return `
        <tr>
          <td><span class="id-chip">${escHtml(l.nftId || '—')}</span></td>
          <td><span class="id-chip">${escHtml(l.sellerEos || '—')}</span></td>
          <td style="text-align:right">${price}</td>
          <td style="color:var(--text-muted);white-space:nowrap">${maRelDate(l.timestamp)}</td>
          <td><span class="id-chip" title="${escHtml(l.trxId || '')}">${escHtml(trx)}</span></td>
        </tr>
      `;
    }).join('');
}

/* ── Map Assets: Load data ───────────────────────────────── */
async function loadMapAssets() {
  if (maState.loading) return;
  maState.loading = true;

  const category = maCategorySelect.value;
  const limit    = maLimitSelect.value;

  maMintsBody.innerHTML    = '<tr class="table-empty"><td colspan="5">Loading…</td></tr>';
  maSalesBody.innerHTML    = '<tr class="table-empty"><td colspan="6">Loading…</td></tr>';
  maListingsBody.innerHTML = '<tr class="table-empty"><td colspan="5">Loading…</td></tr>';

  try {
    const params = { limit };
    if (category) params.category = category;

    const [actData, lstData] = await Promise.all([
      mapAssetsApi.getActivity(params),
      mapAssetsApi.getListings(limit),
    ]);

    renderMaEvents(actData.events || []);
    renderMaListings(lstData.listings || []);
  } catch {
    maMintsBody.innerHTML    = '<tr class="table-empty"><td colspan="5">Failed to load</td></tr>';
    maSalesBody.innerHTML    = '<tr class="table-empty"><td colspan="6">Failed to load</td></tr>';
    maListingsBody.innerHTML = '<tr class="table-empty"><td colspan="5">Failed to load</td></tr>';
  } finally {
    maState.loading = false;
  }
}

/* ── Map Assets: Tab switching ───────────────────────────── */
document.querySelectorAll('[data-ma-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.maTab;
    document.querySelectorAll('[data-ma-tab]').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.ma-tab-panel').forEach(p => p.classList.add('hidden'));
    const panel = $(`ma-tab-${tab}`);
    if (panel) panel.classList.remove('hidden');
    maState.activeTab = tab;
  });
});

/* ── Map Assets: Filter change / refresh ─────────────────── */
maCategorySelect.addEventListener('change', loadMapAssets);
maLimitSelect.addEventListener('change', loadMapAssets);
maRefreshBtn.addEventListener('click', loadMapAssets);

/* ── Map Assets: Load on nav ─────────────────────────────── */
document.querySelector('.nav-item[data-section="map-assets"]').addEventListener('click', () => {
  if (!maState.loaded) {
    maState.loaded = true;
    loadMapAssets();
  }
});

/* ── Init ────────────────────────────────────────────────── */
if (state.token) {
  showApp();
} else {
  showAuth();
}

loadCities().then(() => {
  if (state.cities) {
    populateMarketCities(state.cities);
    populateBuildingCities(state.cities);
  }
});
loadPurchases();
loadStructureTypes();
