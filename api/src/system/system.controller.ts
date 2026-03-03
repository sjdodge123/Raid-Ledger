import { Controller, Get } from '@nestjs/common';
import * as path from 'path';
import { UsersService } from '../users/users.service';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import {
  EXTENSION_POINTS,
  type AuthProvider,
} from '../plugins/plugin-host/extension-points';
import type { SystemStatusDto, LoginMethodDto } from '@raid-ledger/contract';

/**
 * System status controller (ROK-175, ROK-146, ROK-238, ROK-267, ROK-271).
 * Public endpoint for first-run detection, auth provider discovery,
 * active plugin list, and community branding.
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
    // Collect auth adapters synchronously (the map itself is not async)
    const authAdapters =
      this.pluginRegistry.getAdaptersForExtensionPoint<AuthProvider>(
        EXTENSION_POINTS.AUTH_PROVIDER,
      );
    const adapterEntries = [...authAdapters.entries()];

    // Run all independent async checks in parallel (ROK-662)
    const [
      userCount,
      discordConfigured,
      blizzardConfigured,
      branding,
      onboardingCompletedRaw,
      demoMode,
      ...adapterConfigured
    ] = await Promise.all([
      this.usersService.count(),
      this.settingsService.isDiscordConfigured(),
      this.settingsService.isBlizzardConfigured(),
      this.settingsService.getBranding(),
      this.settingsService.get(SETTING_KEYS.ONBOARDING_COMPLETED),
      this.settingsService.getDemoMode(),
      ...adapterEntries.map(([, provider]) => provider.isConfigured()),
    ]);

    // Build authProviders from parallel results
    const authProviders: LoginMethodDto[] = [];
    for (let i = 0; i < adapterEntries.length; i++) {
      if (adapterConfigured[i]) {
        authProviders.push(adapterEntries[i][1].getLoginMethod());
      }
    }

    return {
      isFirstRun: userCount === 0,
      discordConfigured,
      blizzardConfigured,
      demoMode,
      activePlugins: [...this.pluginRegistry.getActiveSlugsSync()],
      communityName: branding.communityName ?? undefined,
      communityLogoUrl: branding.communityLogoPath
        ? `/uploads/branding/${path.basename(branding.communityLogoPath)}`
        : undefined,
      communityAccentColor: branding.communityAccentColor ?? undefined,
      onboardingCompleted: onboardingCompletedRaw === 'true',
      authProviders,
    };
  }
}
