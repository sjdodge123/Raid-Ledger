/**
 * Fixture helpers for the AI-suggestion smoke (ROK-1110).
 *
 * The real suggestion pipeline is an LLM round-trip behind a BullMQ pre-gen
 * job — untestable from Playwright. `POST /admin/test/ai-suggestions/seed`
 * writes the cache row the read path serves instead, so the payload the grid
 * blends is fixed by the test rather than by a model.
 */
import type { AiSuggestionDto } from '@raid-ledger/contract';
import { apiGet, apiPost } from './api-helpers';

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
  await apiPost(token, '/admin/test/ai-suggestions/seed', {
    lineupId,
    suggestions,
  });
}

/** Teardown — drops every cached suggestions row for the lineup. */
export async function clearAiSuggestions(
  token: string,
  lineupId: number,
): Promise<void> {
  await apiPost(token, '/admin/test/ai-suggestions/clear', { lineupId });
}

/**
 * Whether the AI surface can render at all on this env.
 *
 * `useAiSuggestionsAvailable` gates every AI affordance on the `ai` plugin
 * being active AND the `ai_suggestions_enabled` admin toggle. On an env where
 * the plugin was never installed the chip, the "Suggested for you" row and the
 * `useAiSuggestions` fetch are all absent by design — that is correct product
 * behaviour, not a regression, so the spec skips rather than fails.
 */
export async function aiSurfaceAvailable(token: string): Promise<boolean> {
  const status = await apiGet(token, '/system/status');
  const active: string[] = status?.activePlugins ?? [];
  if (!active.includes('ai')) return false;
  const features = await apiGet(token, '/admin/ai/features');
  return features?.aiSuggestionsEnabled !== false;
}
