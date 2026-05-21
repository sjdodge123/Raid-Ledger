// rl-fleet dashboard — fetches /api/state and renders cards. Auto-refreshes
// every REFRESH_MS, but PAUSES whenever a tester has any unsent draft
// verdicts (replaceChildren during a refresh would wipe scroll/focus and
// make checkboxes feel jumpy). Resumes after Submit or Clear draft.

const REFRESH_MS = 15000;

const $ = (id) => document.getElementById(id);
const el = (tag, opts = {}, ...children) => {
  const node = document.createElement(tag);
  // ROK-1326 fix-9: <button> defaults to type="submit" per HTML spec.
  // Even without an ancestor <form> the type carries side effects
  // (some browsers fire implicit submit logic when a button is in
  // an "implicit form" context; varies across engines). Force
  // type="button" unconditionally — every button on this dashboard
  // is a click-handler, never a form-submitter.
  if (tag === 'button') node.type = 'button';
  if (opts.class) node.className = opts.class;
  if (opts.text) node.textContent = opts.text;
  if (opts.href) node.href = opts.href;
  if (opts.target) node.target = opts.target;
  if (opts.rel) node.rel = opts.rel;
  for (const child of children) {
    if (child == null) continue;
    if (typeof child === 'string') node.appendChild(document.createTextNode(child));
    else node.appendChild(child);
  }
  return node;
};

// ROK-1326 fix-5: turn http(s)://... runs inside a text node into clickable
// anchors that open in a new tab. Used by step description + step expected
// rendering only — the agent authors those, so the URLs are trusted. Tester-
// authored comment bodies are NOT auto-linkified (they're wrapped in
// <untrusted-tester-comment> tags and base64-encoded for the agent).
// ROK-1331 M6b chunk-4: match the URL non-greedily and use a lookahead so
// trailing sentence punctuation (`.,;:!?)`) and the optional terminator
// (whitespace, end-of-string, quote) stay OUTSIDE the captured URL. Plain
// `.` inside the URL ("example.com") still matches because the lookahead
// only fires when the next non-punct char IS a terminator. The follow-up
// URL_TRAILING_PUNCT_RE trim below remains as belt-and-suspenders.
const URL_RE = /(https?:\/\/[^\s<>'"`)]+?)(?=[).,;:!?]*(?:[\s<>'"`]|$))/g;
const URL_TEST = /^https?:\/\//;
// Trailing sentence punctuation should not become part of the link target
// (`http://x.com/foo.` → href `http://x.com/foo`, then a "." text node).
const URL_TRAILING_PUNCT_RE = /^(.*?)([).,;:!?]*)$/;
const appendWithLinks = (parent, text) => {
  if (!text) return;
  const parts = String(text).split(URL_RE);
  for (const part of parts) {
    if (!part) continue;
    if (URL_TEST.test(part)) {
      const m = part.match(URL_TRAILING_PUNCT_RE);
      const cleanUrl = m ? m[1] : part;
      const tail = m ? m[2] : '';
      parent.appendChild(
        el('a', {
          href: cleanUrl,
          target: '_blank',
          rel: 'noopener noreferrer',
          class: 'step-inline-link',
          text: cleanUrl,
        }),
      );
      if (tail) parent.appendChild(document.createTextNode(tail));
    } else {
      parent.appendChild(document.createTextNode(part));
    }
  }
};

const fmtTime = (iso) => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const now = Date.now();
    const ageS = Math.max(0, Math.floor((now - d.getTime()) / 1000));
    if (ageS < 60) return `${ageS}s ago`;
    if (ageS < 3600) return `${Math.floor(ageS / 60)}m ago`;
    if (ageS < 86400) return `${Math.floor(ageS / 3600)}h ago`;
    return `${Math.floor(ageS / 86400)}d ago`;
  } catch {
    return iso;
  }
};

// isLan controls whether the LAN-only infra section (Traefik/Grafana/Registry)
// is shown. The slot web/debug links below are ALWAYS shown — operators
// often hit fleet.gamernight.net from a LAN phone where slot-N.rl.lan
// still resolves via Pi-hole. Off-LAN clicks will fail at DNS resolution
// (the slot hostnames have no public DNS), which is acceptable feedback.
const isLan = window.location.hostname.endsWith('.rl.lan');

