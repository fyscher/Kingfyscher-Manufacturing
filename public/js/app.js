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

/* ── Init ────────────────────────────────────────────────── */
if (state.token) {
  showApp();
} else {
  showAuth();
}
