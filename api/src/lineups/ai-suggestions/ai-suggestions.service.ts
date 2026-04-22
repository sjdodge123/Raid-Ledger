import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
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
  type CandidateContext,
} from './candidate-pool.helpers';
import {
  buildSuggestionPrompt,
  computeCentroidAxes,
} from './prompt-builder.helpers';
import {
  callAndParseLlmOutput,
  LLM_FEATURE_TAG,
} from './llm-output.helpers';
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
   */
  async getSuggestions(
    lineupId: number,
    opts: GetSuggestionsOpts = {},
  ): Promise<AiSuggestionsResponseDto> {
    const lineup = await this.loadLineup(lineupId);
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

  private async loadLineup(lineupId: number): Promise<VoterScopeLineup & {
    status: string;
  }> {
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
    );
    if (candidates.length === 0) {
      return this.persistAndReturn(lineup.id, scope, [], provider, model);
    }
    const context = await loadCandidateContext(this.db, candidates);
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
    const voterVectors = await this.loadVoterDimensions(scope.userIds);
    const centroid = computeCentroidAxes(voterVectors);
    const options = buildSuggestionPrompt({
      strategy: scope.strategy,
      voterCount: scope.userIds.length,
      centroidAxes: centroid,
      candidates,
    });
    return callAndParseLlmOutput(this.llmService, options, {
      feature: LLM_FEATURE_TAG,
    });
  }

  private async loadVoterDimensions(
    userIds: number[],
  ): Promise<Record<string, number>[]> {
    if (userIds.length === 0) return [];
    const rows = await this.db
      .select({ dimensions: schema.playerTasteVectors.dimensions })
      .from(schema.playerTasteVectors)
      .where(inArray(schema.playerTasteVectors.userId, userIds));
    return rows.map(
      (r) => r.dimensions as unknown as Record<string, number>,
    );
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
      AI_DEFAULTS.provider;
    const model =
      (await this.settings.get(AI_SETTING_KEYS.MODEL as never)) ??
      AI_DEFAULTS.model;
    return { provider, model };
  }
}