const fmtElapsed = (seconds) => {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

// ROK-1331 M5b — TTL countdown from an ISO 8601 expires_at. Returns
// "Nd Mh" / "Nh Mm" / "Nm Ms" / "Ns" depending on magnitude; once <= 0
// returns the sentinel "expired" so callers can branch on the className.
const fmtCountdown = (isoExpiresAt) => {
  if (!isoExpiresAt) return '—';
  const ms = Date.parse(isoExpiresAt) - Date.now();
  if (!Number.isFinite(ms)) return '—';
  if (ms <= 0) return 'expired';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
};

const TASK_MARKERS = { running: '▶', succeeded: '✓', failed: '✗', cancelled: '⊘' };

const renderTaskRow = (task) => {
  const status = TASK_MARKERS[task.status] ? task.status : 'running';
  const row = el('li', { class: `task-row task-row-${status}` });
  if (status === 'running') row.setAttribute('data-started-at', task.started_at);

  row.appendChild(el('span', { class: 'task-marker', text: TASK_MARKERS[status] }));

  const fullLabel = task.args_summary
    ? `${task.tool} ${task.args_summary}`
    : task.tool;
  const trimmed = fullLabel.length > 64 ? fullLabel.slice(0, 63) + '…' : fullLabel;
  const tool = el('span', { class: 'task-tool', text: trimmed });
  tool.title = fullLabel;
  row.appendChild(tool);

  row.appendChild(el('span', { class: 'task-elapsed', text: `(${fmtElapsed(task.elapsed_seconds)})` }));

  row.appendChild(document.createTextNode(' · '));
  row.appendChild(el('a', {
    class: 'task-log-link',
    href: `/api/tasks/${task.task_id}/log`,
    target: '_blank',
    rel: 'noopener',
    text: 'log',
  }));
  return row;
};

// Sort: running first, then by started_at desc.
const sortTasksForSlot = (tasks) => [...tasks].sort((a, b) => {
  if (a.status === 'running' && b.status !== 'running') return -1;
  if (a.status !== 'running' && b.status === 'running') return 1;
  return (Date.parse(b.started_at) || 0) - (Date.parse(a.started_at) || 0);
});

const renderSlot = (s, activeTasks = [], leaseQueues = []) => {
  const card = el('div', { class: 'card' });
  card.appendChild(
    el('div', { class: 'card-title' }, `Slot ${s.slot}`, ' ',
      el('span', { class: `badge ${s.claimed ? 'busy' : 'idle'}`, text: s.claimed ? 'busy' : 'idle' }),
    ),
  );
  if (s.claimed) {
    card.appendChild(el('div', { class: 'card-row' },
      el('span', { class: 'key', text: 'agent' }),
      el('span', { class: 'val', text: s.agent_id || '—' }),
    ));
    card.appendChild(el('div', { class: 'card-row' },
      el('span', { class: 'key', text: 'branch' }),
      el('span', { class: 'val', text: s.branch || '—' }),
    ));
    card.appendChild(el('div', { class: 'card-row' },
      el('span', { class: 'key', text: 'heartbeat' }),
      el('span', { class: 'val', text: fmtTime(s.last_heartbeat) }),
    ));
    // ROK-1331 M5b — claim TTL countdown. expires_at lands on the claim
    // entry via M5a's claim-duration writer; we read it through to the
    // dashboard render with NO middle-layer strip. data-expires-at lets
    // the 1s tick re-render only the TTL text without refetching state.
    if (s.expires_at) {
      const countdown = fmtCountdown(s.expires_at);
      const ttlClass = countdown === 'expired' ? 'val claim-ttl expired' : 'val claim-ttl';
      const ttlNode = el('span', { class: ttlClass, text: countdown });
      ttlNode.setAttribute('data-expires-at', s.expires_at);
      card.appendChild(el('div', { class: 'card-row' },
        el('span', { class: 'key', text: 'expires' }),
        ttlNode,
      ));
    }
  }
  // ROK-1331 M5b — lease queue depth. Render whenever the slot has any
  // waiters, regardless of claim state (a freshly-released slot with a
  // queue is the most interesting case to surface).
  const slotQueue = leaseQueues.find((q) => q.slot === s.slot);
  if (slotQueue && slotQueue.queue.length > 0) {
    card.appendChild(el('div', { class: 'card-row' },
      el('span', { class: 'key', text: 'queue' }),
      el('span', { class: 'val lease-queue', text: `Queue: ${slotQueue.queue.length}` }),
    ));
  }
  const actions = el('div', { class: 'actions' });
  // Server probes the runner's 5173 / 9229 ports on each /api/state call.
  // When the probe says "listening", render a real link. When down (the
  // common case — runner is a tmux shell until an agent runs `npm run dev`
  // or starts a Node process with --inspect), render a disabled span so
  // tapping doesn't surface a confusing 502 from Traefik.
  if (s.web_listening) {
    actions.appendChild(el('a', { href: `http://slot-${s.slot}.rl.lan`, target: '_blank', rel: 'noopener', text: 'web' }));
  } else {
    const span = el('span', { class: 'btn-disabled', text: 'web (idle)' });
    span.title = 'No dev server detected on this slot. Run `npm run dev -w web` inside the runner via `rl shell` to enable.';
    actions.appendChild(span);
  }
  if (s.debug_listening) {
    actions.appendChild(el('a', { href: `http://slot-${s.slot}-debug.rl.lan`, target: '_blank', rel: 'noopener', text: 'debug' }));
  } else {
    const span = el('span', { class: 'btn-disabled', text: 'debug (idle)' });
    span.title = 'No Node inspector detected on this slot (port 9229). Start a Node process with --inspect=0.0.0.0:9229 to enable.';
    actions.appendChild(span);
  }
  card.appendChild(actions);

  // Per-slot task list (ROK-1331 M3). Renders running + 1h-window terminal
  // rows that ride along /api/state. Empty placeholder only for claimed slots.
  const slotTasks = (activeTasks || []).filter((t) => t.slot === s.slot);
  if (slotTasks.length) {
    const ul = el('ul', { class: 'slot-tasks' });
    sortTasksForSlot(slotTasks).forEach((t) => ul.appendChild(renderTaskRow(t)));
    card.appendChild(ul);
  } else if (s.claimed) {
    card.appendChild(el('div', { class: 'slot-tasks-empty', text: 'idle (no tasks)' }));
  }

  return card;
};

const renderEnv = (e, publicDomain) => {
  // Env shape from /api/state varies — it's whatever the orchestrator wrote.
  // We accept the env-registry.json shape: { slug, slot, image, ttl, created_at, last_touched, public_domain? }.
  const slug = e.slug;
  const internalUrl = `http://${slug}.rl.lan`;
  // Prefer the env's own recorded public_domain (in case it was spun under
  // a different RL_PUBLIC_DOMAIN), fall back to the server's current value.
  // Public hostname pattern is ${slug}test.${publicDomain} to avoid colliding
  // with real subdomains under a single-level wildcard.
  const envPublic = e.public_domain || publicDomain;
  const publicUrl = envPublic ? `https://${slug}test.${envPublic}` : null;
  // ROK-1324: slot-stable hostname for OAuth flows (Discord). Same env —
  // different hostname registered once in the Discord developer portal.
  const slotUrl = envPublic && e.slot ? `https://slot-${e.slot}.${envPublic}` : null;

  const card = el('div', { class: 'card' });
  const titleNode = el('div', { class: 'card-title' }, slug, ' ',
    el('span', { class: 'badge ready', text: 'live' }),
  );
  // ROK-1331 M5b — pin badge (📌) rides along env-registry's `pinned` field
  // (M5a writer). The gc-sweeper skips pinned envs; this surfaces that to
  // the operator at a glance. Tooltip explains the semantic.
  if (e.pinned === true) {
    const pinBadge = el('span', { class: 'pin-badge', text: '📌' });
    pinBadge.title = 'Pinned — gc-sweeper will not reap this env even if unhealthy';
    titleNode.appendChild(pinBadge);
  }
  card.appendChild(titleNode);
  card.appendChild(el('div', { class: 'card-row' },
    el('span', { class: 'key', text: 'slot' }),
    el('span', { class: 'val', text: e.slot ?? '—' }),
  ));
  card.appendChild(el('div', { class: 'card-row' },
    el('span', { class: 'key', text: 'ttl' }),
    el('span', { class: 'val', text: e.ttl ?? '—' }),
  ));
  card.appendChild(el('div', { class: 'card-row' },
    el('span', { class: 'key', text: 'touched' }),
    el('span', { class: 'val', text: fmtTime(e.last_touched) }),
  ));

  const actions = el('div', { class: 'actions' });
  // When public URL is available, it's the PRIMARY action — operator and
  // testers see the same URL, and Pi-hole short-circuits the LAN path so
  // there's no Cloudflare round-trip cost on home network. Internal URL
  // is kept as a small fallback for the rare CF/NPM-outage case.
  // Primary "open" URL preference: slot URL > public (per-slug) URL > internal LAN.
  // Slot URL is the one Discord OAuth callbacks are registered against
  // (ROK-1324), so it's the only URL that supports the full feature set
  // — operator pref 2026-05-19 is to default to it everywhere.
  const primaryUrl = slotUrl || publicUrl || internalUrl;
  const ext = el('a', { href: primaryUrl, target: '_blank', rel: 'noopener', text: 'open' });
  // Long-press / right-click copies the URL for sharing with testers.
  ext.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    navigator.clipboard?.writeText(primaryUrl).then(() => {
      ext.textContent = 'copied!';
      setTimeout(() => { ext.textContent = 'open'; }, 1200);
    });
  });
  actions.appendChild(ext);
  // Keep "lan" as a small fallback link for the rare CF/NPM-outage case.
  if (publicUrl) {
    actions.appendChild(el('a', { class: 'secondary', href: internalUrl, target: '_blank', rel: 'noopener', text: 'lan' }));
  }
  card.appendChild(actions);

  // Test plan section — collapsed by default. Expands when the env has a
  // posted plan. Per-step verdicts persist server-side; no LLM-injection
  // surface (verdict is an enum + numeric step id + tester string).
  const planSummary = e._test_plan_summary;
  if (planSummary) {
    card.appendChild(renderTestPlanSection(slug, planSummary));
  }
  return card;
};

