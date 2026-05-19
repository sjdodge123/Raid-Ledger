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

const getTesterName = () => {
  // Prefer cookie (more persistent), fall back to localStorage.
  let name = getCookie(TESTER_COOKIE) || localStorage.getItem(TESTER_LS);
  if (!name) {
    name = prompt('Your name (so the agent + operator can see who reported what):', '') || '';
    name = name.replace(/[^A-Za-z0-9 _.-]/g, '').slice(0, 50).trim();
    if (name) {
      try { localStorage.setItem(TESTER_LS, name); } catch {}
      setCookie(TESTER_COOKIE, name, 365);
    }
  } else {
    // Mirror to both stores so future reads work even if one gets nuked.
    try { localStorage.setItem(TESTER_LS, name); } catch {}
    if (!getCookie(TESTER_COOKIE)) setCookie(TESTER_COOKIE, name, 365);
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
      if (r.status === 404 && (j.error || '').includes('no plan')) {
        alert('This test env was reaped — your draft can no longer be submitted. Clearing draft + refreshing.');
        clearDraft(slug, plan.created_at);
        tick({ force: true });
        return;
      }
      alert(`Submit failed: ${j.error || `HTTP ${r.status}`}`);
      return;
    }
    // Clear local draft + refresh. Plan stays on server until agent
    // posts a replacement (which they may do automatically based on
    // the verdicts they just received).
    clearDraft(slug, plan.created_at);
    tick({ force: true });
  } catch (err) {
    alert(`Network error: ${(err && (err.message || err.toString())) || 'unknown (no message)'}. The env or dashboard may be down. Try refreshing.`);
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
