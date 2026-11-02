// ROK-1900 — approvals inbox: key capture/storage + pure list helpers.
//
// Zero-build like the tester modules: a plain <script> that attaches to
// window.__rlApprovals. Everything here is pure except the three storage
// helpers (each wrapped in try/catch — private mode / blocked storage must
// never break the page) and captureKey (which also rewrites the URL).
//
// The inbox key arrives once via the bookmarked link
//   https://fleet.<domain>/?view=approvals#k=<key>   — use the #fragment: it never
//   reaches the server or its access log. `?k=` is still read for old links.
// It is copied into localStorage on this device and stripped from the
// visible URL with history.replaceState, so it does not linger in the
// address bar, history entries or screenshots. The key is only ever sent
// in the X-Approval-Token header.

(function attachApprovalsState() {
  const NS = (window.__rlApprovals = window.__rlApprovals || {});

  const STORAGE_KEY = 'rl-approval-key';
  const POLL_MS = 5000; // spec: the badge/list poll on the 5 s loop
  // Printable, no whitespace, bounded — anything else is not a key.
  const KEY_RE = /^[\x21-\x7e]{8,512}$/;
  const ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

  // URL → { key, cleanUrl }. Reads `?k=` first, then `#k=`; cleanUrl is the
  // same URL with `k` removed from both places (other params kept).
  const parseKeyFromUrl = (href) => {
    let url;
    try { url = new URL(href); } catch { return { key: null, cleanUrl: null }; }
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    const raw = url.searchParams.get('k') || hash.get('k');
    const had = url.searchParams.has('k') || hash.has('k');
    url.searchParams.delete('k');
    hash.delete('k');
    const h = hash.toString();
    url.hash = h ? `#${h}` : '';
    const key = raw && KEY_RE.test(raw) ? raw : null;
    return { key, cleanUrl: had ? `${url.pathname}${url.search}${url.hash}` : null };
  };

  const loadKey = (storage) => {
    try {
      const v = storage.getItem(STORAGE_KEY);
      return v && KEY_RE.test(v) ? v : null;
    } catch { return null; }
  };
  const saveKey = (storage, key) => {
    try { storage.setItem(STORAGE_KEY, key); return true; } catch { return false; }
  };
  const forgetKey = (storage) => {
    try { storage.removeItem(STORAGE_KEY); } catch { /* storage blocked */ }
  };

  // Capture from the URL (if present), store it, strip it. Returns the key
  // to use for this page load: the URL one wins over a stored one. When
  // storage is blocked the URL key still works for this load only.
  const captureKey = (win) => {
    const { key, cleanUrl } = parseKeyFromUrl(win.location.href);
    if (cleanUrl !== null) {
      try { win.history.replaceState(win.history.state, '', cleanUrl); } catch { /* ignore */ }
    }
    let storage = null;
    try { storage = win.localStorage; } catch { storage = null; }
    if (key) {
      if (storage) saveKey(storage, key);
      return key;
    }
    return storage ? loadKey(storage) : null;
  };

  // URL → 'item' | 'approvals' | 'fleet'.
  const getView = (href) => {
    try {
      const q = new URL(href).searchParams;
      const id = q.get('approval');
      if (id && ID_RE.test(id)) return { view: 'item', id };
      if (q.get('view') === 'approvals') return { view: 'approvals', id: null };
    } catch { /* fall through */ }
    return { view: 'fleet', id: null };
  };

  const itemHref = (id) => `/?approval=${encodeURIComponent(id)}`;

  // Only http(s) or same-origin relative plan links are rendered as hrefs.
  const safeHref = (u) => {
    if (typeof u !== 'string') return null;
    if (/^\/(?!\/)/.test(u)) return u;
    try {
      const p = new URL(u);
      return p.protocol === 'https:' || p.protocol === 'http:' ? p.href : null;
    } catch { return null; }
  };

  const fmtAge = (iso, nowMs) => {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    const min = Math.max(0, Math.floor((nowMs - t) / 60000));
    if (min < 1) return 'just now';
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    if (h < 48) return `${h} h`;
    return `${Math.floor(h / 24)} d`;
  };

  const fmtDate = (iso) => {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    const d = new Date(t);
    const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${d.getUTCDate()} ${mon[d.getUTCMonth()]}`;
  };

  const KIND_CLASS = { mockup: 'mock', ruling: 'rule' };
  const STATUS = {
    approved: ['approved', 'ok'],
    changes_requested: ['changes requested', 'chg'],
    rejected: ['rejected', 'no'],
    withdrawn: ['withdrawn', ''],
    superseded: ['superseded', ''],
    pending: ['pending', ''],
  };
  const kindClass = (kind) => KIND_CLASS[kind] || '';
  const statusPill = (status) => {
    const s = STATUS[status] || [String(status || 'unknown'), ''];
    return { label: s[0], cls: s[1] };
  };

  const count = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  const questionsMeta = (item) => {
    const q = count(item.question_count);
    return `${q} question${q === 1 ? '' : 's'} · ${count(item.ruled_count)} ruled`;
  };
  const progressPct = (item) => {
    const q = count(item.question_count);
    return q === 0 ? 0 : Math.min(100, Math.round((count(item.ruled_count) / q) * 100));
  };

  const byCreated = (a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''));
  const byDecided = (a, b) => String(b.decided_at || b.created_at || '')
    .localeCompare(String(a.decided_at || a.created_at || ''));
  // Pending: oldest first so nothing sinks. Archive: newest decision first.
  const sortItems = (items, mode) => (Array.isArray(items) ? items.slice() : [])
    .sort(mode === 'archive' ? byDecided : byCreated);

  // Tab badge = pending items + unverdicted design/operator plan steps.
  const badgeCount = (data) => count(data?.counts?.pending)
    + (Array.isArray(data?.plan_steps) ? data.plan_steps.length : 0);

  // HTTP status → page state.
  const classifyStatus = (status) => {
    if (status === 503) return 'unconfigured';
    if (status === 401 || status === 403) return 'bad_key';
    return 'error';
  };

  Object.assign(NS, {
    STORAGE_KEY, POLL_MS, parseKeyFromUrl, loadKey, saveKey, forgetKey, captureKey,
    getView, itemHref, safeHref, fmtAge, fmtDate, kindClass, statusPill,
    questionsMeta, progressPct, sortItems, badgeCount, classifyStatus,
  });
})();
