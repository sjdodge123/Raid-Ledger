/**
 * Standalone scheduling poll test endpoints (ROK-1192).
 * DEMO_MODE-only — used by smoke tests to exercise the deadline
 * reminder cron without waiting 23 real hours for the 1h window.
 */
import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { AdminGuard } from '../auth/admin.guard';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { StandalonePollReminderService } from '../lineups/standalone-poll/standalone-poll-reminder.service';
import { AdvanceStandalonePollDeadlineSchema } from './demo-test.schemas';
import { parseDemoBody } from './demo-test.utils';

@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DemoTestStandalonePollController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settingsService: SettingsService,
    private readonly reminderService: StandalonePollReminderService,
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

  /**
   * Reset a standalone poll's `phase_deadline` to `now + hoursUntilDeadline`.
   * Pass a fractional value (e.g. 0.5) to land inside the 1h window.
   */
  @Post('advance-standalone-poll-deadline')
  @HttpCode(HttpStatus.OK)
  async advancePollDeadline(
    @Body() body: unknown,
  ): Promise<{ success: boolean; phaseDeadline: string }> {
    await this.assertDemoMode();
    const parsed = parseDemoBody(AdvanceStandalonePollDeadlineSchema, body);
    const newDeadline = new Date(
      Date.now() + parsed.hoursUntilDeadline * 60 * 60 * 1000,
    );
    const updated = await this.db
      .update(schema.communityLineups)
      .set({ phaseDeadline: newDeadline, updatedAt: new Date() })
      .where(eq(schema.communityLineups.id, parsed.lineupId))
      .returning({ id: schema.communityLineups.id });
    if (updated.length === 0) {
      throw new NotFoundException(`Lineup ${parsed.lineupId} not found`);
    }
    return { success: true, phaseDeadline: newDeadline.toISOString() };
  }

  /** Run the standalone-poll reminder cron once, on demand. */
  @Post('trigger-standalone-poll-reminders')
  @HttpCode(HttpStatus.OK)
  async triggerReminders(): Promise<{ success: boolean }> {
    await this.assertDemoMode();
    await this.reminderService.runReminders();
    return { success: true };
  }
}
