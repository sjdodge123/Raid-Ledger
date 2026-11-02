// ROK-1900 — test-plan steps that wait on the operator join the inbox (spec D9).
//
// A step joins `plan_steps` when its `category` is `design` or `operator`
// (any case, surrounding whitespace ignored) AND it has no verdict yet; the
// moment a verdict lands it drops out. Read-only: plans are loaded through the
// dashboard's own plan loader (injected), never a second storage path.
//
// PlanStepSummary = {slug, plan_id, story_id, goal, step_id, description,
//                    category, plan_url}
// plan_url is the token-less plan link (same shape rl_test_plan_create
// returns); the operator's inbox key is accepted as the tester credential on
// every plan (D10), so no per-plan `k` is ever put in it.

export const PLAN_STEP_CATEGORY_RE = /^(design|operator)$/i;
const TEXT_MAX = 500;

const text = (v, clean) => (typeof v === 'string' ? clean(v).slice(0, TEXT_MAX) : null);

const hasVerdict = (step) => Array.isArray(step.results) && step.results.length > 0;

export const isOperatorStep = (step) =>
  !!step && typeof step === 'object'
  && typeof step.category === 'string'
  && PLAN_STEP_CATEGORY_RE.test(step.category.trim())
  && !hasVerdict(step);

export const planUrl = (publicDomain, slug, planId) =>
  `${publicDomain ? `https://fleet.${publicDomain}` : 'http://fleet.rl.lan'}`
  + `/?slug=${encodeURIComponent(slug)}&plan=${encodeURIComponent(planId)}`;

// Pure: plans (each carrying slug + plan_id) → PlanStepSummary[], oldest plan
// first, then step order.
export const collectPlanSteps = (plans, { publicDomain = '', clean = (s) => s } = {}) => {
  const out = [];
  const ordered = [...plans].sort((a, b) =>
    String(a?.created_at ?? '').localeCompare(String(b?.created_at ?? '')));
  for (const plan of ordered) {
    if (!plan || !Array.isArray(plan.steps)) continue;
    for (const step of plan.steps) {
      if (!isOperatorStep(step)) continue;
      out.push({
        slug: plan.slug,
        plan_id: plan.plan_id,
        story_id: typeof plan.story_id === 'string' ? plan.story_id : null,
        goal: text(plan.goal, clean),
        step_id: step.id,
        description: text(step.description, clean),
        category: step.category.trim().toLowerCase(),
        plan_url: planUrl(publicDomain, plan.slug, plan.plan_id),
      });
    }
  }
  return out;
};

// listSlugs(): Promise<string[]>, listPlans(slug): Promise<plan[]>. A slug
// that fails to read is skipped, so one bad plan never hides the inbox.
export const createPlanStepSource = ({ listSlugs, listPlans, publicDomain = '', clean }) => async () => {
  let slugs;
  try { slugs = await listSlugs(); } catch { return []; }
  const plans = [];
  for (const slug of slugs) {
    let list;
    try { list = await listPlans(slug); } catch { continue; }
    for (const p of list) plans.push({ ...p, slug });
  }
  return collectPlanSteps(plans, { publicDomain, ...(clean ? { clean } : {}) });
};
