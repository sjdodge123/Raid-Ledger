import { Controller, Get } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { SettingsService } from '../settings/settings.service';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import type { SystemStatusDto } from '@raid-ledger/contract';

/**
 * System status controller (ROK-175, ROK-146, ROK-238).
 * Public endpoint for first-run detection, Discord configuration status,
 * and active plugin list for frontend slot rendering.
 */
@Controller('system')
export class SystemController {
  constructor(
    private readonly usersService: UsersService,
    private readonly settingsService: SettingsService,
    private readonly pluginRegistry: PluginRegistryService,
  ) {}

  /**
   * Get system status for first-run detection (AC-4).
   * Public endpoint - no authentication required.
   */
  @Get('status')
  async getStatus(): Promise<SystemStatusDto> {
    const [userCount, discordConfigured, blizzardConfigured] =
      await Promise.all([
        this.usersService.count(),
        this.settingsService.isDiscordConfigured(),
        this.settingsService.isBlizzardConfigured(),
      ]);

    // Merge registry active slugs with transition shim:
    // include 'blizzard' when configured even if not formally installed
    const activeSlugs = new Set(this.pluginRegistry.getActiveSlugsSync());
    if (blizzardConfigured) {
      activeSlugs.add('blizzard');
    }

    return {
      isFirstRun: userCount === 0,
      discordConfigured,
      blizzardConfigured,
      demoMode: await this.settingsService.getDemoMode(),
      activePlugins: [...activeSlugs],
    };
  }
}
