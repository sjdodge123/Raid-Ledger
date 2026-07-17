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
import { AI_SETTING_KEYS } from '../../ai/llm.constants';
import * as schema from '../../drizzle/schema';
import {
  resolveVoterScope,
  type ResolvedVoterScope,
  type VoterScopeLineup,
} from './voter-scope.helpers';
import {
  findLatestByHash,
  findLatestForLineup,
  isFresh,
  FRESH_TTL_MS,
  EMPTY_TTL_MS,
} from './cache.helpers';
import {
  AiSuggestionsPreGenQueueService,
  PREGEN_REQUEST_DELAY_MS,
} from './pre-gen.queue';
import { LlmUnavailableError } from './llm-output.helpers';
import { AiQuotaCooldownService } from './quota-cooldown.service';

type Db = PostgresJsDatabase<typeof schema>;

/** Options passed from the controller. */
export interface GetSuggestionsOpts {
  /**
   * ROK-1316: legacy NominateModal still sends `?personalize=me`. The
   * per-user LLM path is DELETED — this flag now only drives a telemetry
   * line proving the path is served from base suggestions.
   */
  personalize?: boolean;
}

/**
 * Serve-stale-while-revalidate read service (ROK-1316).
 *
 * The request thread NEVER awaits the LLM. It returns whatever the cache
 * holds — fresh hit, stale older-hash row, or an empty `pending` payload —
 * and enqueues a debounced background pre-gen job to warm/refresh the
 * cache. The 60s Gemini round-trip only ever runs inside the BullMQ
 * processor.
 *
 * `LlmService` is injected ONLY for a cheap provider-availability check
 * (`getActiveProviderKey`, registry resolution — no network, no `chat`
 * dispatch) so a cold read with NO provider configured surfaces the 503
 * "unavailable" contract instead of an unwarmable infinite `pending`.
 */
@Injectable()
export class AiSuggestionsService {
  private readonly logger = new Logger(AiSuggestionsService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly llmService: LlmService,
    private readonly preGen: AiSuggestionsPreGenQueueService,
    private readonly quotaCooldown: AiQuotaCooldownService,
  ) {}

  /**
   * Public entry point called from the controller. Returns an empty payload
   * (no enqueue) when admins have disabled the feature via
   * `ai_suggestions_enabled = 'false'`.
   */
  async getSuggestions(
    lineupId: number,
    opts: GetSuggestionsOpts = {},
  ): Promise<AiSuggestionsResponseDto> {
    const lineup = await this.loadLineup(lineupId);
    if (opts.personalize) {
      this.logger.log(
        `AI suggestions personalize=me served-from-base | lineup=${lineupId}`,
      );
    }
    if (await this.isFeatureDisabled()) {
      return this.emptyResponse();
    }
    const scope = await resolveVoterScope(this.db, lineup);
    return this.serveFromCache(lineup, scope);
  }

  /** SWR read: fresh hit → stale row → cold. Never awaits the LLM.
   *  Stale rows are served UNCONDITIONALLY (ROK-1316, unchanged by the
   *  ROK-1376 quota cooldown — last-good beats an error state). */
  private async serveFromCache(
    lineup: VoterScopeLineup,
    scope: ResolvedVoterScope,
  ): Promise<AiSuggestionsResponseDto> {
    const fresh = await this.findFresh(lineup.id, scope.hash);
    if (fresh) {
      this.logTelemetry(lineup.id, 'hit');
      return { ...fresh.payload, cached: true };
    }
    const latest = await findLatestForLineup(this.db, lineup.id);
    if (latest) {
      this.logTelemetry(lineup.id, 'stale_served');
      await this.preGen.enqueue(lineup.id, PREGEN_REQUEST_DELAY_MS, 'read');
      return { ...latest.payload, cached: true, stale: true };
    }
    return this.serveCold(lineup.id);
  }

  /**
   * Cold cache: only promise `pending` (and queue a job) if a pre-gen job
   * can actually fulfil it — otherwise the client would poll a skeleton
   * forever (the raw-429 emitter from prod 2026-06-20). Two unwarmable
   * cases surface the existing 503/unavailable contract instead:
   *   - no provider configured → NotFoundException with "ai provider"
   *     (controller maps to 503 → frontend `kind:'unavailable'`)
   *   - ROK-1376 quota cooldown armed → pre-gen would `skipped_quota`, so
   *     throw `LlmUnavailableError` (controller maps to the same 503).
   */
  private async serveCold(lineupId: number): Promise<AiSuggestionsResponseDto> {
    this.logTelemetry(lineupId, 'miss_cold');
    if (!(await this.hasProvider())) {
      this.logger.log(
        `AI suggestions cache | lineup=${lineupId} cold-no-provider`,
      );
      throw new NotFoundException('No AI provider configured');
    }
    if (await this.quotaCooldown.isActive()) {
      this.logger.log(
        `AI suggestions cache | lineup=${lineupId} cold-quota-cooldown`,
      );
      throw new LlmUnavailableError(
        'AI provider quota exhausted — cooldown active',
      );
    }
    await this.preGen.enqueue(lineupId, PREGEN_REQUEST_DELAY_MS, 'read');
    return { ...this.emptyResponse(), pending: true };
  }

  /** True when an AI provider is configured (registry-only, no network). */
  private async hasProvider(): Promise<boolean> {
    return (await this.llmService.getActiveProviderKey()) !== null;
  }

  /** Latest row for the current hash, only if still within its TTL. */
  private async findFresh(lineupId: number, hash: string) {
    const cached = await findLatestByHash(this.db, lineupId, hash);
    if (!cached) return null;
    const ttl =
      (cached.payload.suggestions ?? []).length > 0
        ? FRESH_TTL_MS
        : EMPTY_TTL_MS;
    return isFresh(cached.generatedAt, ttl) ? cached : null;
  }

  private logTelemetry(
    lineupId: number,
    result: 'hit' | 'stale_served' | 'miss_cold',
  ): void {
    this.logger.log(
      `AI suggestions cache | lineup=${lineupId} result=${result}`,
    );
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

  private async loadLineup(lineupId: number): Promise<VoterScopeLineup> {
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
    return { id: row.id, visibility: row.visibility };
  }
}