// ----- Test plan UI -----

// Tester identity persists in BOTH a cookie (1-year expiry, survives
// most browser-storage-clear scenarios that nuke localStorage) AND
// localStorage (fallback for browsers that block third-party-style
// cookies). First interaction prompts. Empty/cancel returns 'anon'
// without persisting → re-prompts next time, which matches intent
// ("only re-ask if I genuinely don't know who they are").
const TESTER_COOKIE = 'rl-tester-name';
const TESTER_LS = 'rl-tester-name';

const getCookie = (name) => {
  const pair = document.cookie.split('; ').find((s) => s.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.split('=', 2)[1]) : null;
};
const setCookie = (name, value, days) => {
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
  // SameSite=Lax + Secure since we're always behind HTTPS on the public
  // hostname; on LAN http access the Secure flag means the cookie won't
  // be set, but the localStorage fallback covers that path.
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax${secure}`;
};

// Read the stored tester name without prompting. Returns '' if unset.
// ROK-1336 #4: separated from the modal flow so callers can branch on
// "do we already have a name?" instead of being forced through prompt().
const getStoredTesterName = () => {
  const name = getCookie(TESTER_COOKIE) || localStorage.getItem(TESTER_LS) || '';
  if (name) {
    // Mirror to both stores so future reads work even if one gets nuked.
    try { localStorage.setItem(TESTER_LS, name); } catch {}
    if (!getCookie(TESTER_COOKIE)) setCookie(TESTER_COOKIE, name, 365);
  }
  return name;
};

// Persist a freshly-entered tester name to both stores. Sanitises same as
// the old prompt() path.
const setTesterName = (raw) => {
  const name = (raw || '').replace(/[^A-Za-z0-9 _.-]/g, '').slice(0, 50).trim();
  if (name) {
    try { localStorage.setItem(TESTER_LS, name); } catch {}
    setCookie(TESTER_COOKIE, name, 365);
  }
  return name;
};

// Backwards-compat shim — older callers expect a sync name. Returns the
// stored value or 'anon' (NEVER fires the prompt). Submit/comment paths
// should call askTesterNameModal() first to ensure a real name is set.
const getTesterName = () => getStoredTesterName() || 'anon';

// ROK-1336 #4 — replace window.prompt() with an inline modal so mobile
// Safari / Chrome iOS don't silently swallow the request. Returns a Promise
// that resolves to the entered name (string) or null (user cancelled).
// Cancel keeps the existing stored name unchanged.
const askTesterNameModal = () => new Promise((resolve) => {
  document.querySelectorAll('.rl-modal-backdrop').forEach((n) => n.remove());
  const backdrop = el('div', { class: 'rl-modal-backdrop' });
  const modal = el('div', { class: 'rl-modal' });
  modal.appendChild(el('h3', { class: 'rl-modal-title', text: 'Your name' }));
  modal.appendChild(el('p', { class: 'rl-modal-sub',
    text: 'So the agent + operator can see who reported what. Saved on this device for next time.' }));
  const input = el('input', { class: 'rl-modal-input' });
  input.type = 'text';
  input.placeholder = 'e.g. Jake, alice, mobile-tester';
  input.maxLength = 50;
  input.value = getStoredTesterName();
  modal.appendChild(input);
  const actions = el('div', { class: 'rl-modal-actions' });
  const cancelBtn = el('button', { class: 'btn-cancel', text: 'Cancel' });
  const saveBtn = el('button', { class: 'btn-submit', text: 'Save' });
  const close = (val) => { backdrop.remove(); resolve(val); };
  cancelBtn.addEventListener('click', () => close(null));
  saveBtn.addEventListener('click', () => {
    const saved = setTesterName(input.value);
    if (!saved) { input.focus(); return; } // empty/invalid → keep modal open
    close(saved);
  });
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') saveBtn.click(); });
  backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop) close(null); });
  actions.append(cancelBtn, saveBtn);
  modal.appendChild(actions);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  setTimeout(() => input.focus(), 50);
});

// Convenience: returns a name, opening the modal if none is stored. Used
// by submit/comment paths. Resolves to null if user cancels — caller should
// abort the action.
const ensureTesterName = async () => {
  const stored = getStoredTesterName();
  if (stored) return stored;
  const entered = await askTesterNameModal();
  return entered;
};

const renderTestPlanSection = (slug, summary) => {
  // data-slug lets the auto-reset-on-submit helper scope its DOM rewrite to
  // THIS plan's card only. A prior version used document.querySelectorAll
  // unscoped and bled the reset across every env card on the page.
  const section = el('div', { class: 'plan-section' });
  section.dataset.slug = slug;
  const header = el('div', { class: 'plan-header' });
  // Operator preference (2026-05-21): show the plan's actual title here, not
  // the step total + pending counts. Footer already surfaces "N of M drafted"
  // for at-a-glance progress, so the counts in the header were redundant +
  // distracting. Fallback to a step-count line if title is missing.
  const headerText = summary.title || `Test plan (${summary.total} step${summary.total === 1 ? '' : 's'})`;
  header.appendChild(el('span', { class: 'plan-title', text: headerText }));
  section.appendChild(header);

  const stepsDiv = el('div', { class: 'plan-steps', text: 'Loading…' });
  section.appendChild(stepsDiv);

  // Lazy-fetch the full plan on first render of this env card. The
  // /api/state poll only carries the summary; the full step list comes
  // from /api/test-plans/<slug>.
  loadTestPlanInto(slug, stepsDiv);
  return section;
};

// ----- Buffered verdicts (local until Submit) -----
// Tester taps pass/fail/skip → stored in localStorage keyed by
// slug:plan_created_at:step_id. Survives page refreshes. Cleared on
// successful submit OR when a new plan replaces the existing one.
const draftKey = (slug, planCreatedAt) => `rl-test-draft:${slug}:${planCreatedAt}`;

const loadDraft = (slug, planCreatedAt) => {
  try {
    const raw = localStorage.getItem(draftKey(slug, planCreatedAt));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
};

const saveDraft = (slug, planCreatedAt, draft) => {
  try { localStorage.setItem(draftKey(slug, planCreatedAt), JSON.stringify(draft)); }
  catch { /* quota or disabled — degrade silently */ }
};

const clearDraft = (slug, planCreatedAt) => {
  try { localStorage.removeItem(draftKey(slug, planCreatedAt)); } catch {}
};

const renderClearFormHeader = (slug, plan) => {
  const header = el('div', { class: 'plan-top-actions' });
  const btn = el('button', { class: 'btn-clear-form', text: '🧹 Clear form' });
  btn.title = 'Wipe your local draft verdicts on this plan. Server data and previous submissions are not affected.';
  btn.addEventListener('click', () => {
    clearDraft(slug, plan.created_at);
    tick({ force: true });
  });
  header.appendChild(btn);
  return header;
};

const loadTestPlanInto = async (slug, container) => {
  try {
    const r = await fetch(`/api/test-plans/${slug}`, { cache: 'no-store' });
    if (!r.ok) {
      container.textContent = `couldn't load plan (HTTP ${r.status})`;
      return;
    }
    const { plan } = await r.json();
    container.replaceChildren();
    // Load any in-progress draft for THIS plan version.
    const draft = loadDraft(slug, plan.created_at);
    // Mobile-friendly always-visible "clear my form" affordance at the top
    // of the plan. Operator-requested explicitly over the rejected
    // auto-reset-on-submit approach: tester wants control, not surprise.
    // Clicking wipes the local draft only — server verdicts/submissions
    // are not touched; tick({force:true}) re-renders against fresh state.
    container.appendChild(renderClearFormHeader(slug, plan));
    plan.steps.forEach((step) => {
      container.appendChild(renderStep(slug, plan, step, draft));
    });
    // Submit + revision-watermark footer.
    container.appendChild(renderSubmitFooter(slug, plan, draft));
  } catch (err) {
    container.textContent = `fetch failed: ${err.message}`;
  }
};

