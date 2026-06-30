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
import { EphemeralVoiceScheduler } from './services/ephemeral-voice.scheduler';
import { EphemeralVoiceReaper } from './services/ephemeral-voice.reaper';

/**
 * ROK-1352: Force-trigger the ephemeral-voice create/reap scans for the
 * deterministic lifecycle smoke test. DEMO_MODE only.
 */
@Controller('admin/test/ephemeral-voice')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DemoTestEphemeralVoiceController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly scheduler: EphemeralVoiceScheduler,
    private readonly reaper: EphemeralVoiceReaper,
  ) {}

  /** Force the create-window scan now. */
  @Post('scan')
  @HttpCode(HttpStatus.OK)
  async forceScan(): Promise<{ success: boolean }> {
    await this.assertDemoMode();
    await this.scheduler.scanCreateWindow();
    return { success: true };
  }

  /** Force the idle reaper scan now. */
  @Post('reap')
  @HttpCode(HttpStatus.OK)
  async forceReap(): Promise<{ success: boolean }> {
    await this.assertDemoMode();
    await this.reaper.reapIdle();
    return { success: true };
  }

  /** DEMO_MODE gate — both env flag and DB setting must be on. */
  private async assertDemoMode(): Promise<void> {
    if (process.env.DEMO_MODE !== 'true') {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
    if (!(await this.settingsService.getDemoMode())) {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
  }
}
