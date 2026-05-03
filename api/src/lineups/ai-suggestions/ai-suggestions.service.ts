import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { AiSuggestionsResponseDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { SettingsService } from '../../settings/settings.service';
import { LlmService } from '../../ai/llm.service';
import { AI_DEFAULTS, AI_SETTING_KEYS } from '../../ai/llm.constants';
import { GameTasteService } from '../../game-taste/game-taste.service';
import * as schema from '../../drizzle/schema';
import {
  resolveVoterScope,
  type ResolvedVoterScope,
  type VoterScopeLineup,
} from './voter-scope.helpers';
import {
  buildCandidatePool,
  loadCandidateContext,
  minimumPlayerCount,
  type CandidateContext,
} from './candidate-pool.helpers';
import { buildSuggestionPrompt } from './prompt-builder.helpers';
import { loadVoterProfiles } from './voter-profile.helpers';
import { loadRecentWinners } from './recent-winners.helpers';
import { callAndParseLlmOutput, LLM_FEATURE_TAG } from './llm-output.helpers';
import { enrichSuggestions } from './enrichment.helpers';
import {
  findLatestByHash,
  upsertSuggestion,
  isFresh,
  FRESH_TTL_MS,
  EMPTY_TTL_MS,
} from './cache.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Options passed from the controller. */
export interface GetSuggestionsOpts {
  personalizeUserId?: number;
}

@Injectable()
export class AiSuggestionsService {
  private readonly logger = new Logger(AiSuggestionsService.name);
  private readonly inFlight = new Map<
    string,
    Promise<AiSuggestionsResponseDto>
  >();

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly llmService: LlmService,
    private readonly gameTaste: GameTasteService,
  ) {}

  /**
   * Public entry point called from the controller. Delegates to
   * `getOrGenerate` with stampede dedupe keyed on lineupId + hash.
   *
   * Returns an empty payload (without calling the LLM) when admins have
   * disabled the feature via `ai_suggestions_enabled = 'false'`. The UI
   * collapses on empty success, hiding the section entirely (ROK-1114
   * round 3).
   */
  async getSuggestions(
    lineupId: number,
    opts: GetSuggestionsOpts = {},
  ): Promise<AiSuggestionsResponseDto> {
    const lineup = await this.loadLineup(lineupId);
    if (await this.isFeatureDisabled()) {
      return this.emptyResponse();
    }
    const scope = await resolveVoterScope(this.db, lineup, {
      personalizeUserId: opts.personalizeUserId,
    });
    const key = `${lineupId}:${scope.hash}`;
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const promise = this.getOrGenerate(lineup, scope).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  private async isFeatureDisabled(): Promise<boolean> {
    const value = await this.settings.get(AI_SETTING_KEYS.SUGGESTIONS_ENABLED);
    return value === 'false';
  }

  private emptyResponse(): AiSuggestionsResponseDto {
    return {
      suggestions: [],
      generatedAt: new Date().toISOString(),
      voterCount: 0,
      voterScopeStrategy: 'community',
      cached: false,
    } satisfies AiSuggestionsResponseDto;
  }

  private async loadLineup(lineupId: number): Promise<
    VoterScopeLineup & {
      status: string;
    }
  > {
    const [row] = await this.db
      .select({
        id: schema.communityLineups.id,
        visibility: schema.communityLineups.visibility,
        status: schema.communityLineups.status,
      })
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, lineupId))
      .limit(1);
    if (!row) throw new NotFoundException(`Lineup ${lineupId} not found`);
    if (row.status !== 'building') {
      throw new ConflictException(
        `Lineup ${lineupId} is not in building status (status=${row.status})`,
      );
    }
    return row;
  }

  private async getOrGenerate(
    lineup: VoterScopeLineup,
    scope: ResolvedVoterScope,
  ): Promise<AiSuggestionsResponseDto> {
    const cached = await findLatestByHash(this.db, lineup.id, scope.hash);
    if (cached) {
      const ttl =
        (cached.payload.suggestions ?? []).length > 0
          ? FRESH_TTL_MS
          : EMPTY_TTL_MS;
      if (isFresh(cached.generatedAt, ttl)) {
        return { ...cached.payload, cached: true };
      }
    }
    return this.generateFresh(lineup, scope);
  }

  private async generateFresh(
    lineup: VoterScopeLineup,
    scope: ResolvedVoterScope,
  ): Promise<AiSuggestionsResponseDto> {
    const { provider, model } = await this.activeProviderInfo();
    const candidates = await buildCandidatePool(
      this.db,
      this.gameTaste,
      scope.userIds,
      lineup.id,
      scope.strategy,
    );
    if (candidates.length === 0) {
      return this.persistAndReturn(lineup.id, scope, [], provider, model);
    }
    const context = await loadCandidateContext(
      this.db,
      candidates,
      scope.userIds,
    );
    const suggestions = await this.runLlmPass(scope, context);
    const enriched = await enrichSuggestions(
      this.db,
      suggestions,
      new Set(context.map((c) => c.gameId)),
      scope.userIds,
    );
    return this.persistAndReturn(lineup.id, scope, enriched, provider, model);
  }

  private async runLlmPass(
    scope: ResolvedVoterScope,
    candidates: CandidateContext[],
  ): ReturnType<typeof callAndParseLlmOutput> {
    // Option E (2026-04-22): feed the curator per-voter profiles and
    // recent winners instead of just a centroid, so the LLM can reason
    // about individuals + history rather than rubber-stamping the
    // vector-ranked order.
    const [voterProfiles, recentWinners] = await Promise.all([
      loadVoterProfiles(this.db, scope.userIds),
      loadRecentWinners(this.db),
    ]);
    const options = buildSuggestionPrompt({
      strategy: scope.strategy,
      voterCount: scope.userIds.length,
      minPlayerCount: minimumPlayerCount(scope.userIds.length, scope.strategy),
      voterProfiles,
      recentWinners,
      candidates,
    });
    return callAndParseLlmOutput(this.llmService, options, {
      feature: LLM_FEATURE_TAG,
    });
  }

  private async persistAndReturn(
    lineupId: number,
    scope: ResolvedVoterScope,
    suggestions: AiSuggestionsResponseDto['suggestions'],
    provider: string,
    model: string,
  ): Promise<AiSuggestionsResponseDto> {
    const payload = {
      suggestions,
      generatedAt: new Date().toISOString(),
      voterCount: scope.userIds.length,
      voterScopeStrategy: scope.strategy,
    };
    try {
      await upsertSuggestion(this.db, {
        lineupId,
        voterSetHash: scope.hash,
        payload,
        provider,
        model,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to persist suggestions for ${lineupId}: ${msg}`);
    }
    return { ...payload, cached: false };
  }

  private async activeProviderInfo(): Promise<{
    provider: string;
    model: string;
  }> {
    const provider =
      (await this.settings.get(AI_SETTING_KEYS.PROVIDER as never)) ??
      (await this.llmService.getActiveProviderKey()) ??
      'unknown';
    const model =
      (await this.settings.get(AI_SETTING_KEYS.MODEL as never)) ??
      AI_DEFAULTS.model;
    return { provider, model };
  }
}
