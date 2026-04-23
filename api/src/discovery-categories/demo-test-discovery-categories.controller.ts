import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
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
import { SettingsService } from '../settings/settings.service';

type Db = PostgresJsDatabase<typeof schema>;

const SeedBodySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  status: z
    .enum(['pending', 'approved', 'rejected', 'expired'])
    .optional(),
  populationStrategy: z.enum(['vector', 'fixed', 'hybrid']).optional(),
  sortOrder: z.number().int().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  candidateGameIds: z.array(z.number().int()).optional(),
});

const DEFAULT_THEME_VECTOR: readonly number[] = [0.5, 0, 0.3, 0, 0.2, 0.4, 0];

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
    const [row] = await this.db
      .insert(schema.discoveryCategorySuggestions)
      .values({
        name: input.name ?? `Demo Dynamic Category ${Date.now()}`,
        description:
          'Seeded by smoke tests — not a real LLM proposal (ROK-567).',
        categoryType: 'trend',
        themeVector: [...DEFAULT_THEME_VECTOR],
        status: input.status ?? 'pending',
        populationStrategy: input.populationStrategy ?? 'fixed',
        sortOrder: input.sortOrder ?? 1000,
        expiresAt:
          input.expiresAt === undefined || input.expiresAt === null
            ? null
            : new Date(input.expiresAt),
        candidateGameIds: input.candidateGameIds ?? [],
      })
      .returning({ id: schema.discoveryCategorySuggestions.id });
    return { id: row.id };
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
}
