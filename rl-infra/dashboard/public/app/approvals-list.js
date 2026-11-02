// ROK-1900 — approvals inbox: header tabs, Pending / Archive list,
// "From test plans" step cards, polling, and the no-key / error states.
//
// Plain <script> on window.__rlApprovals (needs approvals-state.js first).
// Every piece of server text (titles, story ids, plan descriptions) goes in
// via textContent — never innerHTML. The item page (`?approval=<id>`) is
// L5's: if it registers NS.renderItemPage we hand over, else a placeholder.

(function attachApprovalsList() {
  const NS = (window.__rlApprovals = window.__rlApprovals || {});
  const ui = { key: null, mode: 'pending', fetch: null, now: () => Date.now(), busy: false, painted: '' };

  const $ = (id) => document.getElementById(id);
  const h = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  };

  const MSG = {
    nokey: "Open your approval link once on this device to see what's waiting.",
    unconfigured: 'The approvals inbox is not switched on for this fleet yet.',
    bad_key: "This device's approval key was refused. Open your approval link again, or forget this device.",
    error: "Couldn't load approvals. Retrying shortly.",
    emptyPending: 'Nothing is waiting on you.',
    emptyArchive: 'No decided items yet.',
  };

  const fetchList = async (key, status) => {
    try {
      const r = await ui.fetch(`/api/approvals?status=${status}`, {
        cache: 'no-store', headers: { 'X-Approval-Token': key },
      });
      if (!r.ok) return { state: NS.classifyStatus(r.status) };
      return { state: 'ok', data: await r.json() };
    } catch { return { state: 'error' }; }
  };

  const postStepVerdict = async (step, verdict) => {
    const url = `/api/test-plans/${encodeURIComponent(step.slug)}/${encodeURIComponent(step.plan_id)}/submit`;
    try {
      const r = await ui.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Approval-Token': ui.key },
        body: JSON.stringify({ tester: 'operator', verdicts: [{ step_id: step.step_id, verdict }] }),
      });
      return r.ok;
    } catch { return false; }
  };

  const head = (chipText, pillText, pillCls) => {
    const row = h('div', 'approval-head');
    row.append(h('span', 'approval-chip', chipText || '—'));
    row.append(h('span', `approval-pill ${pillCls || ''}`.trim(), pillText));
    return row;
  };

  const itemCard = (item, mode) => {
    const pending = mode === 'pending';
    const a = h('a', `card approval-card${pending ? ' approval-card-open' : ''}`);
    a.href = NS.itemHref(item.id);
    const pill = pending
      ? { label: item.kind || 'item', cls: NS.kindClass(item.kind) }
      : NS.statusPill(item.status);
    a.append(head(item.story, pill.label, pill.cls), h('div', 'approval-title', item.title || '(untitled)'));
    const meta = h('div', 'approval-meta');
    const when = pending
      ? [item.asked_by, NS.fmtAge(item.created_at, ui.now())].filter(Boolean).join(' · ')
      : (item.decided_at ? `decided ${NS.fmtDate(item.decided_at)}` : NS.fmtDate(item.created_at));
    meta.append(h('span', null, NS.questionsMeta(item)), h('span', null, when));
    a.append(meta);
    if (pending) {
      const bar = h('div', 'approval-prog');
      const fill = h('i');
      fill.style.width = `${NS.progressPct(item)}%`;
      bar.append(fill);
      a.append(bar);
    }
    return a;
  };

  const verdictButton = (step, verdict, label, all) => {
    const b = h('button', `approval-btn approval-btn-${verdict}`, label);
    b.type = 'button';
    b.addEventListener('click', async () => {
      all.forEach((x) => { x.disabled = true; });
      const ok = await postStepVerdict(step, verdict);
      if (ok) { ui.painted = ''; void refresh(); return; }
      all.forEach((x) => { x.disabled = false; });
      b.textContent = `${label} — failed, retry`;
    });
    all.push(b);
    return b;
  };

  const stepCard = (step) => {
    const card = h('div', 'card approval-step-card');
    card.append(head(step.story_id || step.slug, `${step.category} step ${step.step_id}`));
    const row = h('div', 'approval-step');
    const text = h('div', 'approval-step-text');
    text.append(h('div', 'approval-title approval-title-sm', step.description));
    text.append(h('div', 'approval-meta', [step.goal, `plan ${step.plan_id}`].filter(Boolean).join(' · ')));
    const btns = h('div', 'approval-btns');
    const href = NS.safeHref(step.plan_url);
    if (href) {
      const open = h('a', 'approval-btn', 'Open ↗');
      open.href = href;
      open.target = '_blank';
      open.rel = 'noopener noreferrer';
      btns.append(open);
    }
    const all = [];
    btns.append(verdictButton(step, 'pass', 'Pass', all), verdictButton(step, 'fail', 'Fail', all));
    row.append(text, btns);
    card.append(row);
    return card;
  };

  const section = (title, nodes, emptyText) => {
    const frag = document.createDocumentFragment();
    if (title) frag.append(h('h3', 'approval-subhead', title));
    if (nodes.length === 0) { frag.append(h('div', 'empty approval-empty', emptyText)); return frag; }
    const grid = h('div', 'approvals-grid');
    grid.append(...nodes);
    frag.append(grid);
    return frag;
  };

  const forgetLink = () => {
    const b = h('button', 'approval-forget', 'Forget this device');
    b.type = 'button';
    b.addEventListener('click', () => {
      try { NS.forgetKey(window.localStorage); } catch { /* storage blocked */ }
      ui.key = null;
      ui.painted = '';
      void refresh();
    });
    return b;
  };

  const paintSeg = (data) => {
    const seg = $('approvals-seg');
    if (!seg) return;
    seg.hidden = !data;
    const p = $('approvals-seg-pending');
    const a = $('approvals-seg-archive');
    if (!data || !p || !a) return;
    const c = data.counts || {};
    p.textContent = `Pending · ${Number(c.pending) || 0}`;
    a.textContent = `Archive · ${Number(c.decided) || 0}`;
    p.classList.toggle('on', ui.mode === 'pending');
    a.classList.toggle('on', ui.mode === 'archive');
    p.setAttribute('aria-pressed', String(ui.mode === 'pending'));
    a.setAttribute('aria-pressed', String(ui.mode === 'archive'));
  };

  const paintBadge = (res) => {
    const badge = $('approvals-badge');
    if (!badge) return;
    const n = res && res.state === 'ok' ? NS.badgeCount(res.data) : 0;
    badge.textContent = String(n);
    badge.hidden = n === 0;
  };

  const paintList = (res) => {
    const body = $('approvals-body');
    if (!body) return;
    const sig = `${ui.mode}|${res.state}|${res.state === 'ok' ? JSON.stringify(res.data) : ''}`;
    if (sig === ui.painted) return; // nothing changed — keep scroll/focus
    ui.painted = sig;
    const scroll = { x: window.scrollX, y: window.scrollY };
    body.replaceChildren();
    paintSeg(res.state === 'ok' ? res.data : null);
    if (res.state !== 'ok') {
      body.append(h('div', `empty approval-empty approval-${res.state}`, MSG[res.state] || MSG.error));
      if (ui.key && res.state === 'bad_key') body.append(forgetLink());
      return;
    }
    const d = res.data || {};
    if (ui.mode === 'archive') {
      body.append(section(null, NS.sortItems(d.items, 'archive').map((i) => itemCard(i, 'archive')), MSG.emptyArchive));
    } else {
      const items = NS.sortItems(d.items, 'pending').map((i) => itemCard(i, 'pending'));
      body.append(section('Waiting on you', items, MSG.emptyPending));
      const steps = Array.isArray(d.plan_steps) ? d.plan_steps : [];
      if (steps.length) body.append(section('From test plans', steps.map(stepCard), ''));
    }
    body.append(forgetLink());
    window.scrollTo(scroll.x, scroll.y);
  };

  const paintItem = (id) => {
    const body = $('approvals-body');
    if (!body) return;
    paintSeg(null);
    ui.painted = '';
    if (typeof NS.renderItemPage === 'function') { NS.renderItemPage(body, id, ui.key); return; }
    body.replaceChildren(h('div', 'empty approval-empty', `Opening item ${id}…`));
  };

  const applyView = () => {
    const { view, id } = NS.getView(window.location.href);
    const onFleet = view === 'fleet';
    const fleetMain = $('operator-main');
    const apprMain = $('approvals-main');
    if (fleetMain) fleetMain.hidden = !onFleet;
    if (apprMain) apprMain.hidden = onFleet;
    $('tab-fleet')?.classList.toggle('on', onFleet);
    $('tab-approvals')?.classList.toggle('on', !onFleet);
    if (view === 'item') paintItem(id);
    return view;
  };

  async function refresh() {
    const view = NS.getView(window.location.href).view;
    if (!ui.key) {
      paintBadge(null);
      if (view === 'approvals') { ui.painted = ''; paintSeg(null); paintList({ state: 'nokey' }); }
      return;
    }
    if (ui.busy || view === 'item') return;
    ui.busy = true;
    try {
      const status = view === 'approvals' && ui.mode === 'archive' ? 'decided' : 'pending';
      const res = await fetchList(ui.key, status);
      if (status === 'pending') paintBadge(res);
      if (view === 'approvals') paintList(res);
    } finally { ui.busy = false; }
  }

  const navigate = (ev, href) => {
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button > 0) return;
    ev.preventDefault();
    window.history.pushState(null, '', href);
    ui.painted = '';
    applyView();
    void refresh();
  };

  const wire = () => {
    $('tab-fleet')?.addEventListener('click', (ev) => navigate(ev, '/'));
    $('tab-approvals')?.addEventListener('click', (ev) => navigate(ev, '/?view=approvals'));
    for (const mode of ['pending', 'archive']) {
      $(`approvals-seg-${mode}`)?.addEventListener('click', () => {
        if (ui.mode === mode) return;
        ui.mode = mode;
        ui.painted = '';
        void refresh();
      });
    }
    window.addEventListener('popstate', () => { ui.painted = ''; applyView(); void refresh(); });
  };

  // Boot. Returns the ui handle so tests can drive refresh() directly.
  NS.bootApprovals = ({ fetchImpl, now, poll = true } = {}) => {
    ui.fetch = fetchImpl || window.fetch.bind(window);
    if (now) ui.now = now;
    ui.key = NS.captureKey(window);
    wire();
    applyView();
    const first = refresh();
    if (poll) {
      setInterval(() => { if (!document.hidden) void refresh(); }, NS.POLL_MS);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
    }
    return { ui, refresh, first };
  };

  const autoBoot = () => {
    if (window.__rlApprovalsNoAutoBoot) return;
    const u = new URL(window.location.href);
    if (u.searchParams.get('slug') || /^\/t\//.test(u.pathname)) return; // tester route
    NS.bootApprovals();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoBoot);
  else autoBoot();
})();
