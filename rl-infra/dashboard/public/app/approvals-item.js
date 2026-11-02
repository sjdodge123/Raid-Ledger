// ROK-1900 — approvals inbox item page (`?approval=<id>`).
//
// Plain <script> on window.__rlApprovals (needs approvals-state.js and
// approvals-markdown.js). approvals-list.js hands over via NS.renderItemPage.
// Every piece of server text goes in through textContent; the spec goes
// through the safe markdown renderer. The mockup runs in an iframe with
// sandbox="allow-scripts" ONLY (no same-origin, no top navigation, no
// popups), no referrer. Its src (and every screenshot / "Open full screen"
// URL) is a signed, single-file, ~10-minute URL from GET /api/approvals/<id>
// — NEVER the inbox key: the mockup can read its own URL.
// Writes are optimistic: the page updates at once, rolls back and shows an
// alert line if the server refuses.

(function attachApprovalsItem() {
  const NS = (window.__rlApprovals = window.__rlApprovals || {});
  const { h, btn, makePanels } = NS.itemKit;
  const DONE = { approved: 'Approved', changes_requested: 'Changes requested', rejected: 'Rejected',
    withdrawn: 'Withdrawn by the agent', superseded: 'Superseded by a newer item' };
  const MSG = {
    nokey: 'Open your approval link once on this device to rule on this item.',
    bad_key: "This device's approval key was refused. Open your approval link again.",
    unconfigured: 'The approvals inbox is not switched on for this fleet yet.',
    not_found: 'This item does not exist.',
    error: "Couldn't load this item. Reload to try again.",
  };


  // Re-fetch signed URLs when a paint happens within this long of expiry, and
  // on a timer this long before expiry while the page sits idle.
  const URL_REFRESH_MS = 2 * 60 * 1000;
  const URL_TIMER_LEAD_MS = 60 * 1000;


  const rulingOf = (item, n) => (item.rulings || []).find((r) => r.n === n) || null;
  const ruledCount = (item) => (item.questions || []).filter((q) => rulingOf(item, q.n)).length;

  const rulingText = (q, r) => {
    if (r.choice === 'accept') return '✓ Accepted recommendation';
    if (r.choice === 'other') return 'Other';
    const opt = (q.options || []).find((o) => o.key === r.choice);
    return `Option ${r.choice}${opt ? ` · ${opt.label}` : ''}`;
  };

  NS.renderItemPage = (body, id, key, opts = {}) => {
    const fetchImpl = opts.fetch || window.fetch.bind(window);
    const now = opts.now || (() => Date.now());
    const setTimer = opts.setTimer || (opts.timers === false ? null : (fn, ms) => window.setTimeout(fn, ms));
    const clearTimer = opts.clearTimer || ((t) => window.clearTimeout(t));
    const st = { item: null, confirmed: null, spec: null, width: 'desktop', open: null, otherFor: null,
      verdictNote: null, alert: '', urls: {}, urlsExp: 0, refreshing: false, urlTimer: null };
    // In-flight optimistic writes, one per target ('q<n>' or 'verdict'), with
    // a sequence number so a superseded write's late response is ignored.
    const inflight = new Map();
    let seq = 0;
    const clone = (o) => JSON.parse(JSON.stringify(o));
    // The shown item = last confirmed server state + every pending write.
    const rebuild = () => {
      st.item = clone(st.confirmed);
      for (const w of inflight.values()) w.mutate(st.item);
    };
    // Signed URL for an attachment, or null (then the attachment is not shown).
    const contentUrl = (file) => (typeof st.urls[file] === 'string' ? st.urls[file] : null);
    const { mockupPanel, shotsStrip, specPanel } = makePanels(st, paint, contentUrl);

    const api = async (path, method, payload) => {
      try {
        const r = await fetchImpl(path, {
          method, cache: 'no-store',
          headers: { 'X-Approval-Token': key, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
          ...(payload ? { body: JSON.stringify(payload) } : {}),
        });
        const json = await r.json().catch(() => ({}));
        return { ok: r.ok, status: r.status, json };
      } catch { return { ok: false, status: 0, json: {} }; }
    };

    const failText = (res) => {
      if (res.status === 409) return 'This item was already decided — showing the latest state.';
      if (res.status === 401 || res.status === 403) return MSG.bad_key;
      if (res.status === 400 && res.json?.detail) return `Not saved: ${res.json.detail}`;
      return 'Not saved — the fleet did not answer. Try again.';
    };

    // Optimistic write: apply `mutate` locally, POST, then fold the server's
    // item into the confirmed state (or drop just this write and say why).
    // Other writes still in flight stay applied either way.
    const write = async (target, path, payload, mutate) => {
      const mine = ++seq;
      inflight.set(target, { seq: mine, mutate });
      mutate(st.item);
      st.open = null; st.otherFor = null; st.verdictNote = null; st.alert = '';
      paint();
      const res = await api(path, 'POST', payload);
      if (inflight.get(target)?.seq !== mine) return; // superseded by a newer write
      inflight.delete(target);
      if (res.ok && res.json?.item) st.confirmed = NS.mergeServerItem(st.confirmed, res.json.item);
      else st.alert = failText(res);
      rebuild();
      paint();
      if (res.status === 409) void load(true);
    };

    const rule = (q, choice, note) => write(`q${q.n}`, `/api/approvals/${encodeURIComponent(id)}/ruling`,
      { n: q.n, choice, ...(note ? { note } : {}) }, (item) => {
        const ts = new Date(now()).toISOString();
        item.rulings = [...(item.rulings || []).filter((r) => r.n !== q.n), { n: q.n, choice, note: note || null, ts }];
      });

    const verdict = (value, note) => write('verdict', `/api/approvals/${encodeURIComponent(id)}/verdict`,
      { value, ...(note ? { note } : {}) }, (item) => {
        const ts = new Date(now()).toISOString();
        if (value === 'approve') {
          for (const q of item.questions || []) {
            if (!rulingOf(item, q.n)) item.rulings.push({ n: q.n, choice: 'accept', note: null, ts });
          }
        }
        const status = { approve: 'approved', changes: 'changes_requested', reject: 'rejected' }[value];
        Object.assign(item, { status, verdict: { value, note: note || null, ts }, decided_at: ts });
      });

    // A note box with Send; Send stays disabled until the note has text.
    const noteBox = (placeholder, sendLabel, onSend, onCancel) => {
      const wrap = h('div', 'approval-note-box');
      const ta = h('textarea', 'approval-note');
      ta.placeholder = placeholder;
      ta.maxLength = 1000;
      const send = btn(sendLabel, 'approval-btn-primary', () => { const v = ta.value.trim(); if (v) onSend(v); });
      send.disabled = true;
      ta.addEventListener('input', () => { send.disabled = !ta.value.trim(); });
      const row = h('div', 'approval-btns');
      row.append(btn('Cancel', '', onCancel), send);
      wrap.append(ta, row);
      return wrap;
    };

    const headRow = (item) => {
      const row = h('div', 'approval-head');
      row.append(h('span', 'approval-chip', item.story || '—'));
      row.append(h('span', `approval-pill ${NS.kindClass(item.kind)}`.trim(), item.kind || 'item'));
      if (item.status !== 'pending') {
        const p = NS.statusPill(item.status);
        row.append(h('span', `approval-pill ${p.cls}`.trim(), p.label));
      }
      const asked = [item.asked_by && `asked by ${item.asked_by}`, NS.fmtAge(item.created_at, now())].filter(Boolean);
      if (asked.length) row.append(h('span', 'approval-pill', asked.join(' · ')));
      return row;
    };




    const questionCard = (item, q, pending) => {
      const r = rulingOf(item, q.n);
      const card = h('div', `card approval-q${r ? ' ruled' : ''}`);
      card.dataset.n = String(q.n);
      card.append(h('div', 'approval-qn', `QUESTION ${q.n}`), h('div', 'approval-qt', q.text));
      const rec = h('div', 'approval-rec');
      rec.append(h('b', null, 'Recommended: '), document.createTextNode(q.recommendation || ''));
      card.append(rec);
      const editing = pending && st.open === q.n;
      if (r && !editing) {
        const line = h('div', 'approval-ruling');
        line.append(h('span', r.choice === 'accept' ? 'ok' : 'chg', rulingText(q, r)));
        if (r.note) line.append(h('div', 'approval-ruling-note', r.note));
        else if (r.has_note) line.append(h('span', 'approval-muted', ' · note on file'));
        if (pending) line.append(btn('Change', 'approval-link', () => { st.open = q.n; paint(); }));
        card.append(line);
        return card;
      }
      if (!pending) { card.append(h('div', 'approval-muted', 'Not ruled')); return card; }
      if (Array.isArray(q.options) && q.options.length) {
        const opts = h('div', 'approval-opts');
        for (const o of q.options) opts.append(btn(`${o.key} · ${o.label}`, 'approval-opt', () => rule(q, o.key)));
        card.append(opts);
      }
      if (editing && st.otherFor === q.n) {
        card.append(noteBox('What should happen instead?', 'Save', (note) => rule(q, 'other', note),
          () => { st.open = null; st.otherFor = null; paint(); }));
        return card;
      }
      const row = h('div', 'approval-btns');
      row.append(btn('Accept', 'approval-btn-primary', () => rule(q, 'accept')),
        btn('Other…', '', () => { st.open = q.n; st.otherFor = q.n; paint(); }));
      card.append(row);
      return card;
    };

    const verdictBar = (item) => {
      const bar = h('div', 'approval-sticky');
      const n = (item.questions || []).length;
      bar.append(h('span', 'approval-muted', `${ruledCount(item)} of ${n} ruled · Approve accepts every unruled recommendation`));
      if (st.verdictNote) {
        const label = st.verdictNote === 'reject' ? 'Reject' : 'Send changes';
        bar.append(noteBox('Say what needs to change (required)', label, (note) => verdict(st.verdictNote, note),
          () => { st.verdictNote = null; paint(); }));
        return bar;
      }
      const row = h('div', 'approval-btns');
      row.append(btn('Reject', 'approval-btn-fail', () => { st.verdictNote = 'reject'; paint(); }),
        btn('Changes requested', 'approval-btn-chg', () => { st.verdictNote = 'changes'; paint(); }),
        btn('Approve', 'approval-btn-primary', () => verdict('approve')));
      bar.append(row);
      return bar;
    };

    const decidedLine = (item) => {
      const line = h('div', 'card approval-decided');
      const when = item.decided_at ? ` · ${NS.fmtDate(item.decided_at)}` : '';
      line.append(h('b', null, `${DONE[item.status] || item.status}${when}`));
      if (item.verdict?.note) line.append(h('div', 'approval-ruling-note', item.verdict.note));
      else if (item.verdict?.has_note) line.append(h('span', 'approval-muted', ' · note on file'));
      return line;
    };

    function paint() {
      if (st.urlsExp && now() > st.urlsExp - URL_REFRESH_MS && !st.refreshing) {
        st.refreshing = true;
        void load(true).finally(() => { st.refreshing = false; });
      }
      const item = st.item;
      const page = h('div', 'approval-page');
      const back = h('a', 'approval-back', '← Pending approval');
      back.href = '/?view=approvals';
      page.append(back);
      if (st.alert) {
        const a = h('div', 'approval-alert', st.alert);
        a.setAttribute('role', 'alert');
        page.append(a);
      }
      const pending = item.status === 'pending';
      page.append(headRow(item), h('h2', 'approval-item-title', item.title), h('p', 'approval-summary', item.summary || ''));
      if (!pending) page.append(decidedLine(item));
      const cols = h('div', 'approval-cols');
      const left = h('div');
      const att = item.attachments || {};
      if (att.mockup) left.append(mockupPanel(item));
      if (Array.isArray(att.screenshots) && att.screenshots.length) left.append(shotsStrip(item));
      if (typeof st.spec === 'string' && st.spec) left.append(specPanel(item));
      const right = h('div', 'approval-questions');
      for (const q of item.questions || []) right.append(questionCard(item, q, pending));
      cols.append(left, right);
      page.append(cols);
      if (pending) page.append(verdictBar(item));
      body.replaceChildren(page);
    }

    async function load(keepAlert) {
      if (!key) { body.replaceChildren(h('div', 'empty approval-empty', MSG.nokey)); return; }
      const res = await api(`/api/approvals/${encodeURIComponent(id)}`, 'GET');
      if (!res.ok || !res.json?.item) {
        const state = res.status === 404 ? 'not_found' : NS.classifyStatus(res.status);
        body.replaceChildren(h('div', `empty approval-empty approval-${state}`, MSG[state] || MSG.error));
        return;
      }
      st.confirmed = res.json.item;
      rebuild();
      st.spec = typeof res.json.spec_md === 'string' ? res.json.spec_md : null;
      const cu = res.json.content_urls || {};
      st.urls = cu.files && typeof cu.files === 'object' ? cu.files : {};
      st.urlsExp = Date.parse(cu.expires_at || '') || 0;
      if (!keepAlert) st.alert = '';
      scheduleUrlRefresh();
      paint();
    }

    // An idle page re-fetches the item ~1 min before its signed URLs expire,
    // so the mockup and screenshots keep loading. Stops once the page is gone.
    function scheduleUrlRefresh() {
      if (!setTimer) return;
      if (st.urlTimer !== null) clearTimer(st.urlTimer);
      st.urlTimer = null;
      if (!st.urlsExp) return;
      const wait = Math.max(5000, st.urlsExp - URL_TIMER_LEAD_MS - now());
      st.urlTimer = setTimer(() => {
        st.urlTimer = null;
        if (body.isConnected && !st.refreshing) void load(true);
      }, wait);
    }

    body.replaceChildren(h('div', 'empty approval-empty', 'Loading…'));
    return load(false);
  };
})();
