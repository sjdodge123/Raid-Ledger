/**
 * DemoTestRecruitmentController (ROK-1240).
 *
 * DEMO_MODE-only endpoint used by the recruitment-reminder smoke test
 * (`tools/test-bot/src/smoke/tests/recruitment-reminder.test.ts`).
 *
 * Mirrors `trigger-standalone-poll-reminders` from
 * `demo-test-standalone-poll.controller.ts`: runs the recruitment-reminder
 * cron once on demand so smoke tests don't have to wait for the natural
 * 15-minute schedule.
 */
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { z } from 'zod';
import { SkipThrottle } from '@nestjs/throttler';
import { AdminGuard } from '../auth/admin.guard';
import { DemoModeGuard } from './demo-mode.guard';
import { SettingsService } from '../settings/settings.service';
import { RecruitmentReminderService } from '../notifications/recruitment-reminder.service';

const PostBumpSchema = z.object({ eventId: z.number().int().positive() });

@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class DemoTestRecruitmentController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly recruitmentReminderService: RecruitmentReminderService,
  ) {}

  private async assertDemoMode(): Promise<void> {
    if (process.env.DEMO_MODE !== 'true') {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
    if (!(await this.settingsService.getDemoMode())) {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
  }

  /** Run the recruitment-reminder cron once, on demand (DEMO_MODE only). */
  @Post('trigger-recruitment-reminders')
  @HttpCode(HttpStatus.OK)
  async triggerReminders(): Promise<{ success: boolean }> {
    await this.assertDemoMode();
    await this.recruitmentReminderService.checkAndSendReminders();
    return { success: true };
  }

  /**
   * Post the "Spots still available" bump for one event right now, skipping
   * the grace period + dedup (ROK-1812 smoke: the bump's count must follow
   * later sign-ups). 404 when the event is not bump-eligible.
   */
  @Post('post-recruitment-bump')
  @HttpCode(HttpStatus.OK)
  async postBump(@Body() body: unknown): Promise<{ success: boolean }> {
    await this.assertDemoMode();
    const parsed = PostBumpSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    const { eventId } = parsed.data;
    const posted =
      await this.recruitmentReminderService.postBumpNowForEvent(eventId);
    if (!posted) {
      throw new NotFoundException(
        `Event ${eventId} is not eligible for a recruitment bump`,
      );
    }
    return { success: true };
  }
}
