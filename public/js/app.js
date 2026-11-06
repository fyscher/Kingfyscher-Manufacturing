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

  uplandAuthInit(token) {
    return fetch('/api/upland/auth/init', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json());
  },

  updateEmail(email, token) {
    return fetch('/api/users/me', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ email }),
    }).then(r => r.json());
  },

  forgotUsername(name) {
    return fetch('/api/users/forgot-username', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then(r => r.json());
  },

  forgotPassword(email) {
    return fetch('/api/users/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }).then(r => r.json());
  },

  resetPassword(token, password) {
    return fetch('/api/users/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    }).then(r => r.json());
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
const forgotUsernameToggle = $('forgot-username-toggle');
const forgotUsernameForm   = $('forgot-username-form');
const forgotUsernameResult = $('forgot-username-result');
const forgotUsernameBtn    = $('forgot-username-btn');
const forgotPasswordToggle = $('forgot-password-toggle');
const forgotPasswordForm   = $('forgot-password-form');
const forgotPasswordResult = $('forgot-password-result');
const forgotPasswordBtn    = $('forgot-password-btn');
const resetPasswordView    = $('reset-password-view');
const resetPasswordForm    = $('reset-password-form');
const resetPasswordError   = $('reset-password-error');
const resetPasswordBtn     = $('reset-password-btn');
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
const uplandConnectCard     = $('upland-connect-card');
const uplandConnectStatus   = $('upland-connect-status');
const uplandConnectBtn      = $('upland-connect-btn');
const uplandConnectCodeBox  = $('upland-connect-code-box');
const uplandConnectCode     = $('upland-connect-code');
const uplandConnectCheckBtn = $('upland-connect-check-btn');
const uplandConnectNewCodeBtn = $('upland-connect-new-code-btn');
const uplandConnectShortcut = $('upland-connect-shortcut');
const accountEmailForm   = $('account-email-form');
const accountEmailInput  = $('account-email-input');
const accountEmailBtn    = $('account-email-btn');
const accountEmailResult = $('account-email-result');

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

function gongBadge(user) {
  return user && user.hasKingfyscherGong
    ? '<span class="badge badge--gong" title="Owns a Kingfyscher Gong">Gong</span>'
    : '';
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
  resetPasswordView.classList.add('hidden');
}

function showApp() {
  authView.classList.add('hidden');
  appView.classList.remove('hidden');
  resetPasswordView.classList.add('hidden');
  sidebarUsername.textContent = state.username || 'User';
  userAvatar.textContent      = avatar(state.username);
  loadUsers();
  navigateTo('dashboard');
  maOpenFromUrl();
}

function showResetPassword() {
  authView.classList.add('hidden');
  appView.classList.add('hidden');
  resetPasswordView.classList.remove('hidden');
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
    renderUplandConnectStatus(null);
    return;
  }

  dashboardUsersBody.innerHTML = state.users.map(u => `
    <tr>
      <td>
        <div class="user-cell">
          <div class="user-cell-av">${avatar(u.username)}</div>
          ${escHtml(u.username)}${gongBadge(u)}
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
          ${escHtml(u.username)}${gongBadge(u)}
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

  const me = state.users.find(u => u.username === state.username);
  sidebarUsername.innerHTML = `${escHtml(state.username || 'User')}${gongBadge(me)}`;
  renderUplandConnectStatus(me);
  if (me && me.email && document.activeElement !== accountEmailInput) {
    accountEmailInput.value = me.email;
  }
}

/* ── Account email ────────────────────────────────────────── */
accountEmailForm.addEventListener('submit', async e => {
  e.preventDefault();
  hideAlert(accountEmailResult);
  setLoading(accountEmailBtn, true);
  try {
    const result = await api.updateEmail(accountEmailInput.value.trim(), state.token);
    if (result.email) {
      accountEmailResult.className = 'alert';
      showAlert(accountEmailResult, 'Email saved.');
      await loadUsers();
    } else {
      accountEmailResult.className = 'alert alert--error';
      showAlert(accountEmailResult, result.error || 'Failed to save email');
    }
  } catch {
    accountEmailResult.className = 'alert alert--error';
    showAlert(accountEmailResult, 'Failed to save email');
  } finally {
    setLoading(accountEmailBtn, false);
  }
});

/* ── Upland account connect (OTP) ─────────────────────────── */
function renderUplandConnectStatus(me) {
  if (!me) {
    uplandConnectStatus.textContent = 'Loading…';
    return;
  }

  if (me.uplandUserId) {
    uplandConnectStatus.innerHTML = `Connected as <strong>${escHtml(me.uplandUserId)}</strong>${gongBadge(me)}`;
    uplandConnectBtn.classList.add('hidden');
    uplandConnectCodeBox.classList.add('hidden');
  } else {
    uplandConnectStatus.textContent = 'Not connected — link your Upland account to be eligible for perks tied to what you own in-game.';
    // Only show the primary button if no code is currently pending — a
    // second click here used to silently regenerate the code and strand
    // whatever code the user had already copied into Upland.
    if (uplandConnectCodeBox.classList.contains('hidden')) {
      uplandConnectBtn.classList.remove('hidden');
    }
  }
}

async function requestUplandCode(btn) {
  setLoading(btn, true);
  try {
    const result = await api.uplandAuthInit(state.token);
    if (result.code) {
      uplandConnectCode.textContent = result.code;
      uplandConnectCodeBox.classList.remove('hidden');
      uplandConnectBtn.classList.add('hidden');
    } else {
      showAlert(uplandConnectStatus, result.error || 'Failed to start connection');
    }
  } catch {
    uplandConnectStatus.textContent = 'Failed to start connection. Try again.';
  } finally {
    setLoading(btn, false);
  }
}

uplandConnectBtn.addEventListener('click', () => requestUplandCode(uplandConnectBtn));
uplandConnectNewCodeBtn.addEventListener('click', () => requestUplandCode(uplandConnectNewCodeBtn));

uplandConnectCheckBtn.addEventListener('click', async () => {
  setLoading(uplandConnectCheckBtn, true);
  const wasConnected = state.users.find(u => u.username === state.username)?.uplandUserId;
  await loadUsers();
  const nowConnected = state.users.find(u => u.username === state.username)?.uplandUserId;
  setLoading(uplandConnectCheckBtn, false);
  if (!wasConnected && !nowConnected) {
    uplandConnectCheckBtn.textContent = 'Still not connected — try again';
    setTimeout(() => { uplandConnectCheckBtn.textContent = "I've entered it — check connection"; }, 3000);
  }
});

uplandConnectShortcut.addEventListener('click', () => {
  uplandConnectCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

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

/* ── Event: forgot username ──────────────────────────────── */
forgotUsernameToggle.addEventListener('click', () => {
  forgotUsernameForm.classList.toggle('hidden');
  hideAlert(forgotUsernameResult);
});

forgotUsernameForm.addEventListener('submit', async e => {
  e.preventDefault();
  hideAlert(forgotUsernameResult);
  setLoading(forgotUsernameBtn, true);

  const name = document.getElementById('forgot-username-name').value.trim();

  try {
    const result = await api.forgotUsername(name);
    const usernames = result.usernames || [];
    forgotUsernameResult.classList.remove('alert--error');
    if (usernames.length) {
      showAlert(forgotUsernameResult, `Username${usernames.length > 1 ? 's' : ''}: ${usernames.join(', ')}`);
    } else {
      forgotUsernameResult.classList.add('alert--error');
      showAlert(forgotUsernameResult, 'No account found with that name.');
    }
  } catch {
    forgotUsernameResult.classList.add('alert--error');
    showAlert(forgotUsernameResult, 'Connection error — please try again.');
  } finally {
    setLoading(forgotUsernameBtn, false);
  }
});

/* ── Event: forgot password ──────────────────────────────── */
forgotPasswordToggle.addEventListener('click', () => {
  forgotPasswordForm.classList.toggle('hidden');
  hideAlert(forgotPasswordResult);
});

forgotPasswordForm.addEventListener('submit', async e => {
  e.preventDefault();
  hideAlert(forgotPasswordResult);
  setLoading(forgotPasswordBtn, true);

  const email = document.getElementById('forgot-password-email').value.trim();

  try {
    const result = await api.forgotPassword(email);
    forgotPasswordResult.classList.remove('alert--error');
    showAlert(forgotPasswordResult, result.message || 'If that email is registered, a reset link has been sent.');
    forgotPasswordForm.reset();
  } catch {
    forgotPasswordResult.classList.add('alert--error');
    showAlert(forgotPasswordResult, 'Connection error — please try again.');
  } finally {
    setLoading(forgotPasswordBtn, false);
  }
});

/* ── Event: reset password ───────────────────────────────── */
resetPasswordForm.addEventListener('submit', async e => {
  e.preventDefault();
  hideAlert(resetPasswordError);
  setLoading(resetPasswordBtn, true);

  const params   = new URLSearchParams(window.location.search);
  const token    = params.get('reset_token');
  const password = document.getElementById('reset-password-input').value;

  try {
    const result = await api.resetPassword(token, password);
    if (result.error) {
      showAlert(resetPasswordError, result.error);
      return;
    }
    window.history.replaceState({}, '', window.location.pathname);
    showAuth();
  } catch {
    showAlert(resetPasswordError, 'Connection error — please try again.');
  } finally {
    setLoading(resetPasswordBtn, false);
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
  const email    = document.getElementById('new-email').value.trim();
  const password = document.getElementById('new-password').value;

  try {
    const result = await api.createUser({ username, name, email, password }, state.token);
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

/* ── Upland: Cities (for the Building Browser) and the Dashboard's API status ── */
const statUpland = $('stat-upland');

async function loadCities() {
  try {
    const data = await api.getCities();
    state.cities = data.cities || [];
    statUpland.textContent = 'Connected';
  } catch {
    statUpland.textContent = 'Error';
  }
}

/* ── Building Browser: DOM refs ──────────────────────────── */
const buildingSearchForm  = $('building-search-form');
const buildingSearchBtn   = $('building-search-btn');
const buildingCitySelect  = $('building-city');
const buildingTypeSelect  = $('building-type');
const buildingForSale     = $('building-for-sale');
const buildingSingle      = $('building-single');
const buildingUnfinished  = $('building-unfinished');
const buildingNote        = $('building-note');
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

/* ── Building Browser: The building dropdown ──────────────
   Every building type standing in the chosen city, from the indexer's copy of
   the chain table that places buildings on properties. */
const fmtUpxShort = n => `${Number(n).toLocaleString()} UPX`;
let buildingTypesLoaded = false;

async function loadBuildingTypes() {
  hideAlert(buildingError);
  const keep = buildingTypeSelect.value;
  buildingTypeSelect.disabled = true;
  buildingTypeSelect.innerHTML = '<option value="">Loading buildings…</option>';
  try {
    const params = new URLSearchParams();
    if (buildingCitySelect.value) params.set('cityId', buildingCitySelect.value);
    const r = await fetch(`/api/upland/structures/building-types?${params}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Could not load buildings');
    // "for sale" counts properties; "from" is the cheapest one with just this building.
    buildingTypeSelect.innerHTML = '<option value="">Pick a building…</option>' + data.types.map(t =>
      `<option value="${escHtml(t.type)}">${escHtml(t.name)} · ${Number(t.buildings).toLocaleString()} built` +
      `${t.underConstruction ? ` (+${Number(t.underConstruction).toLocaleString()} under construction)` : ''}` +
      `${t.forSale ? `, ${Number(t.forSale).toLocaleString()} for sale${t.cheapestUpx ? ` from ${fmtUpxShort(t.cheapestUpx)}` : ''}` : ''}</option>`).join('');
    if (keep && data.types.some(t => t.type === keep)) buildingTypeSelect.value = keep;
    buildingNote.textContent = `${data.types.length} kinds of building` +
      (data.unidentified ? ` · ${Number(data.unidentified).toLocaleString()} buildings not identified yet` : '') +
      (data.asOf ? ` · up to date as of ${new Date(data.asOf).toLocaleString()}` : '');
    buildingTypesLoaded = true;
  } catch (err) {
    buildingTypeSelect.innerHTML = '<option value="">Buildings unavailable</option>';
    showAlert(buildingError, err.message);
  } finally {
    buildingTypeSelect.disabled = false;
  }
}

/* ── Building Browser: Render results ────────────────────── */
function renderBuildingResults(properties, title, total = properties.length) {
  buildingCount.textContent = total > properties.length
    ? `cheapest ${properties.length.toLocaleString()} of ${total.toLocaleString()}`
    : properties.length.toLocaleString();
  buildingResultsTitle.textContent = title;

  if (properties.length === 0) {
    buildingBody.innerHTML = `<tr class="table-empty"><td colspan="6">${buildingForSale.checked ? 'None of these are for sale right now' : 'No properties with this building'}</td></tr>`;
    return;
  }

  const cheapest = properties.find(p => p.priceUpx > 0)?.priceUpx;
  buildingBody.innerHTML = properties.map(p => {
    const asking = p.priceUpx > 0 ? fmtUpxShort(p.priceUpx)
      : p.priceUsd > 0 ? `$${Number(p.priceUsd).toLocaleString()}`
      : '<span style="color:var(--text-muted)">not for sale</span>';
    const isCheapest = p.priceUpx > 0 && p.priceUpx === cheapest;
    return `
      <tr>
        <td style="font-weight:500">${escHtml(p.address || `Property ${p.id}`)}${p.underConstruction
          ? `<br><span class="badge badge--warning" style="font-size:0.62rem">Under construction${p.finishesAround ? ` · done ~${escHtml(new Date(p.finishesAround).toLocaleDateString(undefined, { dateStyle: 'medium' }))}` : ''}</span>` : ''}</td>
        <td style="color:var(--text-secondary)">${escHtml(p.neighborhood || '-')}</td>
        <td style="color:var(--text-secondary)">${escHtml(p.city || '-')}</td>
        <td style="text-align:right;${p.buildingsOnProperty > 1 ? 'color:var(--accent-lt);font-weight:600' : 'color:var(--text-muted)'}" title="${p.buildingsOnProperty > 1 ? `A parcel with ${p.buildingsOnProperty} buildings: its price is for all of them` : 'Just this building'}">${p.buildingsOnProperty ?? '-'}</td>
        <td style="text-align:right">${p.mintPrice != null ? fmtUpxShort(p.mintPrice) : '-'}</td>
        <td style="text-align:right;font-weight:${isCheapest ? '700' : '500'};color:${isCheapest ? 'var(--success)' : 'var(--text)'}">
          ${asking}${isCheapest ? ' <span class="badge badge--warning" style="margin-left:0.4rem;font-size:0.62rem">LOWEST</span>' : ''}
        </td>
      </tr>`;
  }).join('');
}

/* ── Building Browser: the chosen building's latest sales, across every city ── */
const buildingSalesCard = $('building-sales');
const fmtSalePrice = s => (s.kind === 'usd' ? `$${Number(s.price).toLocaleString()}` : fmtUpxShort(s.price));
const medianOf = xs => { const v = [...xs].sort((a, b) => a - b); const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };

async function loadBuildingSales(type, name) {
  try {
    const r = await fetch(`/api/upland/structures/building-sales?${new URLSearchParams({ type, limit: '10' })}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Could not load sales');
    $('building-sales-title').textContent = `Last sales of ${name} across Upland`;
    $('building-sales-count').textContent = data.sales.length;
    const upx = data.sales.filter(s => s.kind === 'upx').map(s => s.price);
    const now = data.listedNow;
    $('building-sales-summary').innerHTML = data.sales.length
      ? [
          upx.length ? `Last ${upx.length} UPX sale${upx.length > 1 ? 's' : ''}: <strong style="color:var(--text)">median ${fmtUpxShort(Math.round(medianOf(upx)))}</strong>` +
            (upx.length > 1 ? `, from ${fmtUpxShort(Math.min(...upx))} to ${fmtUpxShort(Math.max(...upx))}` : '') : '',
          now.cheapestUpx ? `Cheapest listed now: <strong style="color:var(--success)">${fmtUpxShort(now.cheapestUpx)}</strong> (${Number(now.forSale).toLocaleString()} for sale across Upland)` : `${Number(now.forSale).toLocaleString()} for sale across Upland`,
        ].filter(Boolean).join(' · ')
      : 'No sales of properties with this building in the history we have.';
    $('building-sales-body').innerHTML = data.sales.map(s => `
      <tr>
        <td style="white-space:nowrap;color:var(--text-secondary)">${escHtml(new Date(s.ts).toLocaleDateString(undefined, { dateStyle: 'medium' }))}</td>
        <td style="font-weight:500">${escHtml(s.address || `Property ${s.id}`)}</td>
        <td style="color:var(--text-secondary)">${escHtml(s.city || '-')}</td>
        <td style="text-align:right;font-weight:600">${fmtSalePrice(s)}</td>
      </tr>`).join('');
    const left = data.leftOut || {};
    $('building-sales-note').textContent = 'Only sales of properties whose one building is this one, made after it was built. '
      + [left.parcels ? `${Number(left.parcels).toLocaleString()} sale${left.parcels > 1 ? 's' : ''} of multi-building parcels` : '',
         left.beforeBuilt ? `${Number(left.beforeBuilt).toLocaleString()} from before it was built` : '',
         left.unfinished ? `${Number(left.unfinished).toLocaleString()} of properties where it's still under construction` : '']
        .filter(Boolean).map((x, i, a) => (i === 0 ? 'Left out: ' : '') + x + (i === a.length - 1 ? '. ' : '; ')).join('')
      + '1 UPX transfers between a player\'s own accounts are left out too.'
      + (data.salesSince ? ` Sales history since ${new Date(data.salesSince).toLocaleDateString(undefined, { dateStyle: 'medium' })}.` : '');
    buildingSalesCard.classList.remove('hidden');
  } catch (err) {
    buildingSalesCard.classList.add('hidden');
    showAlert(buildingError, err.message);
  }
}

/* ── Building Browser: Show the properties with the chosen building ── */
async function searchBuildings() {
  hideAlert(buildingError);
  const type = buildingTypeSelect.value;
  if (!type) return;
  setLoading(buildingSearchBtn, true);
  buildingEmptyState.classList.add('hidden');
  try {
    const params = new URLSearchParams({ type });
    if (buildingCitySelect.value) params.set('cityId', buildingCitySelect.value);
    if (buildingForSale.checked) params.set('forSale', '1');
    if (buildingSingle.checked) params.set('single', '1');
    if (buildingUnfinished.checked) params.set('unfinished', '1');
    const r = await fetch(`/api/upland/structures/buildings?${params}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Search failed');
    const name = buildingTypeSelect.selectedOptions[0]?.textContent.split(' · ')[0] || type;
    loadBuildingSales(type, name); // the sales card fills in on its own
    const where = buildingCitySelect.value ? ` in ${buildingCitySelect.selectedOptions[0].textContent}` : '';
    renderBuildingResults(data.properties, `${name}${where}${buildingForSale.checked ? ', for sale' : ''}`, data.total);
    buildingResults.classList.remove('hidden');
  } catch (err) {
    showAlert(buildingError, err.message);
    buildingResults.classList.add('hidden');
    buildingEmptyState.classList.remove('hidden');
  } finally {
    setLoading(buildingSearchBtn, false);
  }
}

buildingSearchForm.addEventListener('submit', e => { e.preventDefault(); searchBuildings(); });
buildingTypeSelect.addEventListener('change', searchBuildings);
buildingForSale.addEventListener('change', searchBuildings);
buildingSingle.addEventListener('change', searchBuildings);
buildingUnfinished.addEventListener('change', searchBuildings);
buildingCitySelect.addEventListener('change', async () => { await loadBuildingTypes(); searchBuildings(); });
document.querySelector('.nav-item[data-section="buildings"]').addEventListener('click', () => {
  if (!buildingTypesLoaded) loadBuildingTypes();
});

/* ── Property Appraiser ──────────────────────────────────
   Land from comparable bare-land sales in the neighborhood and the ones
   bordering it, each building from what buyers paid over the land, map assets
   from their own resales (indexer/appraisal.js). */
const apQ       = $('ap-q');
const apSuggest = $('ap-suggest');
const apCity    = $('ap-city');
const apError   = $('ap-error');
const apState   = { id: null, picks: [], seq: 0, searchSeq: 0, assetSeq: 0, assetMatches: [] };
const apUpx  = n => (n == null ? '—' : `${Math.round(n).toLocaleString()} UPX`);
const apX    = n => (n == null ? '—' : `${n.toFixed(2)}x`);
const apPct  = n => `${Math.round(n * 100)}%`;
const apDay  = ts => new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const apRowStyle = 'padding:0.5rem 0.75rem;cursor:pointer;border-bottom:1px solid var(--border)';

async function apGet(url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${state.token}` } });
  if (r.status === 401) { logout(); throw new Error('Signed out'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

function populateAppraiserCities(cities) {
  apCity.innerHTML = '<option value="">All cities</option>' + [...cities]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
}

async function apSearch(openFirst = false) {
  const q = apQ.value.trim();
  if (q.length < 3) { apSuggest.classList.add('hidden'); return; }
  const seq = ++apState.searchSeq;
  try {
    const params = new URLSearchParams({ q });
    if (apCity.value) params.set('cityId', apCity.value);
    const { results } = await apGet(`/api/upland/appraiser/search?${params}`);
    if (seq !== apState.searchSeq) return;
    if (openFirst && results.length) { apSuggest.classList.add('hidden'); apOpen(results[0].id); return; }
    apSuggest.innerHTML = results.length
      ? results.map(p => `
        <div data-id="${escHtml(p.id)}" style="${apRowStyle}">
          <div style="font-size:0.84rem;color:var(--text);font-weight:500">${escHtml(p.address || p.id)}</div>
          <div style="font-size:0.72rem;color:var(--text-muted)">${escHtml(p.city || '')}${p.neighborhood ? ` · ${escHtml(p.neighborhood)}` : ''}${p.mint ? ` · mint ${apUpx(p.mint)}` : ''}</div>
        </div>`).join('')
      : '<div style="padding:0.6rem 0.75rem;font-size:0.8rem;color:var(--text-muted)">No address starts with that. Start with the house number, the way Upland writes it (131 FRANKLIN ST).</div>';
    apSuggest.classList.remove('hidden');
  } catch (err) {
    showAlert(apError, err.message);
  }
}

async function apOpen(id, { keepPicks = false } = {}) {
  if (!keepPicks) apState.picks = [];
  apState.id = id;
  hideAlert(apError);
  const seq = ++apState.seq;
  try {
    const params = new URLSearchParams();
    if (apState.picks.length) params.set('picks', apState.picks.map(p => `${p.category}/${p.token}*${p.count}`).join(','));
    const d = await apGet(`/api/upland/appraiser/property/${encodeURIComponent(id)}?${params}`);
    if (seq !== apState.seq) return;
    apRender(d);
  } catch (err) {
    showAlert(apError, err.message);
  }
}

const AP_SOURCES = {
  listing: () => 'Escrowed with its listing right now',
  'last sale': d => `Handed over at its last sale${d.lastSaleAt ? ` (${apDay(d.lastSaleAt)})` : ''}; may have been moved since, so not counted`,
  'added by you': () => 'Added by you',
};
const AP_RINGS = { own: 'this neighborhood', bordering: 'bordering', 'two rings out': 'two rings out', city: 'elsewhere in the city' };

function apRender(d) {
  const p = d.property;
  const t = d.totals;
  $('ap-title').textContent = p.address || `Property ${p.id}`;
  $('ap-sub').textContent = [p.city, p.neighborhood, p.mint ? `mint ${apUpx(p.mint)}` : null, p.status, `id ${p.id}`].filter(Boolean).join(' · ');

  $('ap-stat-total').textContent = t ? apUpx(t.value) : '—';
  $('ap-stat-total-range').textContent = t ? `typical ${apUpx(t.low)} to ${apUpx(t.high)}` : 'no land estimate';
  $('ap-stat-land').textContent = d.land ? apUpx(d.land.value) : '—';
  $('ap-stat-land-range').textContent = d.land ? `${apUpx(d.land.low)} to ${apUpx(d.land.high)}` : '';
  const finished = d.buildings.filter(b => !b.unfinished);
  const unfinished = d.buildings.length - finished.length;
  $('ap-stat-buildings').textContent = finished.length ? apUpx(finished.reduce((s, b) => s + (b.value || 0), 0)) : 'None';
  $('ap-stat-buildings-note').textContent = [
    finished.length ? `${finished.length} finished` : null,
    d.unvaluedBuildings ? `${d.unvaluedBuildings} not valued` : null,
    unfinished ? `${unfinished} under construction, not counted` : null,
  ].filter(Boolean).join(' · ');
  $('ap-stat-assets').textContent = t && t.assets ? apUpx(t.assets) : '—';
  $('ap-stat-with-assets').textContent = t && t.assets ? `with them: ${apUpx(t.withAssets)}` : 'none counted yet';
  const ask = d.listing;
  $('ap-stat-ask').textContent = ask ? (ask.upx ? apUpx(ask.upx) : ask.usd ? `$${ask.usd.toLocaleString()}` : '—') : 'Not listed';
  const askUpx = ask ? ask.upx || ask.usdInUpx : null;
  $('ap-stat-ask-note').textContent = ask && askUpx && t
    ? `${askUpx >= t.withAssets ? `${apPct(askUpx / t.withAssets - 1)} above` : `${apPct(1 - askUpx / t.withAssets)} below`} the appraisal${ask.usd && !ask.upx ? ` (at ~${d.stats.usd ? d.stats.usd.upxPerUsd.toLocaleString() : '?'} UPX per $1)` : ''}`
    : '';

  // Land
  const l = d.land;
  $('ap-comps-count').textContent = l ? l.comps : 0;
  $('ap-land-note').textContent = l
    ? `${l.comps} bare-land UPX sales from ${l.scope}, last ${l.days} days (this neighborhood counts double): land here sells for ${apX(l.ratio.p50)} its mint, middle half ${apX(l.ratio.p25)} to ${apX(l.ratio.p75)}.${l.thin ? ' Few sales to go on: treat it as rough.' : ''}`
    : p.mint ? 'No comparable bare-land sales nearby to go on.' : 'This property has no mint price in the catalog, so the land can\'t be valued.';
  $('ap-comps-body').innerHTML = l && l.recent.length
    ? l.recent.map(c => `
      <tr>
        <td>${apDay(c.ts)}</td>
        <td>${escHtml(c.address || c.propertyId)}</td>
        <td class="muted">${escHtml(c.ring === 'own' ? (p.neighborhood || 'this neighborhood') : (c.neighborhood_name ? `${c.neighborhood_name} (${AP_RINGS[c.ring] || c.ring})` : AP_RINGS[c.ring] || c.ring))}</td>
        <td class="num">${apUpx(c.price)}</td>
        <td class="num">${apUpx(c.mint)}</td>
        <td class="num">${apX(c.ratio)}</td>
      </tr>`).join('')
    : '<tr class="table-empty"><td colspan="6">No comparable sales</td></tr>';

  // Buildings
  $('ap-buildings-count').textContent = d.buildings.length;
  $('ap-buildings-note').textContent = [
    'A building never sells on its own, so its value is what buyers paid over the land: each sale of a property with just that building, minus the land estimate at the time, median over 180 days.',
    d.buildingsNote,
  ].filter(Boolean).join(' ');
  $('ap-buildings-body').innerHTML = d.buildings.length
    ? d.buildings.map(b => `
      <tr>
        <td>${escHtml(b.name)}</td>
        <td class="muted">${b.unfinished ? `Under construction${b.finishes ? `, finishes ~${apDay(b.finishes)}` : ''}` : b.builtAt ? `Built ${apDay(b.builtAt)}` : 'Finished'}</td>
        <td class="num">${b.value == null ? '<span class="muted">not valued</span>' : apUpx(b.value)}</td>
        <td class="num">${b.value == null ? '—' : `${apUpx(b.low)} to ${apUpx(b.high)}`}</td>
        <td class="muted" style="font-size:0.78rem">${b.value == null
          ? `Only ${b.sales} sale${b.sales === 1 ? '' : 's'} of this building: too few (needs ${d.minBuildingSales})`
          : `${b.sales.toLocaleString()} sales${b.band && b.band[0] != null ? `; median likely ${apUpx(b.band[0])} to ${apUpx(b.band[1])}` : ''}${b.pairs ? `; same property sold before and after building: ${apUpx(b.pairMedian)} (${b.pairs})` : ''}`}${b.toBuild
          ? `<br>To have one built: ${b.toBuild.basis === 'contracts' ? `${apUpx(b.toBuild.value)} (median of ${b.toBuild.n} contracts)` : `~${apUpx(b.toBuild.value)} (its Sparklet-hours at the going contract rate)`}`
          : ''}</td>
      </tr>`).join('')
    : '<tr class="table-empty"><td colspan="5">No buildings on this property</td></tr>';

  // Map assets
  const decor = d.stats.decor;
  $('ap-assets-count').textContent = d.assets.reduce((s, a) => s + a.count, 0);
  $('ap-assets-note').textContent = [
    'Upland only records what\'s placed on a property when it\'s listed (escrowed with the listing) or sold (handed to the buyer). Anything else, add below.',
    d.untrackedNfts ? `${d.untrackedNfts} other NFT${d.untrackedNfts === 1 ? '' : 's'} came with it that aren't map assets we track.` : null,
    decor && decor.medianWith && decor.medianWithout
      ? `Do buyers pay for them? Bare land sold with decorations went for ${apPct(Math.abs(decor.medianWith / decor.medianWithout - 1))} ${decor.medianWith >= decor.medianWithout ? 'more' : 'less'} than land without, against the same land estimate (median of ${decor.withNfts.toLocaleString()} vs ${decor.without.toLocaleString()} sales). So the total "with them" is what they'd fetch sold separately, not what they add to the property.`
      : null,
  ].filter(Boolean).join(' ');
  $('ap-assets-body').innerHTML = d.assets.length
    ? d.assets.map((a, i) => `
      <tr>
        <td>${escHtml(a.name)}</td>
        <td class="muted" style="font-size:0.78rem">${escHtml((AP_SOURCES[a.source] || (() => a.source))(d))}</td>
        <td class="num">${a.count}</td>
        <td class="num">${apUpx(a.value)}</td>
        <td class="num">${a.value == null ? '—' : apUpx(a.value * a.count)}</td>
        <td class="muted" style="font-size:0.78rem">${a.sales ? `${a.sales} sales, ${a.windowDays ? `${a.windowDays} days` : 'all stored history'}${a.thin ? ' (thin)' : ''}` : 'No real sales stored'}</td>
        <td>${a.source === 'added by you' ? `<button class="btn btn--ghost btn--sm" data-ap-remove="${i}">Remove</button>` : ''}</td>
      </tr>`).join('')
    : '<tr class="table-empty"><td colspan="7">None recorded</td></tr>';
  apState.rendered = d.assets;

  // History
  $('ap-history-count').textContent = d.history.length;
  $('ap-history-body').innerHTML = d.history.length
    ? d.history.map(h => `
      <tr>
        <td>${apDay(h.ts)}</td>
        <td class="num">${h.currency === 'UPX' ? apUpx(h.price) : `$${Number(h.price).toLocaleString()}`}</td>
        <td class="num">${h.nfts || '<span class="muted">0</span>'}</td>
      </tr>`).join('')
    : '<tr class="table-empty"><td colspan="3">No sales since the appchain started (April 2025)</td></tr>';

  // Trust
  const bt = d.stats.backtest;
  $('ap-method').innerHTML = [
    bt && bt.land.n ? `Tested on the last ${bt.days} days of sales, each appraised only from sales before it: <strong>land alone was off by a median ${apPct(bt.land.medianError)}</strong> (${bt.land.n.toLocaleString()} sales), within 25% on ${apPct(bt.land.within25)} of them, and the real price fell inside the low-to-high range ${apPct(bt.land.insideRange)} of the time (a middle-half range should catch about half).` : null,
    bt && bt.withBuilding.n ? `Land plus one building: off by a median ${apPct(bt.withBuilding.medianError)} (${bt.withBuilding.n.toLocaleString()} sales).` : null,
    d.stats.usd ? `USD prices are a separate market: the property market prices UPX at about ${d.stats.usd.upxPerUsd.toLocaleString()} per $1 (bare land, 90 days), not the store's 1,000, and USD asks are converted at that rate.` : null,
    'A sale under 1 UPX is a transfer, not a price, and is left out everywhere.',
  ].filter(Boolean).join('<br>');
  $('ap-results').classList.remove('hidden');
}

// Map assets the user says are on it.
const apAssetQ = $('ap-asset-q');
const apAssetSuggest = $('ap-asset-suggest');
let apAssetTimer;
apAssetQ.addEventListener('input', () => {
  clearTimeout(apAssetTimer);
  apAssetTimer = setTimeout(async () => {
    const q = apAssetQ.value.trim();
    if (q.length < 2) { apAssetSuggest.classList.add('hidden'); return; }
    const seq = ++apState.assetSeq;
    try {
      const list = await maFindAssets(q);
      if (seq !== apState.assetSeq) return;
      apState.assetMatches = list;
      apAssetSuggest.innerHTML = list.length
        ? list.map((a, i) => `
          <div data-index="${i}" style="${apRowStyle}">
            <div style="font-size:0.84rem;color:var(--text);font-weight:500">${escHtml(a.display_name || a.token_name)}</div>
            <div style="font-size:0.72rem;color:var(--text-muted)">${escHtml(a.categoryLabel)} · ${a.sales_30d} sold in 30 days</div>
          </div>`).join('')
        : '<div style="padding:0.6rem 0.75rem;font-size:0.8rem;color:var(--text-muted)">No map asset with that name</div>';
      apAssetSuggest.classList.remove('hidden');
    } catch (err) {
      showAlert(apError, err.message);
    }
  }, 250);
});
apAssetSuggest.addEventListener('click', e => {
  const row = e.target.closest('[data-index]');
  if (!row || !apState.id) return;
  const a = apState.assetMatches[Number(row.dataset.index)];
  const have = apState.picks.find(p => p.category === a.category && p.token === a.token_name);
  if (have) have.count++;
  else apState.picks.push({ category: a.category, token: a.token_name, count: 1 });
  apAssetQ.value = '';
  apAssetSuggest.classList.add('hidden');
  apOpen(apState.id, { keepPicks: true });
});
$('ap-assets-body').addEventListener('click', e => {
  const btn = e.target.closest('[data-ap-remove]');
  if (!btn) return;
  const a = apState.rendered[Number(btn.dataset.apRemove)];
  apState.picks = apState.picks.filter(p => !(p.category === a.category && p.token === a.token));
  apOpen(apState.id, { keepPicks: true });
});

let apTimer;
apQ.addEventListener('input', () => { clearTimeout(apTimer); apTimer = setTimeout(() => apSearch(), 250); });
apCity.addEventListener('change', () => apSearch());
$('ap-form').addEventListener('submit', e => { e.preventDefault(); apSearch(true); });
apSuggest.addEventListener('click', e => {
  const row = e.target.closest('[data-id]');
  if (!row) return;
  apSuggest.classList.add('hidden');
  apOpen(row.dataset.id);
});
document.addEventListener('click', e => {
  if (!e.target.closest('#ap-suggest') && e.target !== apQ) apSuggest.classList.add('hidden');
  if (!e.target.closest('#ap-asset-suggest') && e.target !== apAssetQ) apAssetSuggest.classList.add('hidden');
});

/* ── Build Calculator ────────────────────────────────────
   Construction progress is Sparklet-hours: each staked Sparklet adds one an
   hour, so time = hours needed / stake (checked against the chain's own
   expected finish). The stake comes back when the build is done. */
const bcState = { types: null, stats: null };
// Mirrors buildCost in indexer/appraisal.js: the median contract with 3+ in 90 days, else hours at the going rate.
function bcBuildCost(t) {
  if (t.contractN >= 3) return `${apUpx(t.contractMedian)} <span class="muted">(${t.contractN})</span>`;
  const rate = bcState.stats && bcState.stats.contracts;
  return rate ? `~${apUpx((t.hoursNeeded * rate.p50) / 1e6)} <span class="muted">(rate)</span>` : '<span class="muted">-</span>';
}
const bcDur = h => (h < 48 ? `${Math.round(h)} h` : h < 24 * 365 ? `${(h / 24).toFixed(h < 240 ? 1 : 0)} days` : `${(h / 24 / 365).toFixed(1)} years`);

async function loadBuildRules() {
  hideAlert($('bc-error'));
  try {
    const d = await apGet('/api/upland/appraiser/build-rules');
    bcState.types = d.types;
    bcState.stats = d.stats;
    bcRender();
  } catch (err) {
    showAlert($('bc-error'), err.message);
    $('bc-body').innerHTML = '<tr class="table-empty"><td colspan="8">Nothing to show</td></tr>';
  }
}

function bcRender() {
  if (!bcState.types) return;
  const raw = Number($('bc-amount').value);
  const stake = raw > 0 ? raw * ($('bc-unit').value === 'spark' ? 1000 : 1) : null;
  const f = $('bc-filter').value.trim().toLowerCase();
  const rows = bcState.types.filter(t => !f || String(t.name).toLowerCase().includes(f));
  $('bc-count').textContent = rows.length;
  $('bc-note').textContent = `Rules from the ${bcState.types.reduce((s, t) => s + t.builds90d, 0).toLocaleString()} builds started in the last 90 days (Upland lists no hub catalog, so a model nobody has started lately isn't here). `
    + 'Your stake is capped at the building\'s maximum and must reach its minimum. "Have it built" is what owners paid builders to take the job (median of 3+ contracts in 90 days; otherwise its Sparklet-hours at the going rate'
    + (bcState.stats.contracts ? `, ${Math.round(bcState.stats.contracts.p50).toLocaleString()} UPX per million Sparklet-hours over ${bcState.stats.contracts.n.toLocaleString()} contracts` : '')
    + '). "Buyers pay over land" is the median a finished one adds to a property\'s price.';
  $('bc-body').innerHTML = rows.length
    ? rows.map(t => {
      const yours = stake == null ? '<span class="muted">enter a stake</span>'
        : stake < t.minStake ? `<span class="muted">needs ${t.minStake.toLocaleString()}</span>`
        : `${bcDur(t.hoursNeeded / Math.min(stake, t.maxStake))}${stake > t.maxStake ? ' <span class="muted">(at max)</span>' : ''}`;
      return `
      <tr>
        <td>${escHtml(t.name)}</td>
        <td class="num">${t.builds90d.toLocaleString()}${t.contracts90d ? ` <span class="muted">(${t.contracts90d} contracts)</span>` : ''}</td>
        <td class="num">${t.minStake.toLocaleString()} / ${t.maxStake.toLocaleString()}</td>
        <td class="num">${t.hoursNeeded.toLocaleString()}</td>
        <td class="num">${yours}</td>
        <td class="num">${bcDur(t.hoursNeeded / t.maxStake)}</td>
        <td class="num">${bcBuildCost(t)}</td>
        <td class="num">${t.sales >= 5 ? `${apUpx(t.median)} <span class="muted">(${t.sales})</span>` : '<span class="muted">too few sales</span>'}</td>
      </tr>`;
    }).join('')
    : '<tr class="table-empty"><td colspan="8">No building by that name</td></tr>';
}

['bc-amount', 'bc-filter'].forEach(id => $(id).addEventListener('input', bcRender));
$('bc-unit').addEventListener('change', bcRender);
$('bc-form').addEventListener('submit', e => e.preventDefault());
$('bc-balance').addEventListener('click', async () => {
  const note = $('bc-balance-note');
  try {
    const b = await apGet('/api/upland/user/balances');
    // Upland's availableSpark is in Sparklet, despite the name (checked against a real account's balance, 2026-11-03).
    $('bc-amount').value = b.availableSpark ?? 0;
    $('bc-unit').value = 'sparklet';
    note.textContent = `From Upland: ${Number(b.availableSpark ?? 0).toLocaleString()} Sparklet available${b.stakedSpark ? `, ${Number(b.stakedSpark).toLocaleString()} staked` : ''}.`;
    bcRender();
  } catch (err) {
    note.textContent = /not connected/i.test(err.message)
      ? 'Your Upland account isn\'t connected here, so enter your stake by hand.'
      : `Couldn't read your balance: ${err.message}`;
  }
});
document.querySelector('.nav-item[data-section="buildcalc"]').addEventListener('click', () => {
  if (!bcState.types) loadBuildRules();
});

/* ── Map Assets: State ───────────────────────────────────── */
const maState = { chart: null, chartResizeObs: null, asset: null };

/* ── Map Assets: Helpers ─────────────────────────────────── */
function maFmtUpx(n) {
  return n != null ? `${Number(n).toLocaleString()} UPX` : '-';
}

/* ── Map Assets: Find an asset to chart ───────────────────
   Type or paste a name; matches come from the indexer's full design list
   (most traded first). The old dropdown only knew names seen in the last
   few on-chain events. */
const maSearch  = $('ma-nft-search');
const maSuggest = $('ma-nft-suggest');
let maMatches = [];
let maSearchSeq = 0;

async function maFindAssets(q) {
  const params = new URLSearchParams({ q, sort: 'traded', pageSize: '10' });
  const r = await fetch(`/api/upland/market/assets?${params}`, { headers: { Authorization: `Bearer ${state.token}` } });
  if (r.status === 401) { logout(); return []; }
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Search failed');
  return data.assets;
}

function maHideSuggest() { maSuggest.classList.add('hidden'); }

function maRenderSuggest(list) {
  maSuggest.innerHTML = list.length
    ? list.map((a, i) => `
      <div class="ma-suggest-row" data-index="${i}" style="padding:0.5rem 0.75rem;cursor:pointer;border-bottom:1px solid var(--border)">
        <div style="font-size:0.84rem;color:var(--text);font-weight:500">${escHtml(a.display_name || a.token_name)}</div>
        <div style="font-size:0.72rem;color:var(--text-muted)">${escHtml(a.categoryLabel)} · ${a.sales_30d} sold in 30 days${a.floor_30d != null ? ` · cheapest ${maFmtUpx(a.floor_30d)}` : ''}</div>
      </div>`).join('')
    : '<div style="padding:0.6rem 0.75rem;font-size:0.8rem;color:var(--text-muted)">No asset with that name</div>';
  maSuggest.classList.remove('hidden');
}

function chooseMaAsset(a) {
  maState.asset = { category: a.category, token: a.token_name };
  maSearch.value = a.display_name || a.token_name;
  maHideSuggest();
  loadMaChart();
}

let maSearchTimer;
maSearch.addEventListener('input', () => {
  clearTimeout(maSearchTimer);
  const q = maSearch.value.trim();
  if (q.length < 2) { maHideSuggest(); return; }
  maSearchTimer = setTimeout(async () => {
    const seq = ++maSearchSeq;
    try {
      const list = await maFindAssets(q);
      if (seq !== maSearchSeq) return;
      maMatches = list;
      maRenderSuggest(list);
    } catch { maHideSuggest(); }
  }, 250);
});

// Enter takes an exact name match (a pasted title) if there is one, else the top match.
maSearch.addEventListener('keydown', async e => {
  if (e.key === 'Escape') { maHideSuggest(); return; }
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const q = maSearch.value.trim();
  if (!q) return;
  clearTimeout(maSearchTimer);
  const seq = ++maSearchSeq;
  try {
    const list = await maFindAssets(q);
    if (seq !== maSearchSeq) return;
    const exact = list.find(a => (a.display_name || '').toLowerCase() === q.toLowerCase());
    if (exact || list[0]) chooseMaAsset(exact || list[0]);
    else { maMatches = []; maRenderSuggest([]); }
  } catch { maHideSuggest(); }
});

maSuggest.addEventListener('mousedown', e => {
  const row = e.target.closest('.ma-suggest-row');
  if (row) chooseMaAsset(maMatches[Number(row.dataset.index)]);
});
maSearch.addEventListener('blur', () => setTimeout(maHideSuggest, 150));

/* An asset sent over from the full-window browser: /?asset=<category>/<token> */
function maOpenFromUrl() {
  const asset = new URLSearchParams(location.search).get('asset');
  if (!asset || !asset.includes('/')) return;
  const [category, token] = asset.split('/');
  history.replaceState(null, '', location.pathname);
  document.querySelector('.nav-item[data-section="map-assets"]').click();
  maState.asset = { category, token };
  loadMaChart();
}

/* ── Map Assets: Chart lifecycle ────────────────────────── */
function destroyMaChart() {
  if (maState.chartResizeObs) { maState.chartResizeObs.disconnect(); maState.chartResizeObs = null; }
  if (maState.chart) { maState.chart.remove(); maState.chart = null; }
}

function buildMaChart(candles) {
  destroyMaChart();
  const container   = $('ma-chart-container');
  const placeholder = $('ma-chart-placeholder');

  if (!candles || candles.length === 0) {
    placeholder.style.display = 'flex';
    return;
  }
  placeholder.style.display = 'none';

  const chart = LightweightCharts.createChart(container, {
    width:  container.offsetWidth,
    height: 300,
    layout: { background: { color: '#111120' }, textColor: '#94a3b8' },
    grid:   { vertLines: { color: '#1c1c30' }, horzLines: { color: '#1c1c30' } },
    rightPriceScale: { borderColor: '#1c1c30' },
    timeScale:       { borderColor: '#1c1c30', timeVisible: false },
    crosshair: { mode: 1 },
  });

  const series = chart.addCandlestickSeries({
    upColor:         '#10b981',
    downColor:       '#ef4444',
    borderUpColor:   '#10b981',
    borderDownColor: '#ef4444',
    wickUpColor:     '#10b981',
    wickDownColor:   '#ef4444',
  });

  series.setData(candles);
  chart.timeScale().fitContent();

  const obs = new ResizeObserver(() => chart.applyOptions({ width: container.offsetWidth }));
  obs.observe(container);

  maState.chart = chart;
  maState.chartResizeObs = obs;
}

function maShowCoverage(afterEl, text) {
  let el = $('ma-chart-coverage');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ma-chart-coverage';
    el.style.cssText = 'font-size:12px;color:#94a3b8;margin-top:8px';
    afterEl.after(el);
  }
  el.textContent = text || '';
}

/* ── Map Assets: Load chart for the chosen asset ─────────────
   Daily candles of what sellers received, from the indexer (1 UPX giveaways
   left out), cut to the chosen period. */
async function loadMaChart() {
  const asset = maState.asset;
  const days  = Number($('ma-period').value);
  if (!asset) return;

  const placeholder = $('ma-chart-placeholder');
  const chartMsg    = $('ma-chart-msg');
  const chartStats  = $('ma-chart-stats');
  destroyMaChart();
  placeholder.style.display = 'flex';
  chartMsg.textContent      = 'Loading price history…';
  chartStats.classList.add('hidden');
  maShowCoverage(chartStats, '');

  try {
    const r = await fetch(`/api/upland/market/asset/${encodeURIComponent(asset.category)}/${encodeURIComponent(asset.token)}`,
      { headers: { Authorization: `Bearer ${state.token}` } });
    if (r.status === 401) { logout(); return; }
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed to load price history');
    if (asset !== maState.asset) return; // another asset was chosen meanwhile
    const name = data.design.display_name || data.design.token_name;
    if (!maSearch.value) maSearch.value = name;
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    buildMaChart(data.candles.filter(c => c.day >= since).map(c => ({ time: c.day, open: c.open, high: c.high, low: c.low, close: c.close })));

    const st = data.stats[days] || { trades: 0 };
    const history = data.salesFrom ? `Sales history since ${new Date(data.salesFrom).toLocaleDateString(undefined, { dateStyle: 'medium' })}` : '';
    const gifts = data.giveaways ? `; ${data.giveaways} giveaway sale${data.giveaways > 1 ? 's' : ''} at 1 UPX left out` : '';
    if (st.trades > 0) {
      $('ma-stat-avg').textContent    = maFmtUpx(st.avg);
      $('ma-stat-min').textContent    = maFmtUpx(st.min);
      $('ma-stat-max').textContent    = maFmtUpx(st.max);
      $('ma-stat-trades').textContent = st.trades;
      chartStats.classList.remove('hidden');
      maShowCoverage(chartStats, `${name}, last ${days} days. ${history}${gifts}.`);
    } else {
      placeholder.style.display = 'flex';
      chartMsg.textContent      = `No sales of "${name}" in the last ${days} days. ${history}.`;
    }
  } catch (err) {
    placeholder.style.display = 'flex';
    chartMsg.textContent      = err.message || 'Failed to load price history';
  }
}

/* ── Map Assets: Chart controls ─────────────────────────── */
$('ma-period').addEventListener('change', loadMaChart);
$('map-assets-refresh').addEventListener('click', () => { if (maState.asset) loadMaChart(); });

/* ── Collection Optimizer ───────────────────────────────── */
const fmtUpx = n => (n == null ? '—' : `${Math.round(n).toLocaleString()} UPX`);

async function runCollectionOptimizer(e) {
  e.preventDefault();
  const btn = $('co-run-btn');
  const errBox = $('co-error');
  errBox.classList.add('hidden');
  setLoading(btn, true);
  try {
    const params = new URLSearchParams({
      yieldRate: String((Number($('co-yield').value) || 4.9) / 100),
      rewardMonths: String(Number($('co-reward-months').value) || 0),
    });
    const r = await fetch(`/api/upland/optimizer/collections?${params}`, {
      headers: { Authorization: `Bearer ${state.token}` },
    });
    if (r.status === 401) { logout(); return; }
    const data = await r.json();
    if (!r.ok) {
      errBox.textContent = r.status === 403
        ? 'Connect your Upland account on the Dashboard first, so the optimizer can read your properties.'
        : (data.error || 'The optimizer failed');
      errBox.classList.remove('hidden');
      return;
    }
    renderCollectionPlan(data);
  } catch {
    errBox.textContent = 'Could not reach the optimizer';
    errBox.classList.remove('hidden');
  } finally {
    setLoading(btn, false);
  }
}

function renderCollectionPlan(data) {
  const t = data.totals;
  $('co-stat-props').textContent = t.properties.toLocaleString();
  $('co-stat-now').textContent   = t.monthlyCurrent == null ? fmtUpx(t.monthlyBase) : fmtUpx(t.monthlyCurrent);
  $('co-stat-plan').textContent  = fmtUpx(t.monthlyWithPlan);
  const gain = t.gainVsCurrent == null ? t.monthlyGain : t.gainVsCurrent;
  $('co-stat-gain').textContent  = `${gain >= 0 ? '+' : '−'}${fmtUpx(Math.abs(gain))}`;

  const inactive = data.inactiveCurrent || [];
  $('co-inactive-card').classList.toggle('hidden', inactive.length === 0);
  $('co-inactive-count').textContent = inactive.length;
  $('co-inactive-body').innerHTML = inactive.map(c => `
    <tr>
      <td>${escHtml(c.name)}</td>
      <td style="text-align:right">×${c.boost}</td>
      <td style="text-align:right">${c.have}</td>
      <td style="text-align:right">${c.need}</td>
    </tr>`).join('');

  // Main list: collections that need edits in-game. A collection already tagged
  // exactly as planned moves to "Already set up" instead.
  const muted = t => `<span style="color:var(--text-muted)">${t}</span>`;
  const where = p => `${escHtml(p.address)}, ${escHtml(p.city || '')}`;
  const nameCell = c => `<strong>${escHtml(c.name)}</strong>${c.variant ? `<br><span style="color:var(--text-muted);font-size:0.8rem">${escHtml(c.variant)}</span>` : ''}${c.inferred ? ' <span class="badge" title="Our reading of the rule">inferred</span>' : ''}`;
  const addTag = '<span style="color:var(--success);font-weight:600">+ add</span>';
  const outTag = '<span style="color:var(--error);font-weight:600">− take out</span>';
  const keep = data.plan.filter(c => c.status === 'keep');
  const change = data.plan.filter(c => c.status !== 'keep');
  const dropped = data.dropped || [];
  const added = c => new Set((c.add || []).map(p => p.id));
  const changeRows = change.map(c => `
    <tr>
      <td>${nameCell(c)}${c.status === 'new' ? `<br>${muted('<span style="font-size:0.8rem">new collection</span>')}` : ''}</td>
      <td style="text-align:right">×${c.boost}</td>
      <td style="font-size:0.85rem">${[
        ...c.properties.map(p => added(c).has(p.id)
          ? `${addTag} ${where(p)} ${muted(`(${Number(p.mintPrice).toLocaleString()} mint)`)}`
          : muted(`already in: ${where(p)}`)),
        ...(c.remove || []).map(p => `${outTag} ${where(p)}`),
      ].join('<br>')}</td>
      <td style="text-align:right">+${fmtUpx(c.monthlyGain)}</td>
      <td style="text-align:right">${c.reward ? fmtUpx(c.reward) : '—'}</td>
    </tr>`);
  const droppedRows = dropped.map(d => `
    <tr>
      <td><strong>${escHtml(d.name)}</strong><br>${muted('<span style="font-size:0.8rem">active now, not in the plan</span>')}</td>
      <td style="text-align:right">×${d.boost}</td>
      <td style="font-size:0.85rem">${d.remove.map(p => `${outTag} ${where(p)}`).join('<br>')}</td>
      <td style="text-align:right">—</td>
      <td style="text-align:right">—</td>
    </tr>`);
  $('co-plan-count').textContent = change.length + dropped.length;
  $('co-plan-body').innerHTML = changeRows.length + droppedRows.length
    ? [...changeRows, ...droppedRows].join('')
    : `<tr class="table-empty"><td colspan="5">${data.plan.length ? 'Nothing to change: every collection already matches the plan' : 'No collection can be completed with these properties'}</td></tr>`;

  $('co-keep-count').textContent = keep.length;
  $('co-keep-body').innerHTML = keep.length
    ? keep.map(c => `
        <tr>
          <td>${nameCell(c)}</td>
          <td style="text-align:right">×${c.boost}</td>
          <td style="font-size:0.85rem">${c.properties.map(where).join('<br>')}</td>
          <td style="text-align:right">+${fmtUpx(c.monthlyGain)}</td>
        </tr>`).join('')
    : '<tr class="table-empty"><td colspan="4">None of your collections match the plan exactly yet</td></tr>';

  $('co-near-count').textContent = data.nearMisses.length;
  $('co-near-body').innerHTML = data.nearMisses.length
    ? data.nearMisses.map(n => `
        <tr>
          <td>${escHtml(n.name)}</td>
          <td style="text-align:right">×${n.boost}</td>
          <td style="font-size:0.85rem">${escHtml(n.requirements)}</td>
          <td style="text-align:right">${n.have}</td>
          <td style="text-align:right">${n.need}</td>
        </tr>`).join('')
    : '<tr class="table-empty"><td colspan="5">Nothing within two properties</td></tr>';

  $('co-unsupported-count').textContent = data.unsupported.length;
  $('co-unsupported-body').innerHTML = data.unsupported.length
    ? data.unsupported.map(u => `
        <tr>
          <td>${escHtml(u.name)}</td>
          <td style="text-align:right">×${u.boost}</td>
          <td style="font-size:0.85rem">${escHtml(u.requirements)}</td>
          <td style="font-size:0.8rem;color:var(--text-muted)">${escHtml(u.reason)}</td>
        </tr>`).join('')
    : '<tr class="table-empty"><td colspan="4">None in your cities</td></tr>';

  const closedNote = (data.notOpenForCollections || []).length
    ? `Not open to collections yet, so left out: ${data.notOpenForCollections.map(c => `${c.city} (${c.properties})`).join(', ')}. `
    : '';
  $('co-footnote').textContent = closedNote +
    `${data.method === 'optimal' ? 'Provably optimal under these assumptions' : 'Best plan found (search limit reached)'}. ` +
    `${data.coverage.readable} of ${data.coverage.collections} relevant collections understood. ` +
    data.assumptions.join(' ');
  $('co-results').classList.remove('hidden');
}

$('co-form').addEventListener('submit', runCollectionOptimizer);

/* ── Floor Board ────────────────────────────────────────── */
/* Three ways to choose cities: all of Upland, only the ticked ones, or all but
   the ticked ones. The choice and the ticks are remembered in this browser. */
const fbState = { citiesLoaded: false };
const FB_HINTS = {
  all: 'Showing all of Upland. Tick a city to narrow it down, or switch to "All except" to leave a few out.',
  only: 'Tick the cities to include.',
  except: 'Tick the cities to leave out; everything else is included.',
};
const fbStore = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage off: just don't remember */ } },
};

function fbMode() { return $('fb-mode').value; }
function fbTicked() { return [...document.querySelectorAll('#fb-city-list input:checked')].map(i => i.value); }

function fbSync() {
  const mode = fbMode();
  $('fb-hint').textContent = FB_HINTS[mode];
  $('fb-city-list').style.opacity = mode === 'all' ? '0.55' : '1';
  fbStore.set('kfm_fb_mode', mode);
  fbStore.set('kfm_fb_cities', fbTicked());
}

async function loadFloorCities() {
  const r = await fetch('/api/upland/floors/cities');
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Could not load cities');
  const saved = new Set(fbStore.get('kfm_fb_cities', []).map(String));
  $('fb-city-list').innerHTML = data.cities.map(c => `
    <label style="display:flex;align-items:center;gap:0.4rem;cursor:pointer">
      <input type="checkbox" value="${c.id}"${saved.has(String(c.id)) ? ' checked' : ''}> ${escHtml(c.name)}
      <span style="color:var(--text-muted)">(${Number(c.listings).toLocaleString()})</span>
    </label>`).join('');
  document.querySelectorAll('#fb-city-list input').forEach(i => i.addEventListener('change', () => {
    // Ticking a city while showing all of Upland means "just these".
    if (fbMode() === 'all' && i.checked) $('fb-mode').value = 'only';
    fbSync();
    loadFloors();
  }));
  fbState.citiesLoaded = true;
  fbSync();
}

let fbLoadSeq = 0;
async function loadFloors() {
  const seq = ++fbLoadSeq;
  const errBox = $('fb-error');
  errBox.classList.add('hidden');
  try {
    if (!fbState.citiesLoaded) await loadFloorCities();
    const mode = fbMode();
    const ticked = mode === 'all' ? [] : fbTicked();
    const params = new URLSearchParams({ top: '25' });
    if (ticked.length) params.set(mode === 'only' ? 'cities' : 'exclude', ticked.join(','));
    const r = await fetch(`/api/upland/floors?${params}`);
    const data = await r.json();
    if (seq !== fbLoadSeq) return; // a newer choice already went out; don't overwrite it
    if (!r.ok) throw new Error(data.error || 'Could not load floors');
    renderFloors(data, ticked.length ? { mode, count: ticked.length } : null);
  } catch (err) {
    if (seq !== fbLoadSeq) return;
    errBox.textContent = err.message;
    errBox.classList.remove('hidden');
  }
}

function renderFloors(data, picked) {
  const when = iso => (iso ? new Date(iso).toLocaleString() : 'never');
  const cities = n => `${n} ${n === 1 ? 'city' : 'cities'}`;
  $('fb-meta').textContent =
    `${!picked ? 'All of Upland' : picked.mode === 'only' ? `${cities(picked.count)} selected` : `All of Upland except ${cities(picked.count)}`}. ` +
    `Listing book: ${data.listings.toLocaleString()} live listings (snapshot ${when(data.snapshotAt)}; live changes applied up to ${when(data.changesAppliedTo)}). ` +
    `${data.unmappedListings.toLocaleString()} listings aren't in the property catalog yet, so their city is unknown.`;

  const mult = l => (l && l.markup ? `×${l.markup}` : '—');
  $('fb-cheapest-count').textContent = data.cheapest.length;
  $('fb-cheapest-body').innerHTML = data.cheapest.length
    ? data.cheapest.map(l => `
        <tr>
          <td style="text-align:right"><strong>${fmtUpx(l.priceUpx)}</strong></td>
          <td style="text-align:right">${mult(l)}</td>
          <td>${escHtml(l.address || l.propertyId)}</td>
          <td>${escHtml(l.neighborhood || '—')}</td>
          <td>${escHtml(l.city || '—')}</td>
          <td style="text-align:right">${l.mintPrice ? Number(l.mintPrice).toLocaleString() : '—'}</td>
        </tr>`).join('')
    : '<tr class="table-empty"><td colspan="6">No UPX listings in this selection</td></tr>';

  $('fb-city-count').textContent = data.cities.length;
  $('fb-city-body').innerHTML = data.cities.length
    ? data.cities.map(c => `
        <tr>
          <td><strong>${escHtml(c.cityName)}</strong></td>
          <td style="text-align:right" title="${escHtml(c.floor ? `${c.floor.address}, ${c.floor.neighborhood || ''}` : '')}">${c.floor ? fmtUpx(c.floor.priceUpx) : '—'}</td>
          <td style="text-align:right">${fmtUpx(c.robustFloor)}</td>
          <td style="text-align:right">${fmtUpx(c.medianAsk)}</td>
          <td style="text-align:right">${c.upxListings.toLocaleString()}${c.usdListings ? ` <span style="color:var(--text-muted)">+${c.usdListings.toLocaleString()} USD</span>` : ''}</td>
          <td style="text-align:right" title="${escHtml(c.lowestMarkup ? `${c.lowestMarkup.address}: ${fmtUpx(c.lowestMarkup.priceUpx)}` : '')}">${mult(c.lowestMarkup)}</td>
          <td style="text-align:right">${c.usdFloor ? `$${Number(c.usdFloor.priceUsd).toLocaleString()}` : '—'}</td>
        </tr>`).join('')
    : '<tr class="table-empty"><td colspan="7">No catalogued cities in this selection</td></tr>';
}

$('fb-mode').value = ['all', 'only', 'except'].includes(fbStore.get('kfm_fb_mode', 'all')) ? fbStore.get('kfm_fb_mode', 'all') : 'all';
$('fb-mode').addEventListener('change', () => { fbSync(); loadFloors(); });
$('fb-refresh-btn').addEventListener('click', loadFloors);
document.querySelector('.nav-item[data-section="floors"]').addEventListener('click', loadFloors);

/* ── Init ────────────────────────────────────────────────── */
if (new URLSearchParams(window.location.search).get('reset_token')) {
  showResetPassword();
} else if (state.token) {
  showApp();
} else {
  showAuth();
}

loadCities().then(() => {
  if (state.cities) {
    populateBuildingCities(state.cities);
    populateAppraiserCities(state.cities);
  }
});
