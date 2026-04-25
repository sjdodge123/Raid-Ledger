import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import { AdminGuard } from '../auth/admin.guard';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { SETTING_KEYS } from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';

type Db = PostgresJsDatabase<typeof schema>;

const SeedBodySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().min(1).max(500).optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'expired']).optional(),
  populationStrategy: z.enum(['vector', 'fixed', 'hybrid']).optional(),
  sortOrder: z.number().int().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  candidateGameIds: z.array(z.number().int()).optional(),
  themeVector: z.array(z.number()).length(7).optional(),
});

const DEFAULT_THEME_VECTOR: readonly number[] = [0.5, 0, 0.3, 0, 0.2, 0.4, 0];
/** How many real game ids to default into the seed when the caller omits them.
 * Keeps smoke tests deterministic AND ensures the row actually hydrates on /games. */
const DEFAULT_SEED_GAME_COUNT = 3;

/**
 * Demo-mode-only endpoints for dynamic discovery category fixtures (ROK-567).
 * Used by smoke tests to seed deterministic pending suggestions without
 * depending on a live LLM provider. All endpoints require `DEMO_MODE=true`
 * (enforced at request time) and are admin-guarded.
 */
@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DemoTestDiscoveryCategoriesController {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly settingsService: SettingsService,
  ) {}

  private async assertDemoMode(): Promise<void> {
    if (process.env.DEMO_MODE !== 'true') {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
    const demoMode = await this.settingsService.getDemoMode();
    if (!demoMode) {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
  }

  @Post('seed-discovery-categories')
  @HttpCode(HttpStatus.OK)
  async seed(@Body() body: unknown): Promise<{ id: string }> {
    await this.assertDemoMode();
    const parsed = SeedBodySchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.errors[0]?.message ?? 'Invalid body',
      );
    }
    const input = parsed.data;
    const candidateGameIds =
      input.candidateGameIds ?? (await this.pickDefaultSeedGameIds());
    const [row] = await this.db
      .insert(schema.discoveryCategorySuggestions)
      .values({
        name: input.name ?? `Demo Dynamic Category ${Date.now()}`,
        description:
          input.description ??
          'Seeded by smoke tests — not a real LLM proposal (ROK-567).',
        categoryType: 'trend',
        themeVector: input.themeVector ?? [...DEFAULT_THEME_VECTOR],
        status: input.status ?? 'pending',
        populationStrategy: input.populationStrategy ?? 'fixed',
        sortOrder: input.sortOrder ?? 1000,
        expiresAt:
          input.expiresAt === undefined || input.expiresAt === null
            ? null
            : new Date(input.expiresAt),
        candidateGameIds,
      })
      .returning({ id: schema.discoveryCategorySuggestions.id });
    return { id: row.id };
  }

  /**
   * Pick the first few visible games as default candidate ids. Keeps a seeded
   * `approved` row actually renderable on /games — without this, the default
   * `populationStrategy='fixed' + candidateGameIds=[]` combo would silently
   * drop the row from the discover response.
   */
  private async pickDefaultSeedGameIds(): Promise<number[]> {
    const rows = await this.db
      .select({ id: schema.games.id })
      .from(schema.games)
      .where(
        sql`${schema.games.hidden} = false AND ${schema.games.banned} = false`,
      )
      .orderBy(schema.games.id)
      .limit(DEFAULT_SEED_GAME_COUNT);
    return rows.map((r) => r.id);
  }

  @Post('clear-discovery-categories')
  @HttpCode(HttpStatus.OK)
  async clear(): Promise<{ success: true }> {
    await this.assertDemoMode();
    await this.db.execute(
      sql`TRUNCATE TABLE discovery_category_suggestions RESTART IDENTITY`,
    );
    return { success: true };
  }

  /**
   * Set the `ai_dynamic_categories_enabled` feature flag without going
   * through the AI plugin's PUT /admin/ai/features endpoint. The usual
   * route requires the AI plugin to be active (PluginActiveGuard); in CI
   * the plugin is inactive by default, so smoke tests need a back-door
   * to toggle this feature flag. DEMO_MODE only.
   */
  @Put('dynamic-categories-flag')
  @HttpCode(HttpStatus.OK)
  async setFlag(
    @Body() body: { enabled?: boolean },
  ): Promise<{ success: true }> {
    await this.assertDemoMode();
    if (typeof body?.enabled !== 'boolean') {
      throw new BadRequestException('enabled must be a boolean');
    }
    await this.settingsService.set(
      SETTING_KEYS.AI_DYNAMIC_CATEGORIES_ENABLED,
      String(body.enabled),
    );
    return { success: true };
  }
}
