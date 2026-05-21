// ROK-1337 — Tester-page polling + boot.
//
// HARD LOCKED RULE: no setInterval / setTimeout polling for plan changes.
// Refresh fires ONLY on:
//   - Initial load
//   - `document.visibilitychange` → visible
//   - Manual ↻ refresh tap in the status pill
//   - After a successful submit / comment / reset (caller drives)
//
// The bootTesterPage(slug) entrypoint is what app.js dispatches into when
// it sees ?slug=<name> on the URL.

(function attachTesterPolling() {
  const NS = (window.__rlTester = window.__rlTester || {});

  // Per-page in-memory cache. Each render writes the latest server state
  // here so the buffer-verdict callback can re-render without re-fetching.
  let currentSlug = null;
  let currentPlans = [];
  // Slug-scoped sticky-NOW (which ALSO card the tester promoted last).
  // Stored in localStorage so a tab refresh preserves the focused plan.
  let stickyPlanId = null;
  let lastSubmittedPlanId = null;
  // Aggregate baseline from the last successful fetch — used for the
  // refresh-available pill state when the next fetch surfaces a newer
  // last_updated_at.
  let lastBaseline = null;
  // When set, the next render shows the refresh pill instead of the
  // computed state. Cleared on manual refresh.
  let refreshAvailable = false;

  const fetchPlans = async (slug) => {
    const r = await fetch(`/api/test-plans/${encodeURIComponent(slug)}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    return {
      plans: Array.isArray(j.plans) ? j.plans : [],
      last_updated_at: j.last_updated_at || null,
    };
  };

  // ----- Toast (re-uses operator-route classes from style.css) -----
  const toast = (msg, kind = 'success') => {
    document.querySelectorAll('.rl-toast').forEach((n) => n.remove());
    const node = NS.el('div', { class: `rl-toast rl-toast-${kind}`, text: msg });
    document.body.appendChild(node);
    setTimeout(() => node.classList.add('rl-toast-fade'), 2700);
    setTimeout(() => node.remove(), 3300);
  };

  // ----- Render orchestrator -----
  const render = () => {
    const pillRoot = document.getElementById('status-pill');
    const nowRoot = document.getElementById('now-section');
    const alsoRoot = document.getElementById('also-section');
    const doneRoot = document.getElementById('done-section');
    if (!pillRoot || !nowRoot || !alsoRoot || !doneRoot) return;
    const buckets = NS.bucketPlans(currentPlans, stickyPlanId);
    const pillState = NS.derivePillState({
      plans: currentPlans,
      focusedPlanId: buckets.now?.plan_id || null,
      submittedPlanId: lastSubmittedPlanId,
      refreshAvailable,
    });
    const draft = buckets.now
      ? NS.loadDraft(currentSlug, buckets.now.plan_id)
      : {};
    const callbacks = mkCallbacks();
    pillRoot.replaceChildren(NS.renderStatusPill(pillState, async () => {
      refreshAvailable = false;
      await refresh({ resetSubmitted: false });
    }));
    nowRoot.replaceChildren(NS.renderNowSection(buckets.now, draft, callbacks));
    alsoRoot.replaceChildren(NS.renderAlsoSection(buckets.also, callbacks));
    doneRoot.replaceChildren(NS.renderDoneSection(buckets.doneToday, callbacks));
  };

  const mkCallbacks = () => ({
    onVerdict: (plan, stepId, verdict) => {
      NS.bufferVerdict(currentSlug, plan.plan_id, stepId, verdict);
      // Page snap-renders the new draft state — no animation.
      render();
    },
    onSubmit: async (plan) => {
      const r = await NS.submitDraft(currentSlug, plan);
      if (r.cancelled) return;
      if (!r.ok) {
        if (r.empty) toast('No draft verdicts to submit.', 'warn');
        else toast(`Submit failed: ${r.error}`, 'error');
        return;
      }
      lastSubmittedPlanId = plan.plan_id;
      // Clear the sticky-NOW so the next render picks the next pending
      // plan (matches the wireframe's "submit → snap to next" UX).
      stickyPlanId = null;
      try { localStorage.removeItem(NS.stickyKey(currentSlug)); } catch {}
      toast('Submitted.', 'success');
      await refresh({ resetSubmitted: false });
    },
    onComment: async (plan, stepId, body, attachmentUrl) => {
      const r = await NS.postComment(currentSlug, plan, stepId, body, attachmentUrl);
      if (r.cancelled) return;
      if (!r.ok) {
        toast(`Comment failed: ${r.error}`, 'error');
        return;
      }
      toast(attachmentUrl ? 'Screenshot attached.' : 'Comment sent.', 'success');
      await refresh({ resetSubmitted: true });
    },
    onReset: async (plan, stepId) => {
      const r = await NS.requestReset(currentSlug, plan, stepId);
      if (r.cancelled) return;
      if (!r.ok) {
        toast(`Reset failed: ${r.error}`, 'error');
        return;
      }
      toast('Reset requested — the agent will act on it.', 'success');
      await refresh({ resetSubmitted: true });
    },
    onAttach: async (plan, file) => {
      const url = await NS.uploadAttachment(currentSlug, plan, file);
      if (!url) {
        toast('Upload failed (max 5 MB; png/jpg/webp only).', 'error');
        return null;
      }
      return url;
    },
    onPromote: (plan) => {
      stickyPlanId = plan.plan_id;
      try { localStorage.setItem(NS.stickyKey(currentSlug), plan.plan_id); } catch {}
      lastSubmittedPlanId = null;
      // Snap-render with the new focus. Drawer state is wiped (DOM gets
      // rebuilt) — acceptable per locked decision: tester explicitly
      // changed plans, the previous step's drawer was theirs alone.
      render();
    },
  });

  const refresh = async ({ resetSubmitted = true } = {}) => {
    if (!currentSlug) return;
    try {
      const data = await fetchPlans(currentSlug);
      currentPlans = data.plans;
      lastBaseline = data.last_updated_at;
      try { localStorage.setItem(NS.baselineKey(currentSlug), lastBaseline || ''); } catch {}
      refreshAvailable = false;
      if (resetSubmitted) lastSubmittedPlanId = null;
      render();
    } catch (err) {
      const pillRoot = document.getElementById('status-pill');
      if (pillRoot) {
        pillRoot.replaceChildren(
          NS.renderStatusPill({ kind: 'gray', label: `Couldn't load (${err.message})`, showRefresh: true }, () => refresh()),
        );
      }
    }
  };

  // Light-touch visibility check — when the page becomes visible AND the
  // server's aggregate timestamp differs from the one we last rendered,
  // mark refresh-available. We deliberately DO NOT auto-fetch the full
  // plan list on every visibilitychange — the wireframe locks "refresh
  // is a tester-initiated action" so we just flag the pill and let them
  // tap.
  const probeRefreshAvailable = async () => {
    if (!currentSlug) return;
    try {
      const data = await fetchPlans(currentSlug);
      const newBaseline = data.last_updated_at;
      // Codex P2 follow-up — drop the `newBaseline && ` guard so
      // "all plans deleted" (baseline transitions from real-ts → null)
      // also flags refresh. Without this, a tester backgrounds the tab
      // while the agent runs rl_test_plan_clear / env teardown and the
      // stale plan UI persists indefinitely on return.
      if (newBaseline !== lastBaseline) {
        refreshAvailable = true;
        currentPlans = data.plans;
        lastBaseline = newBaseline;
        render();
      }
    } catch {
      /* swallow — operator dot stays as-is */
    }
  };

  // ----- Public entry -----
  const bootTesterPage = async (slug) => {
    currentSlug = slug;
    try {
      stickyPlanId = localStorage.getItem(NS.stickyKey(slug)) || null;
    } catch { stickyPlanId = null; }
    try {
      lastBaseline = localStorage.getItem(NS.baselineKey(slug)) || null;
    } catch { lastBaseline = null; }
    // Show the tester page, hide the operator UI. (index.html ships them
    // both rendered; we toggle visibility here so the no-JS state is a
    // graceful "fleet" landing for the operator.)
    const opMain = document.getElementById('operator-main');
    const opHeader = document.getElementById('operator-header');
    const tester = document.getElementById('tester-page');
    if (opMain) opMain.hidden = true;
    if (opHeader) opHeader.hidden = true;
    if (tester) tester.hidden = false;
    await refresh({ resetSubmitted: true });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      void probeRefreshAvailable();
    });
  };

  Object.assign(NS, {
    bootTesterPage,
    // expose for tests / debug
    _internals: { fetchPlans, refresh, render },
  });
})();
