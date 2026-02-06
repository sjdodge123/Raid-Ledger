import { Controller, Get } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { SettingsService } from '../settings/settings.service';
import type { SystemStatusDto } from '@raid-ledger/contract';

/**
 * System status controller (ROK-175, ROK-146).
 * Public endpoint for first-run detection and Discord configuration status.
 * Now checks database for OAuth configuration.
 */
@Controller('system')
export class SystemController {
  constructor(
    private readonly usersService: UsersService,
    private readonly settingsService: SettingsService,
  ) { }

  /**
   * Get system status for first-run detection (AC-4).
   * Public endpoint - no authentication required.
   */
  @Get('status')
  async getStatus(): Promise<SystemStatusDto> {
    const [userCount, discordConfigured] = await Promise.all([
      this.usersService.count(),
      this.settingsService.isDiscordConfigured(),
    ]);

    return {
      isFirstRun: userCount === 0,
      discordConfigured,
    };
  }
}

