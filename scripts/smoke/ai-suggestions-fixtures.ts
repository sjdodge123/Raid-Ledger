/**
 * Fixture helpers for the AI-suggestion smoke (ROK-1110).
 *
 * The real suggestion pipeline is an LLM round-trip behind a BullMQ pre-gen
 * job — untestable from Playwright. `POST /admin/test/ai-suggestions/seed`
 * writes the cache row the read path serves instead, so the payload the grid
 * blends is fixed by the test rather than by a model.
 */
import type { AiSuggestionDto } from '@raid-ledger/contract';
import { API_BASE, apiGet, apiPost } from './api-helpers';

/**
 * A complete `AiSuggestionDto` with inert defaults. Every field the contract
 * requires is present so the server-side `AiSuggestionSchema` parse can never
 * be the reason a seed fails — a test overrides only what it asserts on.
 */
export function buildSuggestion(
  overrides: Partial<AiSuggestionDto> & Pick<AiSuggestionDto, 'gameId' | 'name'>,
): AiSuggestionDto {
  return {
    slug: `ai-fixture-${overrides.gameId}`,
    coverUrl: null,
    confidence: 0.9,
    reasoning: 'Seeded fixture reasoning',
    ownershipCount: 0,
    voterTotal: 0,
    communityOwnerCount: 0,
    wishlistCount: 0,
    nonOwnerPrice: null,
    itadCurrentCut: null,
    itadCurrentShop: null,
    itadCurrentUrl: null,
    earlyAccess: false,
    itadTags: [],
    playerCount: null,
    ...overrides,
  };
}

/** Seed the suggestions cache row for one lineup. */
export async function seedAiSuggestions(
  token: string,
  lineupId: number,
  suggestions: AiSuggestionDto[],
): Promise<void> {
  const res = await apiPost(token, '/admin/test/ai-suggestions/seed', {
    lineupId,
    suggestions,
  });
  // apiPost does not throw on a non-2xx. A refused seed (403 outside
  // DEMO_MODE, 404 lineup, 400 schema) must fail HERE with its own body, not
  // later as an unexplained missing chip.
  if (res?.success !== true) {
    throw new Error(
      `seed AI suggestions for lineup ${lineupId} failed: ${JSON.stringify(res)}`,
    );
  }
}

/** Teardown — drops every cached suggestions row for the lineup. */
export async function clearAiSuggestions(
  token: string,
  lineupId: number,
): Promise<void> {
  await apiPost(token, '/admin/test/ai-suggestions/clear', { lineupId });
}

/**
 * Install + activate the `ai` plugin via the real admin plugin API (the same
 * idempotent pattern `dynamic-categories.smoke.spec.ts` uses). CI and fresh
 * fleet envs boot with the manifest registered but no `plugins` row, so every
 * AI affordance is hidden by `useAiSuggestionsAvailable` until this runs.
 *
 * No LLM provider is needed: the suggestions read is served from the seeded
 * cache row. The plugin is deliberately left active afterwards — the desktop
 * and mobile workers share one API, so a teardown deactivate by one worker
 * would pull the surface out from under the other mid-test.
 */
async function ensureAiPluginActive(token: string): Promise<void> {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  const installRes = await fetch(`${API_BASE}/admin/plugins/ai/install`, {
    method: 'POST',
    headers,
  });
  if (installRes.ok) return;
  // 400 = already installed (activate covers "installed but deactivated").
  // Anything else may be the sibling worker winning the install race —
  // `install` is check-then-insert, so the loser can hit the slug unique
  // key. Either way the row now exists, so activate decides.
  const activateRes = await fetch(`${API_BASE}/admin/plugins/ai/activate`, {
    method: 'POST',
    headers,
  });
  if (!activateRes.ok) {
    throw new Error(
      `failed to enable AI plugin: install ${installRes.status}, activate ${activateRes.status}`,
    );
  }
}

/**
 * Make the AI surface render on this env, or say loudly why it cannot.
 *
 * `useAiSuggestionsAvailable` gates every AI affordance on (1) the `ai` plugin
 * being active and (2) the `ai_suggestions_enabled` admin toggle not being
 * explicitly `false`. (1) is enabled here and then VERIFIED through the same
 * `/system/status.activePlugins` the web reads — a plugin that will not
 * activate is a failure, never a skip. (2) defaults to true; an explicit
 * `false` is an operator setting this spec will not override, so it is the
 * one skip, and the returned reason names it.
 *
 * @returns `null` when the surface is available, else the skip reason.
 */
export async function enableAiSurface(token: string): Promise<string | null> {
  await ensureAiPluginActive(token);
  const status = await apiGet(token, '/system/status');
  const active: string[] = status?.activePlugins ?? [];
  if (!active.includes('ai')) {
    throw new Error(
      `AI plugin install/activate returned OK but /system/status.activePlugins is ${JSON.stringify(active)}`,
    );
  }
  const features = await apiGet(token, '/admin/ai/features');
  if (features?.aiSuggestionsEnabled === false) {
    return 'SKIPPED — ai_suggestions_enabled is explicitly false on this env (an admin turned AI suggestions off); the spec does not override operator settings';
  }
  return null;
}