const lastVerdict = (step) => {
  const last = (step.results ?? []).slice(-1)[0];
  return last ? last.verdict : null;
};

const renderStep = (slug, plan, step, draft) => {
  const row = el('div', { class: 'plan-step' });

  // Sequential lock now considers BOTH server-persisted results AND the
  // current tester's local draft. So tapping step 1 in the draft unlocks
  // step 2 immediately — no need to submit between every step.
  let locked = false;
  for (const s of plan.steps) {
    if (s.id >= step.id) break;
    const hasServerResult = s.results && s.results.length > 0;
    const hasDraft = draft[s.id];
    if (!hasServerResult && !hasDraft) { locked = true; break; }
  }

  const draftVerdict = draft[step.id]; // 'pass' | 'fail' | 'skip' | undefined
  const serverVerdict = lastVerdict(step);
  const effective = draftVerdict || serverVerdict;
  row.classList.add(effective ? `verdict-${effective}` : 'verdict-pending');
  if (draftVerdict) row.classList.add('has-draft');
  if (locked) row.classList.add('locked');

  // Reset is the ONE channel that still POSTs immediately — it's an
  // interrupt asking the agent for help mid-test, not a verdict.
  const pendingReset = (step.reset_requests ?? [])
    .filter((r) => r.status === 'pending').slice(-1)[0];
  if (pendingReset) row.classList.add('reset-pending');

  const idTag = el('span', { class: 'step-id', text: `#${step.id}` });
  const desc = el('div', { class: 'step-desc' });
  const textRow = el('div', { class: 'step-text' });
  // ROK-1326 fix-5: inline URLs in step text + expected become clickable
  // anchors with target=_blank so the tester can jump straight to a deep
  // link without losing the dashboard tab. The agent-authored test plan
  // is the only render path here — tester-authored comments are NOT
  // auto-linkified (they're wrapped <untrusted-tester-comment> + base64,
  // never trust untrusted-source URLs).
  appendWithLinks(textRow, step.description);
  desc.appendChild(textRow);
  if (step.expected) {
    const expectedRow = el('div', { class: 'step-expected' });
    expectedRow.appendChild(document.createTextNode('expected: '));
    appendWithLinks(expectedRow, step.expected);
    desc.appendChild(expectedRow);
  }
  if (step.test_url) {
    // Explicit "Link to test" affordance on its own line below the step
    // description. Inline "↗" was hard to spot on mobile + had a tiny tap
    // target wedged into the text flow. Block-level button is unambiguous.
    const link = el('a', {
      href: step.test_url, target: '_blank', rel: 'noopener',
      class: 'step-link', text: '🔗 Link to test',
    });
    link.title = `Open: ${step.test_url}`;
    desc.appendChild(link);
  }
  if (pendingReset) {
    desc.appendChild(el('div', { class: 'step-reset-banner',
      text: `↻ reset requested by ${pendingReset.tester} — agent will reset & post a new plan` }));
  }

  const buttons = el('div', { class: 'step-buttons' });
  const passBtn = el('button', { class: 'btn-pass', text: '✓ pass' });
  const failBtn = el('button', { class: 'btn-fail', text: '✗ fail' });
  const skipBtn = el('button', { class: 'btn-skip', text: '~ skip' });
  if (draftVerdict === 'pass') passBtn.classList.add('selected');
  if (draftVerdict === 'fail') failBtn.classList.add('selected');
  if (draftVerdict === 'skip') skipBtn.classList.add('selected');
  const resetBtn = step.reset_hint ? el('button', { class: 'btn-reset', text: '↻ reset' }) : null;
  if (resetBtn) {
    resetBtn.title = `Request agent reset — ${step.reset_hint}`;
    if (pendingReset) {
      resetBtn.disabled = true;
      resetBtn.title = 'Reset already requested — waiting for the agent';
    } else {
      resetBtn.addEventListener('click', () => requestReset(slug, step.id));
    }
  }

  // ROK-1326 fix-9 / ROK-1331 M6b chunk-4: ALWAYS attach click listeners
  // regardless of lock state. The disabled attribute alone prevents
  // interaction; this lets bufferVerdict patch the DOM in-place
  // (toggle .disabled, .locked, .selected) without needing to re-render
  // to attach listeners to newly-unlocked buttons. Full re-render (via
  // tick({force:true}) → replaceChildren) DOES discard prior nodes —
  // GC handles those orphaned listeners — but we avoid that path on the
  // common verdict-buffer route because replaceChildren scroll-jumps to
  // top on mobile (operator-flagged 2026-05-19). In-place patch keeps
  // the existing DOM nodes + listeners; re-render is the safety net.
  // Belt-and-suspenders for mobile sticky-state: blur the button after click
  // so it doesn't carry :focus into the post-tap render. The hover state is
  // gated separately via @media (hover: hover) in style.css.
  const onVerdict = (verdict) => (ev) => {
    ev.currentTarget?.blur();
    bufferVerdict(slug, plan, step.id, verdict);
  };
  passBtn.addEventListener('click', onVerdict('pass'));
  failBtn.addEventListener('click', onVerdict('fail'));
  skipBtn.addEventListener('click', onVerdict('skip'));
  if (locked || pendingReset) {
    passBtn.disabled = true; failBtn.disabled = true; skipBtn.disabled = true;
    const reason = pendingReset
      ? 'A reset is in flight — wait for the agent to post a new plan.'
      : 'Complete the prior steps first (set a verdict in the draft).';
    passBtn.title = failBtn.title = skipBtn.title = reason;
  }
  buttons.append(passBtn, failBtn, skipBtn);
  if (resetBtn) buttons.appendChild(resetBtn);

  // Comment button — always shown. Tester writes a free-form note +
  // optional screenshot; both flow to the agent's next status read in
  // a wrapped form (treated as data, not instructions).
  const commentBtn = el('button', { class: 'btn-comment', text: '💬 comment' });
  commentBtn.title = 'Add a note (multi-line) + optional screenshot.';
  commentBtn.addEventListener('click', () => promptComment(slug, step.id));
  buttons.appendChild(commentBtn);

  if (step.results?.length) {
    const hist = el('div', { class: 'step-history' });
    step.results.slice(-3).forEach((r) => {
      hist.appendChild(el('span', { class: `hist-${r.verdict}`,
        text: `${r.tester}: ${r.verdict}` }));
    });
    desc.appendChild(hist);
  }

  row.append(idTag, desc, buttons);
  return row;
};

