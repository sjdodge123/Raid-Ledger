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
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { AdminGuard } from '../auth/admin.guard';
import { SettingsService } from '../settings/settings.service';
import { RecruitmentReminderService } from '../notifications/recruitment-reminder.service';

@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard)
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
}
