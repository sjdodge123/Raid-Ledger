import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { LlmCategoryProposalDto } from '@raid-ledger/contract';
import type { LlmService } from '../../ai/llm.service';
import type { SettingsService } from '../../settings/settings.service';
import * as schema from '../../drizzle/schema';
import { SETTING_KEYS } from '../../drizzle/schema';
import { resolveCandidates } from '../candidate-resolver';
import { buildGenerationPrompt } from '../prompt-builder.helpers';
import { callAndParseCategoryProposals } from '../llm-output.helpers';
import { blendVectors } from '../vector-blend.helpers';
import {
  loadCommunityCentroid,
  loadExistingApprovedCategories,
  loadTopPlayedLastMonth,
  loadTrending,
} from './context-loaders';
import { buildGenerationContext } from './context-build';

type Db = PostgresJsDatabase<typeof schema>;

export interface GenerateDeps {
  llmService: LlmService;
  settingsService: SettingsService;
  logger?: Logger;
  now?: Date;
}

const DEFAULT_BLEND_ALPHA = 0.7;
const DEFAULT_CANDIDATE_COUNT = 20;
const DEFAULT_MAX_PENDING = 10;
const TOP_PLAYED_N = 8;
const TRENDING_N = 8;
const MAX_PROPOSALS = 5;

async function readNumberSetting(
  settings: SettingsService,
  key: (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS],
  fallback: number,
): Promise<number> {
  const raw = await settings.get(key);
  const parsed = raw == null ? NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function isFeatureEnabled(deps: GenerateDeps): Promise<boolean> {
  const flag = await deps.settingsService.get(
    SETTING_KEYS.AI_DYNAMIC_CATEGORIES_ENABLED,
  );
  if (flag !== 'true') {
    deps.logger?.warn(
      'dynamic_categories: skipping — feature flag is disabled',
    );
    return false;
  }
  const available = await deps.llmService.isAvailable().catch(() => false);
  if (!available) {
    deps.logger?.warn(
      'dynamic_categories: skipping — no reachable LLM provider',
    );
    return false;
  }
  return true;
}

async function countPending(db: Db): Promise<number> {
  const rows = await db
    .select({ id: schema.discoveryCategorySuggestions.id })
    .from(schema.discoveryCategorySuggestions)
    .where(eq(schema.discoveryCategorySuggestions.status, 'pending'));
  return rows.length;
}

function proposalToThemeArray(proposal: LlmCategoryProposalDto): number[] {
  const v = proposal.theme_vector;
  return [v.co_op, v.pvp, v.rpg, v.survival, v.strategy, v.social, v.mmo];
}

async function insertProposal(
  db: Db,
  proposal: LlmCategoryProposalDto,
  blendedVector: number[],
  candidateIds: number[],
): Promise<void> {
  await db.insert(schema.discoveryCategorySuggestions).values({
    name: proposal.name,
    description: proposal.description,
    categoryType: proposal.category_type,
    themeVector: blendedVector,
    filterCriteria: proposal.filter_criteria ?? {},
    candidateGameIds: candidateIds,
    status: 'pending',
    populationStrategy: proposal.population_strategy,
    expiresAt: proposal.expires_at ? new Date(proposal.expires_at) : null,
  });
}

/**
 * Run the weekly LLM-backed generation pass. Guard-rails:
 *   - feature gate (active provider + AI_DYNAMIC_CATEGORIES_ENABLED),
 *   - max_pending quota skip,
 *   - LLM-unreachable catch does NOT touch approved rows.
 * Returns the number of newly inserted pending suggestions.
 */
export async function runGenerateSuggestions(
  db: Db,
  deps: GenerateDeps,
): Promise<number> {
  if (!(await isFeatureEnabled(deps))) return 0;

  const maxPending = await readNumberSetting(
    deps.settingsService,
    SETTING_KEYS.DYNAMIC_CATEGORIES_MAX_PENDING,
    DEFAULT_MAX_PENDING,
  );
  const pending = await countPending(db);
  if (pending >= maxPending) {
    deps.logger?.warn(
      `dynamic_categories: skipping — pending quota ${pending}/${maxPending} reached`,
    );
    return 0;
  }

  const context = buildGenerationContext(
    {
      centroid: await loadCommunityCentroid(db),
      topPlayed: await loadTopPlayedLastMonth(db, TOP_PLAYED_N),
      trending: await loadTrending(db, TRENDING_N),
      existingCategories: await loadExistingApprovedCategories(db),
    },
    deps.now ?? new Date(),
    MAX_PROPOSALS,
  );
  return runLlmAndInsert(db, deps, context);
}

async function runLlmAndInsert(
  db: Db,
  deps: GenerateDeps,
  context: ReturnType<typeof buildGenerationContext>,
): Promise<number> {
  const options = buildGenerationPrompt(context);
  let proposals: LlmCategoryProposalDto[];
  try {
    proposals = await callAndParseCategoryProposals(
      deps.llmService,
      options,
      { feature: 'dynamic_categories' },
      deps.logger,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.logger?.warn(
      `dynamic_categories: LLM unavailable, skipping generation — ${msg}`,
    );
    return 0;
  }
  if (proposals.length === 0) return 0;
  return insertAllProposals(db, deps, proposals, context.centroid);
}

async function insertAllProposals(
  db: Db,
  deps: GenerateDeps,
  proposals: LlmCategoryProposalDto[],
  centroid: number[] | null,
): Promise<number> {
  const alpha = await readNumberSetting(
    deps.settingsService,
    SETTING_KEYS.DYNAMIC_CATEGORIES_THEME_CENTROID_BLEND,
    DEFAULT_BLEND_ALPHA,
  );
  const candidateCount = await readNumberSetting(
    deps.settingsService,
    SETTING_KEYS.DYNAMIC_CATEGORIES_CANDIDATE_COUNT,
    DEFAULT_CANDIDATE_COUNT,
  );
  let inserted = 0;
  for (const proposal of proposals) {
    const themeArr = proposalToThemeArray(proposal);
    const blended = blendVectors(themeArr, centroid, alpha);
    const fc = (proposal.filter_criteria ?? {}) as Record<string, unknown>;
    const genreIds = extractIdArray(fc, 'genre_ids');
    const themeIds = extractIdArray(fc, 'theme_ids');
    const tags = extractStringArray(fc, 'genre_tags');
    const candidates =
      proposal.population_strategy === 'fixed'
        ? []
        : await resolveCandidates(db, blended, {
            limit: candidateCount,
            genreIds,
            themeIds,
            tags,
          });
    try {
      await insertProposal(db, proposal, blended, candidates);
      inserted += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger?.warn(
        `dynamic_categories: failed to insert "${proposal.name}" — ${msg}`,
      );
    }
  }
  return inserted;
}

function extractIdArray(
  filterCriteria: Record<string, unknown>,
  key: string,
): number[] | undefined {
  const raw = filterCriteria[key];
  if (!Array.isArray(raw)) return undefined;
  const ids = raw.filter((v): v is number => typeof v === 'number');
  return ids.length > 0 ? ids : undefined;
}

function extractStringArray(
  filterCriteria: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const raw = filterCriteria[key];
  if (!Array.isArray(raw)) return undefined;
  const tags = raw.filter((v): v is string => typeof v === 'string');
  return tags.length > 0 ? tags : undefined;
}
