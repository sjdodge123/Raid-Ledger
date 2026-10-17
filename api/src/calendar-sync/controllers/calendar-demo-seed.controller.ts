/**
 * ROK-1592 L15: `POST /admin/test/calendar/seed-connection` — DEMO_MODE only.
 * ROK-1596 W3: `writeEnabled?`/`writeTarget?` on it, and `POST seed-link`
 * (a link row + a Fake copy for one user × event, without the queue).
 * ROK-1593 §3.6: `POST seed-busy` (busy blocks for one connection).
 *
 * Creates a `google` connection with a `demo-fake:` subject and Fake
 * credentials, owned by the caller (or `userId`), so smoke specs and UI test
 * plans can render a connected card and disconnect it without Google. The
 * registry routes the row's DELETE to the Fake. Gated exactly like the
 * `/admin/test/*` endpoints in `admin/demo-test-core.controller.ts`: JWT +
 * AdminGuard, then env `DEMO_MODE=true` AND the `demo_mode` setting.
 */
import {
  Body,
  Controller,
  ForbiddenException,
  Inject,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { AdminGuard } from '../../auth/admin.guard';
import { DemoModeGuard } from '../../admin/demo-mode.guard';
import type { AuthenticatedRequest } from '../../auth/types';
import { parseDemoBody } from '../../admin/demo-test.utils';
import { SettingsService } from '../../settings/settings.service';
import { GameTimeService } from '../../users/game-time.service';
import { CALENDAR_FAKE_PROVIDER } from '../providers/calendar-provider.registry';
import type { FakeCalendarProvider } from '../providers/testing/fake-calendar.provider';
import { upsertCalendarConnection } from '../services/calendar-connect.helpers';
import {
  SeedLinkSchema,
  seedDemoLink,
} from './calendar-demo-seed-link.helpers';
import {
  SeedBusySchema,
  seedDemoBusy,
  type SeedBusyResult,
} from './calendar-demo-seed-busy.helpers';

const SeedConnectionSchema = z
  .object({
    userId: z.number().int().positive().optional(),
    accountLabel: z.string().min(1).max(255).optional(),
    writeEnabled: z.boolean().optional(),
    writeTarget: z.enum(['dedicated', 'primary']).optional(),
  })
  .strict();

const DEMO_ONLY = 'Only available in DEMO_MODE';

@Controller('admin/test/calendar')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class CalendarDemoSeedController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settings: SettingsService,
    @Inject(CALENDAR_FAKE_PROVIDER)
    private readonly fake: FakeCalendarProvider,
    private readonly gameTime: GameTimeService,
  ) {}

  @Post('seed-connection')
  async seedConnection(
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<{ id: number }> {
    const fake = await this.assertDemoMode();
    const input = parseDemoBody(SeedConnectionSchema, body ?? {});
    const result = fake.seedConnection({
      id: randomBytes(6).toString('hex'),
      label: input.accountLabel ?? null,
    });
    const { id } = await upsertCalendarConnection(this.db, {
      userId: input.userId ?? req.user.id,
      provider: 'google',
      result,
    });
    if (input.writeEnabled !== undefined || input.writeTarget) {
      await this.db
        .update(schema.calendarConnections)
        .set({
          writeEnabled: input.writeEnabled,
          writeTarget: input.writeTarget,
        })
        .where(eq(schema.calendarConnections.id, id));
    }
    return { id };
  }

  /** A link row (+ a Fake copy when `synced`) for one user × event, no queue. */
  @Post('seed-link')
  async seedLink(@Body() body: unknown): Promise<{ linkId: number }> {
    const fake = await this.assertDemoMode();
    const input = parseDemoBody(SeedLinkSchema, body ?? {});
    const clientUrl = await this.settings.getClientUrl();
    return seedDemoLink(this.db, fake, clientUrl, input);
  }

  /** Foreign busy blocks for one connection (+ the Fake), no queue. */
  @Post('seed-busy')
  async seedBusy(@Body() body: unknown): Promise<SeedBusyResult> {
    const fake = await this.assertDemoMode();
    const input = parseDemoBody(SeedBusySchema, body ?? {});
    return seedDemoBusy(this.db, fake, input, {
      invalidateUser: (u) => this.gameTime.invalidateUserCache(u),
      defaultTimezone: async () =>
        (await this.settings.getDefaultTimezone()) ?? 'UTC',
    });
  }

  /** Request-time gate, same checks as `DemoTestCoreController`. */
  private async assertDemoMode(): Promise<FakeCalendarProvider> {
    if (process.env.DEMO_MODE !== 'true') {
      throw new ForbiddenException(DEMO_ONLY);
    }
    if (!(await this.settings.getDemoMode())) {
      throw new ForbiddenException(DEMO_ONLY);
    }
    return this.fake;
  }
}
