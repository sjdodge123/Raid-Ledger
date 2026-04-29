/**
 * DemoTestResetController (ROK-1186).
 *
 * Single endpoint `POST /admin/test/reset-to-seed` that wipes all
 * test-created data and re-runs the demo installer. Used by smoke +
 * Playwright setup to start every run from a clean baseline.
 */
import {
  Controller,
  Post,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { AdminGuard } from '../auth/admin.guard';
import { SettingsService } from '../settings/settings.service';
import {
  DemoTestResetService,
  type ResetToSeedResult,
} from './demo-test-reset.service';

@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DemoTestResetController {
  constructor(
    private readonly resetService: DemoTestResetService,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * Hard reset: wipe events/signups/lineups/characters/voice sessions,
   * then re-run demo install. DEMO_MODE-gated (env + DB flag).
   */
  @Post('reset-to-seed')
  @HttpCode(HttpStatus.OK)
  async resetToSeed(): Promise<ResetToSeedResult> {
    await this.assertDemoMode();
    return this.resetService.resetToSeed();
  }

  /** Throw if either env or DB demoMode flag is off. */
  private async assertDemoMode(): Promise<void> {
    if (process.env.DEMO_MODE !== 'true') {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
    const demoMode = await this.settingsService.getDemoMode();
    if (!demoMode) {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
  }
}
