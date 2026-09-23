/**
 * DemoTestAiSuggestionsController (ROK-1110).
 *
 * Seeds a deterministic `lineup_ai_suggestions` cache row so Playwright can
 * exercise the AI-suggestion surface on the Common Ground grid WITHOUT an
 * LLM provider, network round-trip or BullMQ pre-gen job.
 *
 * Why this works with zero provider config: `AiSuggestionsService` is a
 * serve-stale-while-revalidate reader (ROK-1316). It only consults
 * `LlmService` on the fully-cold path — a cache row short-circuits ahead of
 * that check, so `GET /lineups/:id/suggestions` returns exactly what was
 * seeded. The row is written under the lineup's REAL voter-set hash
 * (`resolveVoterScope`), which makes it a *fresh* hit rather than a stale
 * one, so no background refresh job is enqueued to race the assertions.
 *
 * DEMO_MODE-only, behind the JWT + admin guards like every `/admin/test/*`
 * endpoint.
 */
import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { AdminGuard } from '../auth/admin.guard';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { resolveVoterScope } from '../lineups/ai-suggestions/voter-scope.helpers';
import { upsertSuggestion } from '../lineups/ai-suggestions/cache.helpers';
import {
  SeedAiSuggestionsSchema,
  ClearAiSuggestionsSchema,
} from './demo-test.schemas';
import { parseDemoBody } from './demo-test.utils';

/** Provider/model markers written on a fixture row, so it is greppable in the DB. */
const FIXTURE_PROVIDER = 'demo-test';
const FIXTURE_MODEL = 'rok-1110-fixture';

@Controller('admin/test/ai-suggestions')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DemoTestAiSuggestionsController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settingsService: SettingsService,
  ) {}

  private async assertDemoMode(): Promise<void> {
    if (process.env.DEMO_MODE !== 'true') {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
    if (!(await this.settingsService.getDemoMode())) {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
  }

  /** Load the columns `resolveVoterScope` needs, 404 when the lineup is gone. */
  private async loadLineup(
    lineupId: number,
  ): Promise<{ id: number; visibility: 'public' | 'private' }> {
    const [row] = await this.db
      .select({
        id: schema.communityLineups.id,
        visibility: schema.communityLineups.visibility,
      })
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, lineupId))
      .limit(1);
    if (!row) throw new NotFoundException(`Lineup ${lineupId} not found`);
    return row;
  }

  /**
   * Write a fixture suggestions payload for a lineup. Returns the voter-set
   * hash it was keyed to so a failing test can print it.
   */
  @Post('seed')
  @HttpCode(HttpStatus.OK)
  async seed(
    @Body() body: unknown,
  ): Promise<{ success: boolean; voterSetHash: string; voterCount: number }> {
    await this.assertDemoMode();
    const { lineupId, suggestions } = parseDemoBody(
      SeedAiSuggestionsSchema,
      body,
    );
    const lineup = await this.loadLineup(lineupId);
    const scope = await resolveVoterScope(this.db, lineup);
    await upsertSuggestion(this.db, {
      lineupId,
      voterSetHash: scope.hash,
      payload: {
        suggestions,
        generatedAt: new Date().toISOString(),
        voterCount: scope.userIds.length,
        voterScopeStrategy: scope.strategy,
      },
      provider: FIXTURE_PROVIDER,
      model: FIXTURE_MODEL,
    });
    return {
      success: true,
      voterSetHash: scope.hash,
      voterCount: scope.userIds.length,
    };
  }

  /**
   * Drop EVERY cached suggestions row for one lineup — not just the current
   * voter-set hash. The read path falls back to `findLatestForLineup` on a
   * hash miss, so leaving a sibling row behind would keep serving it as
   * `stale` and a teardown would silently not tear down.
   */
  @Post('clear')
  @HttpCode(HttpStatus.OK)
  async clear(@Body() body: unknown): Promise<{ success: boolean }> {
    await this.assertDemoMode();
    const { lineupId } = parseDemoBody(ClearAiSuggestionsSchema, body);
    await this.db
      .delete(schema.lineupAiSuggestions)
      .where(eq(schema.lineupAiSuggestions.lineupId, lineupId));
    return { success: true };
  }
}