const bufferVerdict = (slug, plan, stepId, verdict) => {
  const draft = loadDraft(slug, plan.created_at);
  // Toggle: tapping the same verdict again clears it (so testers can undo
  // before submitting). Tapping a different verdict overrides.
  if (draft[stepId] === verdict) delete draft[stepId];
  else draft[stepId] = verdict;
  saveDraft(slug, plan.created_at, draft);
  // ROK-1326 fix-9 (mobile fix): in-place DOM patch instead of
  // tick({force:true}) which rebuilds the entire DOM via replaceChildren
  // and resets scrollY on mobile (operator confirmed v1/v2/v3 attempts
  // all failed on mobile despite working on desktop). The patch only
  // toggles class/disabled state — no DOM swap, no scroll jump possible.
  patchPlanInPlace(slug, plan, draft);
};

// In-place DOM update for the plan card. Recomputes the cumulative lock
// state (a step is locked if any prior step has neither a server result
// nor a draft) and updates each .plan-step row's:
//   - verdict-{pass|fail|skip|pending} class
//   - has-draft class
//   - locked class
//   - per-button .selected class
//   - per-button .disabled attribute + title
// Also updates the plan footer's draft count + submit button enabled
// state. Falls back to a full re-render if the DOM doesn't match the
// plan shape (e.g., the user replaced the plan via a different tab).
const patchPlanInPlace = (slug, plan, draft) => {
  const rows = [...document.querySelectorAll('.plan-step')];
  if (rows.length !== plan.steps.length) {
    tick({ force: true });
    return;
  }
  // Compute the first step that has no server result and no draft.
  // Steps AT or BEFORE this index are unlocked; steps AFTER are locked.
  let firstUnsetIdx = plan.steps.length;
  for (let i = 0; i < plan.steps.length; i++) {
    const s = plan.steps[i];
    const hasServer = s.results && s.results.length > 0;
    const hasDraft = !!draft[s.id];
    if (!hasServer && !hasDraft) { firstUnsetIdx = i; break; }
  }
  const VERDICT_CLASSES = ['verdict-pass', 'verdict-fail', 'verdict-skip', 'verdict-pending'];
  const VERDICTS = ['pass', 'fail', 'skip'];
  plan.steps.forEach((step, i) => {
    const row = rows[i];
    const draftVerdict = draft[step.id];
    const serverVerdict = lastVerdict(step);
    const effective = draftVerdict || serverVerdict;
    row.classList.remove(...VERDICT_CLASSES);
    row.classList.add(effective ? `verdict-${effective}` : 'verdict-pending');
    row.classList.toggle('has-draft', !!draftVerdict);
    // pendingReset stays as the server told us — patch shouldn't touch it.
    // ROK-1331 M6b chunk-4: WHY read pendingReset from the CSS class
    // instead of plan.steps[i].reset_requests? The patch path runs on
    // every verdict tick to keep DOM/data in sync without a full re-
    // render. Server-pushed reset signals only arrive via a fresh plan
    // payload (re-render) or a reset-toggle tick that ALREADY flipped
    // .reset-pending on the row. Reading the class keeps patchPlanInPlace
    // pure-DOM with no plan-data lookup. Accurate today; revisit when/if
    // reset signals become live-pushed without a re-render.
    const pendingReset = row.classList.contains('reset-pending');
    const locked = i > firstUnsetIdx || pendingReset;
    row.classList.toggle('locked', locked);
    VERDICTS.forEach((v) => {
      const btn = row.querySelector('.btn-' + v);
      if (!btn) return;
      btn.classList.toggle('selected', !locked && draftVerdict === v);
      btn.disabled = locked;
      btn.title = locked
        ? (pendingReset
            ? 'A reset is in flight — wait for the agent to post a new plan.'
            : 'Complete the prior steps first (set a verdict in the draft).')
        : '';
    });
  });
  // Footer: draft count + submit button enabled state.
  const draftCount = Object.keys(draft).length;
  const totalSteps = plan.steps.length;
  const footerStatus = document.querySelector('.plan-footer-status');
  if (footerStatus) {
    if (draftCount === 0) {
      footerStatus.textContent = 'Tap pass/fail/skip on each step. Nothing sent until you Submit.';
    } else {
      const allMarked = plan.steps.every((s) => draft[s.id] || (s.results && s.results.length > 0));
      footerStatus.textContent = `${draftCount} of ${totalSteps} drafted — ${allMarked ? 'ready to submit' : 'tap the remaining steps then Submit'}`;
    }
  }
  const submitBtn = document.querySelector('.btn-submit');
  if (submitBtn) {
    submitBtn.disabled = draftCount === 0;
    // F5 fix: submit title doesn't otherwise reset when draftCount toggles back to 0.
    submitBtn.title = draftCount === 0
      ? 'No draft verdicts yet — tap a step button first'
      : '';
  }
  // F6 fix: Clear-draft button is rendered conditionally in the original
  // render() path (only when draftCount > 0). When patchPlanInPlace makes
  // draftCount drop back to 0 (tester toggled their last draft off),
  // the button would otherwise linger. Remove it inline; the next full
  // render() (on submit / clear) will re-create it if needed.
  if (draftCount === 0) {
    document.querySelector('.btn-clear-draft')?.remove();
  }
};

