import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { AdminGuard } from '../auth/admin.guard';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { DemoTestService } from './demo-test.service';
import { SetEventTimesSchema, ResetEventsSchema } from './demo-test.schemas';
import { parseDemoBody } from './demo-test.utils';
import { resetEventsForTest as resetEventsHelper } from './demo-test-rok1070.helpers';

/**
 * Discord scheduled-event test endpoints — DEMO_MODE only.
 */
@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DemoTestScheduledEventsController {
  constructor(
    private readonly demoTestService: DemoTestService,
    private readonly settingsService: SettingsService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** Gate — throws if DEMO_MODE is off (ROK-1070 Codex review P1). */
  private async assertDemoMode(): Promise<void> {
    if (process.env.DEMO_MODE !== 'true') {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
    if (!(await this.settingsService.getDemoMode())) {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
  }

  /** Trigger scheduled event completion cron — DEMO_MODE only (ROK-944). */
  @Post('trigger-scheduled-event-completion')
  @HttpCode(HttpStatus.OK)
  async triggerScheduledEventCompletionForTest(): Promise<{
    success: boolean;
  }> {
    return this.demoTestService.triggerScheduledEventCompletionForTest();
  }

  /** Pause the reconciliation cron to prevent API queue flooding — DEMO_MODE only (ROK-969). */
  @Post('pause-reconciliation')
  @HttpCode(HttpStatus.OK)
  async pauseReconciliationForTest(): Promise<{ success: boolean }> {
    return this.demoTestService.pauseReconciliationForTest();
  }

  /** Enable Discord scheduled event creation -- DEMO_MODE only (ROK-969). */
  @Post('enable-scheduled-events')
  @HttpCode(HttpStatus.OK)
  async enableScheduledEventsForTest(): Promise<{ success: boolean }> {
    return this.demoTestService.enableScheduledEventsForTest();
  }

  /** Disable Discord scheduled event creation -- DEMO_MODE only (ROK-969). */
  @Post('disable-scheduled-events')
  @HttpCode(HttpStatus.OK)
  async disableScheduledEventsForTest(): Promise<{ success: boolean }> {
    return this.demoTestService.disableScheduledEventsForTest();
  }

  /** Delete all Discord scheduled events in the guild — DEMO_MODE only (ROK-969). */
  @Post('cleanup-scheduled-events')
  @HttpCode(HttpStatus.OK)
  async cleanupScheduledEventsForTest() {
    return this.demoTestService.cleanupScheduledEventsForTest();
  }

  /** Force-set event times bypassing Zod validation — DEMO_MODE only (ROK-969). */
  @Post('set-event-times')
  @HttpCode(HttpStatus.OK)
  async setEventTimesForTest(@Body() body: unknown) {
    const parsed = parseDemoBody(SetEventTimesSchema, body);
    return this.demoTestService.setEventTimesForTest(
      parsed.eventId,
      parsed.startTime,
      parsed.endTime,
    );
  }

  /**
   * Hard-delete events whose title begins with `titlePrefix` — DEMO_MODE
   * only (ROK-1070). Mirrors `/admin/test/reset-lineups`. Each smoke worker
   * passes a unique prefix so sibling workers' events are not touched.
   * `event_signups` and other cascading children are removed via FK
   * `onDelete: cascade`.
   */
  @Post('reset-events')
  @HttpCode(HttpStatus.OK)
  async resetEventsForTest(@Body() body: unknown): Promise<{
    success: boolean;
    deletedCount: number;
  }> {
    await this.assertDemoMode();
    const parsed = parseDemoBody(ResetEventsSchema, body);
    const { deletedCount } = await resetEventsHelper(
      this.db,
      parsed.titlePrefix,
    );
    return { success: true, deletedCount };
  }
}
