/**
 * Shared LLM generation core (ROK-1316).
 *
 * Extracted so BOTH the request-path service (now only for the legacy
 * empty/disabled responses) and the background pre-gen processor run the
 * exact same pipeline: candidate pool → curator prompt → parse → enrich →
 * upsert. The request thread NEVER calls this (it would block on Gemini);
 * only the BullMQ processor does.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { AiSuggestionsResponseDto } from '@raid-ledger/contract';
import type { LlmService } from '../../ai/llm.service';
import type { GameTasteService } from '../../game-taste/game-taste.service';
import type { SettingsService } from '../../settings/settings.service';
import { AI_DEFAULTS, AI_SETTING_KEYS } from '../../ai/llm.constants';
import * as schema from '../../drizzle/schema';
import {
  type ResolvedVoterScope,
  type VoterScopeLineup,
} from './voter-scope.helpers';
import {
  buildCandidatePool,
  loadCandidateContext,
  minimumPlayerCount,
} from './candidate-pool.helpers';
import { buildSuggestionPrompt } from './prompt-builder.helpers';
import { loadVoterProfiles } from './voter-profile.helpers';
import { loadRecentWinners } from './recent-winners.helpers';
import { callAndParseLlmOutput, LLM_FEATURE_TAG } from './llm-output.helpers';
import { enrichSuggestions } from './enrichment.helpers';
import { upsertSuggestion, type StoredPayload } from './cache.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Collaborators the generation pipeline needs. */
export interface GenerateDeps {
  db: Db;
  settings: SettingsService;
  llmService: LlmService;
  gameTaste: GameTasteService;
}

/** Resolve the active provider + model for telemetry / cache provenance. */
export async function activeProviderInfo(
  deps: GenerateDeps,
): Promise<{ provider: string; model: string }> {
  const provider =
    (await deps.settings.get(AI_SETTING_KEYS.PROVIDER)) ??
    (await deps.llmService.getActiveProviderKey()) ??
    'unknown';
  const model =
    (await deps.settings.get(AI_SETTING_KEYS.MODEL)) ?? AI_DEFAULTS.model;
  return { provider, model };
}

/** Build the stored payload + return DTO from a finished suggestion set. */
function buildPayload(
  scope: ResolvedVoterScope,
  suggestions: AiSuggestionsResponseDto['suggestions'],
): StoredPayload {
  return {
    suggestions,
    generatedAt: new Date().toISOString(),
    voterCount: scope.userIds.length,
    voterScopeStrategy: scope.strategy,
  };
}

/** Run the curator LLM pass for a resolved voter scope + candidate context. */
async function runLlmPass(
  deps: GenerateDeps,
  scope: ResolvedVoterScope,
  candidates: Awaited<ReturnType<typeof loadCandidateContext>>,
): ReturnType<typeof callAndParseLlmOutput> {
  const [voterProfiles, recentWinners] = await Promise.all([
    loadVoterProfiles(deps.db, scope.userIds),
    loadRecentWinners(deps.db),
  ]);
  const options = buildSuggestionPrompt({
    strategy: scope.strategy,
    voterCount: scope.userIds.length,
    minPlayerCount: minimumPlayerCount(scope.userIds.length, scope.strategy),
    voterProfiles,
    recentWinners,
    candidates,
  });
  return callAndParseLlmOutput(deps.llmService, options, {
    feature: LLM_FEATURE_TAG,
  });
}

/**
 * Generate fresh suggestions for a lineup + voter scope, persist them, and
 * prune old rows. Writes a row even for empty results so pending polling
 * terminates. Returns the response DTO (`cached: false`).
 */
export async function generateAndPersist(
  deps: GenerateDeps,
  lineup: VoterScopeLineup,
  scope: ResolvedVoterScope,
): Promise<AiSuggestionsResponseDto> {
  const { provider, model } = await activeProviderInfo(deps);
  const candidates = await buildCandidatePool(
    deps.db,
    deps.gameTaste,
    scope.userIds,
    lineup.id,
    scope.strategy,
  );
  let enriched: AiSuggestionsResponseDto['suggestions'] = [];
  if (candidates.length > 0) {
    const context = await loadCandidateContext(
      deps.db,
      candidates,
      scope.userIds,
    );
    const suggestions = await runLlmPass(deps, scope, context);
    enriched = await enrichSuggestions(
      deps.db,
      suggestions,
      new Set(context.map((c) => c.gameId)),
      scope.userIds,
    );
  }
  const payload = buildPayload(scope, enriched);
  await upsertSuggestion(deps.db, {
    lineupId: lineup.id,
    voterSetHash: scope.hash,
    payload,
    provider,
    model,
  });
  return { ...payload, cached: false };
}