const renderSubmitFooter = (slug, plan, draft) => {
  const footer = el('div', { class: 'plan-footer' });
  const draftCount = Object.keys(draft).length;
  const totalSteps = plan.steps.length;
  const allMarked = plan.steps.every(
    (s) => draft[s.id] || (s.results && s.results.length > 0),
  );

  const statusLine = el('div', { class: 'plan-footer-status' });
  if (draftCount === 0) {
    statusLine.textContent = 'Tap pass/fail/skip on each step. Nothing sent until you Submit.';
  } else {
    statusLine.textContent = `${draftCount} of ${totalSteps} drafted — ${allMarked ? 'ready to submit' : 'tap the remaining steps then Submit'}`;
  }
  footer.appendChild(statusLine);

  const actions = el('div', { class: 'plan-footer-actions' });
  const submitBtn = el('button', { class: 'btn-submit', text: 'Submit test results' });
  submitBtn.disabled = draftCount === 0;
  if (draftCount === 0) submitBtn.title = 'No draft verdicts yet — tap a step button first';
  // ROK-1336 #4 follow-up — always read draft FRESH from localStorage at
  // click time, not the closure-captured one from footer-render time. The
  // patchPlanInPlace DOM patcher updates localStorage on every bufferVerdict
  // but does NOT re-bind this listener, so without the fresh load the submit
  // fires with the stale empty draft → verdicts.length === 0 → silent return.
  // (Bug existed pre-1336 — surfaced once item #4's prompt() fix let the
  // submit path actually run end-to-end on mobile.)
  submitBtn.addEventListener('click', () => {
    const freshDraft = loadDraft(slug, plan.created_at);
    submitDraft(slug, plan, freshDraft);
  });
  actions.appendChild(submitBtn);
  if (draftCount > 0) {
    const clearBtn = el('button', { class: 'btn-clear-draft', text: 'Clear draft' });
    clearBtn.addEventListener('click', () => { clearDraft(slug, plan.created_at); tick({ force: true }); });
    actions.appendChild(clearBtn);
  }
  footer.appendChild(actions);

  // Submission history — small, last 3 entries, so testers see "round 1
  // already submitted by Jake at 8:32pm — yours will be round 2".
  if (plan.submissions?.length) {
    const subs = el('div', { class: 'plan-submissions' });
    subs.appendChild(el('div', { class: 'subs-label', text: 'Recent submissions:' }));
    plan.submissions.slice(-3).forEach((sub) => {
      const summary = Object.entries(sub.verdicts)
        .map(([k, v]) => `${v}${k[0]}`).join(' ');
      subs.appendChild(el('div', { class: 'subs-entry',
        text: `${sub.tester} · ${fmtTime(sub.ts)} · ${summary}` }));
    });
    footer.appendChild(subs);
  }
  return footer;
};

// Auto-reset a single plan card after a successful submit. Scoped by slug
// via the [data-slug] attribute on .plan-section — a prior un-scoped version
// of this helper bled its DOM rewrite across every env card on the page,
// which is the buggy build the operator had reverted. Re-rendering through
// loadTestPlanInto here keeps the lock/verdict logic in one place (renderStep)
// instead of duplicating it in a DOM patcher.
const resetPlanCardVisuals = (slug) => {
  const section = document.querySelector(`.plan-section[data-slug="${CSS.escape(slug)}"]`);
  if (!section) return;
  const stepsDiv = section.querySelector('.plan-steps');
  if (!stepsDiv) return;
  loadTestPlanInto(slug, stepsDiv);
};

// ROK-1336 #4 follow-up — top-of-viewport toast helper. 3s self-dismiss.
// Reused for the post-submit success ack so testers + operator see "yep,
// it went". No framework, no audio, just a styled div.
const showToast = (message, kind = 'success') => {
  document.querySelectorAll('.rl-toast').forEach((n) => n.remove());
  const toast = el('div', { class: `rl-toast rl-toast-${kind}`, text: message });
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('rl-toast-fade'), 2700);
  setTimeout(() => toast.remove(), 3300);
};

