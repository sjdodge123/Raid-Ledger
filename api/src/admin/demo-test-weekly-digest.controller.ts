/**
 * DemoTestWeeklyDigestController (ROK-1435 slice L4).
 *
 * DEMO_MODE-only endpoint for the weekly-digest smoke test
 * (`tools/test-bot/src/smoke/tests/weekly-digest.test.ts`). Posts this
 * week's digest on demand, skipping the enabled toggle and the day/hour slot
 * gate — but NOT the dedup claim, the empty-week skip or the channel
 * resolution, which are what the smoke test exercises.
 *
 * `resetWeek: true` gives back this ISO week's dedup key first, so repeated
 * smoke runs in one week each get a fresh post.
 */
import {
  Body,
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
import {
  WeeklyDigestService,
  type DigestOutcome,
} from '../notifications/weekly-digest.service';

@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DemoTestWeeklyDigestController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly weeklyDigestService: WeeklyDigestService,
  ) {}

  private async assertDemoMode(): Promise<void> {
    if (process.env.DEMO_MODE !== 'true') {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
    if (!(await this.settingsService.getDemoMode())) {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
  }

  /** Post this week's digest now (DEMO_MODE only). */
  @Post('trigger-weekly-digest')
  @HttpCode(HttpStatus.OK)
  async triggerDigest(
    @Body() body: { resetWeek?: boolean } = {},
  ): Promise<DigestOutcome> {
    await this.assertDemoMode();
    const now = new Date();
    if (body?.resetWeek === true) {
      await this.weeklyDigestService.releaseWeek(now);
    }
    return this.weeklyDigestService.postDigest(now);
  }
}
