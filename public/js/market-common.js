/* Shared by the map asset browser and asset pages. Uses the app's sign-in
   (the token the main app keeps in this browser). */
const mk = {
  $: id => document.getElementById(id),

  token() {
    try { return localStorage.getItem('kfm_token'); } catch { return null; }
  },

  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  /** GET a market endpoint; throws an Error whose message is fit to show. */
  async get(path) {
    const token = mk.token();
    if (!token) throw new Error('signin');
    const r = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 401) throw new Error('signin');
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || `Request failed (${r.status})`);
    return body;
  },

  /** Show an error box; a missing or expired sign-in gets a link back to the app. */
  showError(box, err) {
    box.innerHTML = err.message === 'signin'
      ? 'Sign in on the <a href="/" style="color:inherit;text-decoration:underline">main app</a> first, then reload this page.'
      : mk.esc(err.message);
    box.classList.remove('hidden');
  },

  /** UPX with sensible precision: 2 decimals under 100, whole numbers above. */
  price(n) {
    if (n == null) return '<span class="muted">-</span>';
    const digits = Math.abs(n) < 100 ? 2 : 0;
    return `${Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: digits })} UPX`;
  },

  int(n) {
    return n == null ? '<span class="muted">-</span>' : Number(n).toLocaleString();
  },

  ago(iso) {
    if (!iso) return '<span class="muted">-</span>';
    const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
    if (mins < 60) return `${Math.max(mins, 1)} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 48) return `${hours} h ago`;
    return `${Math.round(hours / 24)} days ago`;
  },

  when(iso) {
    return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '-';
  },

  day(iso) {
    return iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '-';
  },

  /** One line on how fresh the data is. */
  freshness(d) {
    const parts = [];
    if (d.escrowAsOf) parts.push(`For sale as of ${mk.when(d.escrowAsOf)}`);
    if (d.salesFrom) parts.push(`sales history since ${mk.day(d.salesFrom)}`);
    if (d.refreshedAt) parts.push(`summary updated ${mk.ago(d.refreshedAt)}`);
    return parts.join(' · ');
  },

  assetUrl(a) {
    return `/asset.html?c=${encodeURIComponent(a.category)}&t=${encodeURIComponent(a.token_name)}`;
  },
};