const submitDraft = async (slug, plan, draft) => {
  // ROK-1336 #4 — ensure a real tester name (opens in-page modal, not
  // window.prompt). If user cancels the modal, abort the submit silently —
  // they explicitly chose not to identify and we don't want a phantom
  // 'anon' verdict landing on the plan.
  const tester = await ensureTesterName();
  if (!tester) return;
  const verdicts = Object.entries(draft).map(([stepId, verdict]) => ({
    step_id: parseInt(stepId, 10), verdict,
  }));
  if (verdicts.length === 0) {
    // Caller had a stale closure with empty draft AND localStorage was also
    // empty. Surface this loudly instead of the old silent-return.
    showToast('No verdicts drafted yet — tap pass/fail/skip on a step first.', 'warn');
    return;
  }
  // ROK-1336 #4 follow-up — loading state on the submit button so testers
  // see immediate feedback their tap registered. Pre-fix this was silent
  // until the fetch resolved, which on mobile + slow LTE looked like a
  // dead tap → multiple frantic re-taps (each fires another fetch).
  const submitBtn = document.querySelector('.btn-submit');
  const origLabel = submitBtn?.textContent;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';
  }
  try {
    const r = await fetch(`/api/test-plans/${slug}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tester, verdicts }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      if (r.status === 404 && (j.error || '').includes('no plan')) {
        showToast('This test env was reaped — draft cleared.', 'error');
        clearDraft(slug, plan.created_at);
        tick({ force: true });
        return;
      }
      showToast(`Submit failed: ${j.error || `HTTP ${r.status}`}`, 'error');
      return;
    }
    // Clear local draft + auto-reset this plan's card + refresh fleet state.
    // resetPlanCardVisuals re-renders THIS section only so the form snaps
    // back to neutral immediately; tick({force:true}) re-polls /api/state
    // so the env card's counts + recent-submissions row update too.
    clearDraft(slug, plan.created_at);
    resetPlanCardVisuals(slug);
    tick({ force: true });
    showToast(`Submitted ${verdicts.length} verdict${verdicts.length === 1 ? '' : 's'} as ${tester}.`, 'success');
  } catch (err) {
    showToast(`Network error: ${(err && (err.message || err.toString())) || 'unknown'}.`, 'error');
  } finally {
    // Restore button state regardless of outcome. If the fetch succeeded,
    // tick({force:true}) above re-rendered the footer (button replaced
    // entirely) so this is a no-op; if we hit a non-tick path (early
    // 404-reap / generic error / network error) the button stays in the
    // DOM and we need to un-disable it so the user can retry.
    const stillThere = document.querySelector('.btn-submit');
    if (stillThere && stillThere === submitBtn) {
      stillThere.disabled = false;
      if (origLabel) stillThere.textContent = origLabel;
    }
  }
};

// Comment modal: multi-line textarea + optional screenshot upload.
// Built inline (no framework) to avoid bloating the zero-dep dashboard.
// Submission flow: if screenshot picked, upload it first (returns a URL),
// then POST the comment with body + attachment_url. Tester gets a clean
// "sent" confirmation. The agent sees the body wrapped in
// <untrusted-tester-comment> tags + the attachment URL (which they can
// fetch via the Read tool if they need to see the screenshot).
const openCommentModal = (slug, stepId) => {
  // Strip any existing modal first (defensive — tap-spamming).
  document.querySelectorAll('.rl-modal-backdrop').forEach((n) => n.remove());

  const backdrop = el('div', { class: 'rl-modal-backdrop' });
  const modal = el('div', { class: 'rl-modal' });
  modal.appendChild(el('h3', { class: 'rl-modal-title', text: `Comment on step #${stepId}` }));
  modal.appendChild(el('p', { class: 'rl-modal-sub',
    text: 'Notes go to the agent + operator. Treated as data — agent will not execute instructions inside.' }));

  const textarea = el('textarea', { class: 'rl-modal-textarea' });
  textarea.placeholder = 'What did you see? Anything weird, surprising, or worth flagging…';
  textarea.rows = 6;
  modal.appendChild(textarea);

  // Screenshot upload row
  const fileRow = el('div', { class: 'rl-modal-filerow' });
  const fileLabel = el('label', { class: 'rl-modal-filebtn' });
  fileLabel.textContent = '📷 attach screenshot';
  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/png,image/jpeg,image/webp';
  fileInput.style.display = 'none';
  fileLabel.appendChild(fileInput);
  fileRow.appendChild(fileLabel);
  const fileName = el('span', { class: 'rl-modal-filename', text: '' });
  fileRow.appendChild(fileName);
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    fileName.textContent = f ? `${f.name} (${Math.round(f.size / 1024)} KB)` : '';
  });
  modal.appendChild(fileRow);

  const actions = el('div', { class: 'rl-modal-actions' });
  const cancelBtn = el('button', { class: 'btn-cancel', text: 'Cancel' });
  const submitBtn = el('button', { class: 'btn-submit', text: 'Send' });
  cancelBtn.addEventListener('click', () => backdrop.remove());
  submitBtn.addEventListener('click', async () => {
    const body = textarea.value.trim();
    const file = fileInput.files?.[0];
    if (!body && !file) {
      alert('Add a note, an image, or both.');
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';
    try {
      let attachmentUrl = null;
      if (file) {
        if (file.size > 5 * 1024 * 1024) {
          alert('Screenshot too large (max 5 MB).');
          submitBtn.disabled = false; submitBtn.textContent = 'Send';
          return;
        }
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const upRes = await fetch(`/api/test-plans/${slug}/attachment`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tester: getTesterName(),
            filename: file.name,
            mime: file.type,
            data: dataUrl,
          }),
        });
        if (!upRes.ok) {
          const j = await upRes.json().catch(() => ({}));
          alert(`Upload failed: ${j.error || `HTTP ${upRes.status}`}`);
          submitBtn.disabled = false; submitBtn.textContent = 'Send';
          return;
        }
        const upJ = await upRes.json();
        attachmentUrl = upJ.url;
      }
      const cRes = await fetch(`/api/test-plans/${slug}/step/${stepId}/comment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tester: getTesterName(),
          body,
          attachment_url: attachmentUrl,
        }),
      });
      if (!cRes.ok) {
        const j = await cRes.json().catch(() => ({}));
        if (cRes.status === 404 && (j.error || '').includes('no plan')) {
          alert('This test env was reaped (most likely the API was unhealthy long enough for the sweeper to clean it up). Your draft is gone. Refreshing the dashboard now.');
          backdrop.remove();
          tick({ force: true });
          return;
        }
        alert(`Comment failed: ${j.error || `HTTP ${cRes.status}`}`);
        submitBtn.disabled = false; submitBtn.textContent = 'Send';
        return;
      }
      backdrop.remove();
    } catch (err) {
      alert(`Network error: ${(err && (err.message || err.toString())) || 'unknown (no message)'}. The env or dashboard may be down. Try refreshing.`);
      submitBtn.disabled = false; submitBtn.textContent = 'Send';
    }
  });
  actions.append(cancelBtn, submitBtn);
  modal.appendChild(actions);

  backdrop.appendChild(modal);
  backdrop.addEventListener('click', (ev) => {
    if (ev.target === backdrop) backdrop.remove();
  });
  document.body.appendChild(backdrop);
  textarea.focus();
};

// Keep the old name as a thin alias so existing call sites (the
// comment button click handler) don't need to change.
const promptComment = (slug, stepId) => openCommentModal(slug, stepId);

const requestReset = async (slug, stepId) => {
  const tester = getTesterName();
  if (!confirm('Request the agent reset this step? They\'ll see the request and may post a new plan with the step ready to re-test.')) return;
  try {
    const r = await fetch(`/api/test-plans/${slug}/step/${stepId}/reset-request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tester }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      if (r.status === 404 && (j.error || '').includes('no plan')) {
        alert('This test env was reaped — refresh.');
        tick({ force: true });
        return;
      }
      alert(`Reset failed: ${j.error || `HTTP ${r.status}`}`);
      return;
    }
    tick({ force: true });
  } catch (err) {
    alert(`Network error: ${(err && (err.message || err.toString())) || 'unknown (no message)'}. The env or dashboard may be down. Try refreshing.`);
  }
};

const renderEmpty = (msg) => el('div', { class: 'empty', text: msg });

const render = (data) => {
  // ROK-1326 fix-9 (final): preserve scroll position across re-renders by
  // PINNING the containers' min-height to their current height BEFORE
  // the replaceChildren swap. Without this, even an atomic
  // replaceChildren(...newCards) collapses the container briefly
  // (Chrome processes it as remove-then-add internally), the document
  // height dips, the browser clamps scrollY to the new max (often 0),
  // and any subsequent scrollTo doesn't visually take effect because
  // the layout has already settled at the clamped position.
  //
  // Earlier attempts (v1 sync scrollTo; v2 atomic-replaceChildren + rAF)
  // verified via Chrome MCP: scrollY 713 → 0 across the swap, scrollTo
  // afterward read 0 unchanged. Verified by [render] diagnostic logs.
  //
  // Pin → swap → unpin on next animation frame so the cards' real
  // height takes over. Document height never dips.
  const slotsDiv = $('slots');
  const envsDiv = $('envs');
  const slotsH = slotsDiv.offsetHeight;
  const envsH = envsDiv.offsetHeight;
  slotsDiv.style.minHeight = slotsH + 'px';
  envsDiv.style.minHeight = envsH + 'px';

  const activeTasks = data.active_tasks ?? [];
  const leaseQueues = data.lease_queues ?? [];
  const slotCards = (data.slots ?? []).map((s) => renderSlot(s, activeTasks, leaseQueues));
  if (!slotCards.length) slotCards.push(renderEmpty('No slots configured.'));
  slotsDiv.replaceChildren(...slotCards);

  const envCards = (data.envs ?? []).map((e) => renderEnv(e, data.public_domain));
  if (!envCards.length) {
    envCards.push(renderEmpty('No test envs running. Use `rl env spin <slug>` from the operator shell or the rl_env_spin MCP tool.'));
  }
  envsDiv.replaceChildren(...envCards);
  $('env-count').textContent = data.envs?.length ? `· ${data.envs.length}` : '';

  $('generated-at').textContent = `updated ${fmtTime(data.generated_at)}`;

  // Drop the min-height pin after layout has had a chance to compute
  // the new natural height. rAF fires after the next style+layout
  // pass — by then the cards have rendered at their natural height.
  requestAnimationFrame(() => {
    slotsDiv.style.minHeight = '';
    envsDiv.style.minHeight = '';
  });
};

