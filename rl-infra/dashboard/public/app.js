// rl-fleet dashboard — fetches /api/state and renders cards. Auto-refreshes
// every REFRESH_MS, but PAUSES whenever a tester has any unsent draft
// verdicts (replaceChildren during a refresh would wipe scroll/focus and
// make checkboxes feel jumpy). Resumes after Submit or Clear draft.

const REFRESH_MS = 15000;

const $ = (id) => document.getElementById(id);
const el = (tag, opts = {}, ...children) => {
  const node = document.createElement(tag);
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

const renderSlot = (s) => {
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
  card.appendChild(el('div', { class: 'card-title' }, slug, ' ',
    el('span', { class: 'badge ready', text: 'live' }),
  ));
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

// Tester identity persists in localStorage; first interaction prompts.
const getTesterName = () => {
  let name = localStorage.getItem('rl-tester-name');
  if (!name) {
    name = prompt('Your name (so the agent can see who reported what):', '') || '';
    name = name.replace(/[^A-Za-z0-9 _.-]/g, '').slice(0, 50).trim();
    if (name) localStorage.setItem('rl-tester-name', name);
  }
  return name || 'anon';
};

const verdictBadge = (counts) => {
  // Small badge that summarizes the plan's verdict counts at a glance.
  const parts = [];
  if (counts.pass) parts.push(`${counts.pass}✓`);
  if (counts.fail) parts.push(`${counts.fail}✗`);
  if (counts.skip) parts.push(`${counts.skip}~`);
  if (counts.pending) parts.push(`${counts.pending}?`);
  return parts.join(' ') || '0 steps';
};

const renderTestPlanSection = (slug, summary) => {
  const section = el('div', { class: 'plan-section' });
  const header = el('div', { class: 'plan-header' });
  const totalLabel = `Test plan (${summary.total})`;
  header.appendChild(el('span', { class: 'plan-title', text: totalLabel }));
  header.appendChild(el('span', { class: 'plan-counts', text: verdictBadge(summary) }));
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
  textRow.appendChild(document.createTextNode(step.description));
  if (step.test_url) {
    const link = el('a', {
      href: step.test_url, target: '_blank', rel: 'noopener',
      class: 'step-link', text: ' ↗',
    });
    link.title = `Open: ${step.test_url}`;
    textRow.appendChild(link);
  }
  desc.appendChild(textRow);
  if (step.expected) desc.appendChild(el('div', { class: 'step-expected', text: `expected: ${step.expected}` }));
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

  if (locked || pendingReset) {
    passBtn.disabled = true; failBtn.disabled = true; skipBtn.disabled = true;
    const reason = pendingReset
      ? 'A reset is in flight — wait for the agent to post a new plan.'
      : 'Complete the prior steps first (set a verdict in the draft).';
    passBtn.title = failBtn.title = skipBtn.title = reason;
  } else {
    // Buffer to localStorage instead of POSTing. Re-renders the section
    // so the next step unlocks visually.
    passBtn.addEventListener('click', () => bufferVerdict(slug, plan, step.id, 'pass'));
    failBtn.addEventListener('click', () => bufferVerdict(slug, plan, step.id, 'fail'));
    skipBtn.addEventListener('click', () => bufferVerdict(slug, plan, step.id, 'skip'));
  }
  buttons.append(passBtn, failBtn, skipBtn);
  if (resetBtn) buttons.appendChild(resetBtn);

  // Comment button — always shown. Free-form text goes server-side
  // but NEVER reaches the LLM (server strips comment bodies from any
  // response the agent's MCP tools read). Operator pulls them later
  // for Linear. Cannot be confused as a verdict — it's just a note.
  const commentBtn = el('button', { class: 'btn-comment', text: '💬 comment' });
  commentBtn.title = 'Add a free-form note. Visible to operator (posted to Linear), NOT sent to the LLM.';
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
  // User explicitly tapped — force a re-render so the selected state
  // shows immediately, bypassing the hasAnyDraft auto-refresh pause.
  tick({ force: true });
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
  submitBtn.addEventListener('click', () => submitDraft(slug, plan, draft));
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

const submitDraft = async (slug, plan, draft) => {
  const tester = getTesterName();
  const verdicts = Object.entries(draft).map(([stepId, verdict]) => ({
    step_id: parseInt(stepId, 10), verdict,
  }));
  if (verdicts.length === 0) return;
  try {
    const r = await fetch(`/api/test-plans/${slug}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tester, verdicts }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(`Submit failed: ${j.error || `HTTP ${r.status}`}`);
      return;
    }
    // Clear local draft + refresh. Plan stays on server until agent
    // posts a replacement (which they may do automatically based on
    // the verdicts they just received).
    clearDraft(slug, plan.created_at);
    tick({ force: true });
  } catch (err) {
    alert(`Network error: ${err.message}`);
  }
};

// Comment prompt: window.prompt is the simplest mobile-friendly modal.
// Body sent server-side; NOT shown back in this dashboard (one-way) so
// the tester gets a fire-and-forget channel — operator pulls for Linear.
const promptComment = async (slug, stepId) => {
  const body = window.prompt(
    'Add a comment for the operator (visible in Linear later, NOT sent to the LLM):',
    '',
  );
  if (body == null) return;
  const trimmed = body.trim();
  if (trimmed.length === 0) return;
  const tester = getTesterName();
  try {
    const r = await fetch(`/api/test-plans/${slug}/step/${stepId}/comment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tester, body: trimmed }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(`Comment failed: ${j.error || `HTTP ${r.status}`}`);
      return;
    }
    // Fire-and-forget — no need to re-render, the body isn't echoed back.
    // Tester just sees the alert below as confirmation.
    alert('Comment sent. The operator will see it in Linear.');
  } catch (err) {
    alert(`Network error: ${err.message}`);
  }
};

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
      alert(`Reset failed: ${j.error || `HTTP ${r.status}`}`);
      return;
    }
    tick({ force: true });
  } catch (err) {
    alert(`Network error: ${err.message}`);
  }
};

const renderEmpty = (msg) => el('div', { class: 'empty', text: msg });

const render = (data) => {
  const slotsDiv = $('slots');
  slotsDiv.replaceChildren();
  for (const s of data.slots ?? []) slotsDiv.appendChild(renderSlot(s));
  if (!data.slots?.length) slotsDiv.appendChild(renderEmpty('No slots configured.'));

  const envsDiv = $('envs');
  envsDiv.replaceChildren();
  $('env-count').textContent = data.envs?.length ? `· ${data.envs.length}` : '';
  if (data.envs?.length) {
    for (const e of data.envs) envsDiv.appendChild(renderEnv(e, data.public_domain));
  } else {
    envsDiv.appendChild(renderEmpty('No test envs running. Use `rl env spin <slug>` from the operator shell or the rl_env_spin MCP tool.'));
  }

  $('generated-at').textContent = `updated ${fmtTime(data.generated_at)}`;
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

const tick = async (opts = {}) => {
  // Skip auto-ticks while a draft is in flight — replaceChildren would
  // wipe scroll position and visually nuke the buttons mid-tap. User-
  // triggered ticks (after submit/clear/reset) pass force:true.
  if (!opts.force && hasAnyDraft()) {
    setStatus('paused');
    return;
  }
  try {
    const r = await fetch('/api/state', { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    render(data);
    setStatus('ok');
  } catch (err) {
    setStatus('error');
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

tick();
setInterval(tick, REFRESH_MS);
