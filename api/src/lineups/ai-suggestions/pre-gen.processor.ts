/**
 * BullMQ consumer for AI-suggestions pre-generation (ROK-1316).
 *
 * Runs the 10–62s Gemini round-trip in the BACKGROUND so the request
 * thread never blocks. Re-resolves the current voter scope at run time and
 * NO-OPs when a fresh row already exists for the current hash (a voting
 * burst that coalesced to one job, or a read-path enqueue that raced a
 * mutation-path enqueue). Skips lineups not in an active (`building`)
 * phase, and tolerates a deleted lineup without throwing.
 *
 * Telemetry: `AI suggestions pre-gen | lineup=<id> outcome=<o> elapsed=<ms>`.
 */
import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Job } from 'bullmq';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { LlmService } from '../../ai/llm.service';
import { AI_SETTING_KEYS } from '../../ai/llm.constants';
import { GameTasteService } from '../../game-taste/game-taste.service';
import {
  resolveVoterScope,
  type VoterScopeLineup,
} from './voter-scope.helpers';
import {
  findLatestByHash,
  isFresh,
  FRESH_TTL_MS,
  EMPTY_TTL_MS,
  pruneOldSuggestions,
} from './cache.helpers';
import { generateAndPersist, type GenerateDeps } from './generate.helpers';
import {
  AI_SUGGESTIONS_PREGEN_QUEUE,
  type AiSuggestionsPreGenJobData,
} from './pre-gen.queue';

/** Keep the newest N suggestion rows per lineup after a successful write. */
const PRUNE_KEEP = 2;

type Db = PostgresJsDatabase<typeof schema>;

@Processor(AI_SUGGESTIONS_PREGEN_QUEUE)
export class AiSuggestionsPreGenProcessor extends WorkerHost {
  private readonly logger = new Logger(AiSuggestionsPreGenProcessor.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly llmService: LlmService,
    private readonly gameTaste: GameTasteService,
  ) {
    super();
  }

  async process(job: Job<AiSuggestionsPreGenJobData>): Promise<void> {
    const { lineupId } = job.data;
    const start = Date.now();
    const outcome = await this.run(lineupId);
    this.logger.log(
      `AI suggestions pre-gen | lineup=${lineupId} outcome=${outcome} elapsed=${
        Date.now() - start
      }`,
    );
  }

  /** Returns the telemetry outcome string. */
  private async run(lineupId: number): Promise<string> {
    if (await this.isFeatureDisabled()) return 'skipped_inactive';
    const lineup = await this.loadActiveLineup(lineupId);
    if (!lineup) return 'skipped_inactive';
    const scope = await resolveVoterScope(this.db, lineup);
    if (await this.hasFreshRow(lineupId, scope.hash)) return 'noop_fresh';
    const deps: GenerateDeps = {
      db: this.db,
      settings: this.settings,
      llmService: this.llmService,
      gameTaste: this.gameTaste,
    };
    await generateAndPersist(deps, lineup, scope);
    await pruneOldSuggestions(this.db, lineupId, PRUNE_KEEP);
    return 'generated';
  }

  private async isFeatureDisabled(): Promise<boolean> {
    const value = await this.settings.get(AI_SETTING_KEYS.SUGGESTIONS_ENABLED);
    return value === 'false';
  }

  /** Load a lineup only when it's in an active (`building`) phase. */
  private async loadActiveLineup(
    lineupId: number,
  ): Promise<VoterScopeLineup | null> {
    const [row] = await this.db
      .select({
        id: schema.communityLineups.id,
        visibility: schema.communityLineups.visibility,
        status: schema.communityLineups.status,
      })
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, lineupId))
      .limit(1);
    if (!row || row.status !== 'building') return null;
    return { id: row.id, visibility: row.visibility };
  }

  /** True when a non-expired row already exists for the current hash. */
  private async hasFreshRow(lineupId: number, hash: string): Promise<boolean> {
    const cached = await findLatestByHash(this.db, lineupId, hash);
    if (!cached) return false;
    const ttl =
      (cached.payload.suggestions ?? []).length > 0 ? FRESH_TTL_MS : EMPTY_TTL_MS;
    return isFresh(cached.generatedAt, ttl);
  }
}