const setStatus = (state) => {
  const indicator = $('refresh-indicator');
  indicator.classList.remove('error', 'pulse', 'paused');
  if (state === 'error') indicator.classList.add('error');
  else if (state === 'paused') indicator.classList.add('paused');
  else if (state === 'ok') {
    void indicator.offsetWidth; // restart animation
    indicator.classList.add('pulse');
  }
};

// True if the tester has any unsent verdicts in localStorage for any plan.
// Auto-refresh checks this before re-rendering; manual interactions
// (submit, clear, reset) bypass via tick({ force: true }).
const hasAnyDraft = () => {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('rl-test-draft:')) {
        const raw = localStorage.getItem(k);
        if (raw && raw !== '{}' && Object.keys(JSON.parse(raw)).length > 0) return true;
      }
    }
  } catch { /* localStorage disabled or corrupt — assume no draft */ }
  return false;
};

// Track recent user activity so auto-refresh defers when the tester is
// scrolling/touching. Auto-tick that fires within 8s of activity is
// skipped (paused indicator). Manual ticks (force:true) always run.
let lastActivityAt = 0;
const recordActivity = () => { lastActivityAt = Date.now(); };
window.addEventListener('scroll', recordActivity, { passive: true });
window.addEventListener('touchstart', recordActivity, { passive: true });
window.addEventListener('mousemove', recordActivity, { passive: true });
window.addEventListener('keydown', recordActivity, { passive: true });

const tick = async (opts = {}) => {
  // Skip auto-ticks when:
  //   - a draft is in flight (replaceChildren would wipe selected buttons), OR
  //   - the user has touched/scrolled in the last 8s (avoid scroll-position
  //     jumps mid-read; common when reading test plan steps on a phone).
  // Manual ticks (force:true) always run.
  if (!opts.force) {
    if (hasAnyDraft()) { setStatus('paused'); return; }
    if (Date.now() - lastActivityAt < 8000) { setStatus('paused'); return; }
  }
  try {
    const r = await fetch('/api/state', { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    // Preserve scroll across the replaceChildren-based render. Even when
    // the DOM is identical shape, replaceChildren forces a reset to (0,0)
    // — bad for testers reading mid-page. Save & restore.
    const scroll = { x: window.scrollX, y: window.scrollY };
    render(data);
    window.scrollTo(scroll.x, scroll.y);
    setStatus('ok');
  } catch (err) {
    setStatus('error');
    // Render a recovery placeholder so the page isn't just BLANK after a
    // failed initial fetch (which is what users see post-pull-down-reload
    // if the fetch fails for any reason — bfcache quirks, network blip,
    // etc.). The slots / envs sections both render a clickable retry.
    const retry = () => tick({ force: true });
    [$('slots'), $('envs')].forEach((div) => {
      if (!div) return;
      // Only paint the recovery state if the section is currently empty
      // (don't wipe a previously-rendered card just because a follow-up
      // tick failed).
      if (div.children.length === 0) {
        div.replaceChildren();
        const msg = el('div', { class: 'empty',
          text: 'Failed to fetch fleet state. Tap to retry.' });
        msg.style.cursor = 'pointer';
        msg.addEventListener('click', retry);
        div.appendChild(msg);
      }
    });
    // eslint-disable-next-line no-console
    console.warn('fetch failed', err);
  }
};

// Infra cards (Traefik/Grafana/Registry) are LAN-only because those services
// aren't exposed externally for security. Show the section ONLY when the
// dashboard was loaded via the .rl.lan hostname.
if (isLan) {
  $('infra-section').style.display = '';
}

// Auto-refresh DISABLED (operator pref 2026-05-19) — the periodic
// re-render was disrupting mid-test reading. Refreshes now via:
//   - Initial page load (force, so the activity-defer doesn't suppress it)
//   - Browser native pull-to-refresh (triggers a full reload → pageshow
//     handler fires → force tick → fresh render)
//   - Tap the refresh indicator dot in the header
tick({ force: true });
const refreshDot = $('refresh-indicator');
if (refreshDot) {
  refreshDot.style.cursor = 'pointer';
  refreshDot.title = 'Tap to refresh (auto-refresh disabled)';
  refreshDot.addEventListener('click', () => tick({ force: true }));
}
// pageshow fires on both fresh page load and bfcache restore (back/forward
// nav, mobile reload). Without this, bfcache-restored pages would show
// the cached pre-reload DOM until the user manually tapped the dot.
window.addEventListener('pageshow', (ev) => {
  if (ev.persisted) tick({ force: true });
});

// Pull-to-refresh removed 2026-05-19 — the custom gesture handler was
// causing an empty-dashboard render in incognito sessions (reproducible).
// Browser-native pull-to-refresh on iOS Safari / Chrome triggers a full
// page reload instead — drafts in localStorage survive a reload, so
// nothing's lost. The header refresh dot is also tappable as the
// explicit one-tap alternative.

// Relabel running-task elapsed every second WITHOUT re-fetching /api/state.
// Auto-refresh is disabled, so without this the elapsed text would freeze
// between manual ticks. Only touches .task-elapsed text under running rows.
const updateElapsedLabels = () => {
  const rows = document.querySelectorAll('.task-row.task-row-running');
  rows.forEach((row) => {
    const startedAt = row.getAttribute('data-started-at');
    if (!startedAt) return;
    const startedMs = Date.parse(startedAt);
    if (!Number.isFinite(startedMs)) return;
    const seconds = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
    const elapsedEl = row.querySelector('.task-elapsed');
    if (elapsedEl) elapsedEl.textContent = `(${fmtElapsed(seconds)})`;
  });
};

// ROK-1331 M5b — re-render TTL countdown text every second on the spans
// emitted by renderSlot. Auto-refresh of /api/state is disabled, so without
// this the countdown would freeze between manual ticks. Only touches the
// text of `.claim-ttl[data-expires-at]` spans; no fetch, no replaceChildren.
const updateTtlLabels = () => {
  const nodes = document.querySelectorAll('.claim-ttl[data-expires-at]');
  nodes.forEach((node) => {
    const expiresAt = node.getAttribute('data-expires-at');
    const next = fmtCountdown(expiresAt);
    if (node.textContent !== next) node.textContent = next;
    if (next === 'expired') node.classList.add('expired');
    else node.classList.remove('expired');
  });
};
// Skip the 1s tick under jsdom — without this guard, the Node test runner
// stays alive past assertion completion because jsdom-backed setInterval
// keeps a real Node Timeout for each loaded fixture.
const isJsdom = typeof navigator !== 'undefined'
  && typeof navigator.userAgent === 'string'
  && navigator.userAgent.includes('jsdom');
if (!isJsdom) {
  setInterval(updateElapsedLabels, 1000);
  setInterval(updateTtlLabels, 1000);
}

// Test surface — expose internal helpers under window.__rlTest so the
// jsdom-driven test harness can drive renderSlot / appendWithLinks /
// fmtElapsed without a build step. No behavior change for prod.
if (typeof window !== 'undefined') {
  window.__rlTest = { renderSlot, appendWithLinks, fmtElapsed };
}
