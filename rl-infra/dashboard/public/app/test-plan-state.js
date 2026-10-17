// ROK-1337 — Tester-page state derivation (pure functions).
//
// Lives on window.__rlTester so the test-plan-render / test-plan-submit
// modules can call into it without ES modules (the dashboard is zero-build,
// every public/*.js loads as a plain <script>).
//
// Functions here MUST be pure — no DOM, no fetch, no localStorage. They
// take a plans[] array (shape returned by GET /api/test-plans/{slug}) and
// derive the per-tab UI state: which plan is "NOW", which are "ALSO",
// which are "DONE TODAY", and what the status pill should say.

(function attachTesterState() {
  const NS = (window.__rlTester = window.__rlTester || {});

  // Helper — a step has a "verdict" iff the last entry in step.results
  // exists. Submissions are recorded server-side as plan.submissions[]
  // and per-step results[] (most-recent-wins).
  const stepIsVerdicted = (step) =>
    Array.isArray(step?.results) && step.results.length > 0;

  // "Pending" means the plan has any step lacking a verdict.
  const planIsPending = (plan) => {
    if (!plan || !Array.isArray(plan.steps)) return false;
    return plan.steps.some((s) => !stepIsVerdicted(s));
  };

  // "Submitted today" — plan has every step verdicted AND at least one
  // submission entry whose ts is within the last 24h.
  const planIsDoneToday = (plan, nowMs) => {
    if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) return false;
    if (plan.steps.some((s) => !stepIsVerdicted(s))) return false;
    const submissions = Array.isArray(plan.submissions) ? plan.submissions : [];
    if (submissions.length === 0) return false;
    const lastTs = submissions[submissions.length - 1]?.ts;
    if (!lastTs) return false;
    const t = Date.parse(lastTs);
    if (!Number.isFinite(t)) return false;
    return nowMs - t < 24 * 60 * 60 * 1000;
  };

  // Aggregate {pass, fail, skip, pending} counts for a plan. Used by the
  // dot-row + done-today rows.
  const summarize = (plan) => {
    const out = { pass: 0, fail: 0, skip: 0, pending: 0, total: 0 };
    if (!plan || !Array.isArray(plan.steps)) return out;
    out.total = plan.steps.length;
    for (const step of plan.steps) {
      const last = (step.results || []).slice(-1)[0];
      if (!last) { out.pending += 1; continue; }
      if (last.verdict === 'pass') out.pass += 1;
      else if (last.verdict === 'fail') out.fail += 1;
      else if (last.verdict === 'skip') out.skip += 1;
    }
    return out;
  };

  // NOW = plan with the oldest un-verdicted step (i.e. lowest
  // first-pending step.results.length === 0 entry, broken ties by
  // plan.created_at ascending). If stickyId is set AND matches a still-
  // pending plan, that's the NOW (sticky once tester taps in).
  // Returns null if no pending plans exist.
  const pickNowPlan = (plans, stickyPlanId) => {
    const pending = (plans || []).filter(planIsPending);
    if (pending.length === 0) return null;
    if (stickyPlanId) {
      const sticky = pending.find((p) => p.plan_id === stickyPlanId);
      if (sticky) return sticky;
    }
    // Sort by created_at ascending so the OLDEST pending plan wins.
    const sorted = [...pending].sort((a, b) =>
      String(a.created_at || '').localeCompare(String(b.created_at || '')),
    );
    return sorted[0];
  };

  // Bucket plans into {now, also, doneToday, other}. `other` covers any
  // plan that's done but >24h old (we keep them out of the visible
  // sections; they'd just be noise).
  const bucketPlans = (plans, stickyPlanId, nowMs = Date.now()) => {
    const now = pickNowPlan(plans || [], stickyPlanId);
    const nowId = now?.plan_id;
    const also = [];
    const doneToday = [];
    const other = [];
    for (const plan of plans || []) {
      if (plan.plan_id === nowId) continue;
      if (planIsDoneToday(plan, nowMs)) {
        doneToday.push(plan);
        continue;
      }
      if (planIsPending(plan)) {
        also.push(plan);
      } else {
        other.push(plan);
      }
    }
    // Sort ALSO oldest-first (consistent with NOW's selection rule), DONE
    // newest-first (most recent submission at the top).
    also.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
    doneToday.sort((a, b) => {
      const ta = a.submissions?.slice(-1)[0]?.ts || a.created_at || '';
      const tb = b.submissions?.slice(-1)[0]?.ts || b.created_at || '';
      return String(tb).localeCompare(String(ta));
    });
    return { now, also, doneToday, other };
  };

  // Pill state machine. Returns {kind, label, showRefresh} where kind ∈
  //   pending  — amber, primary working state (≥1 pending verdict somewhere)
  //   slate    — submitted/parked (focused plan was just submitted)
  //   green    — all caught up (every plan completed today)
  //   gray     — waiting (no plans at all)
  //   refresh  — server changed since last fetch (refresh available)
  const derivePillState = (
    { plans = [], focusedPlanId = null, submittedPlanId = null, refreshAvailable = false, nowMs = Date.now() } = {},
  ) => {
    if (refreshAvailable) {
      return { kind: 'refresh', label: 'Plan updated', showRefresh: true };
    }
    if (!plans || plans.length === 0) {
      return { kind: 'gray', label: 'No active plans', showRefresh: false };
    }
    const buckets = bucketPlans(plans, focusedPlanId, nowMs);
    // If a plan was just submitted (slate state) AND there's nothing
    // pending, we sit in slate "awaiting re-test" until the next change.
    if (submittedPlanId && !buckets.now && !buckets.also.length) {
      return { kind: 'slate', label: 'Submitted — awaiting re-test', showRefresh: false };
    }
    if (buckets.now) {
      const summary = summarize(buckets.now);
      return {
        kind: 'pending',
        label: `${summary.pending} of ${summary.total} steps need a verdict`,
        showRefresh: false,
      };
    }
    // No pending plans at all. Count what cleared today.
    const cleared = buckets.doneToday.length;
    return {
      kind: 'green',
      label: cleared > 0
        ? `All caught up · ${cleared} cleared today`
        : 'All caught up',
      showRefresh: false,
    };
  };

  // Per-tab localStorage key — scoped to (slug, plan_id) so two browser
  // tabs on the SAME slug pointing at DIFFERENT plans can't trample each
  // other's drafts.
  const draftKey = (slug, planId) => `rl-test-draft-v2:${slug}:${planId}`;

  // Sticky-NOW key — when the tester explicitly promotes an ALSO card
  // to NOW, we remember that choice per-slug so a render doesn't yank
  // the focus back to a different (older-pending) plan. Cleared when
  // the sticky plan completes/submits.
  const stickyKey = (slug) => `rl-test-sticky-now-v2:${slug}`;

  // Last-known aggregate timestamp for refresh-available detection. The
  // polling layer writes this when it successfully renders, then compares
  // on the next visibility tick.
  const baselineKey = (slug) => `rl-test-baseline-v2:${slug}`;

  Object.assign(NS, {
    // Pure derivations
    stepIsVerdicted, planIsPending, planIsDoneToday, summarize,
    pickNowPlan, bucketPlans, derivePillState,
    // localStorage key helpers
    draftKey, stickyKey, baselineKey,
  });
})();
