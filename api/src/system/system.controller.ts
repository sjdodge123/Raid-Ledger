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
  /** Collect configured auth providers from plugin adapters. */
  private buildAuthProviders(
    adapterEntries: [string, AuthProvider][],
    adapterConfigured: boolean[],
  ): LoginMethodDto[] {
    const providers: LoginMethodDto[] = [];
    for (let i = 0; i < adapterEntries.length; i++) {
      if (adapterConfigured[i])
        providers.push(adapterEntries[i][1].getLoginMethod());
    }
    return providers;
  }

  /** Build system status DTO from fetched data. */
  private buildStatusDto(
    userCount: number,
    discordConfigured: boolean,
    blizzardConfigured: boolean,
    steamConfigured: boolean,
    branding: {
      communityName: string | null;
      communityLogoPath: string | null;
      communityAccentColor: string | null;
    },
    onboardingCompletedRaw: string | null,
    demoMode: boolean,
    adapterEntries: [string, AuthProvider][],
    adapterConfigured: boolean[],
  ): SystemStatusDto {
    return {
      isFirstRun: userCount === 0,
      discordConfigured,
      blizzardConfigured,
      steamConfigured,
      demoMode,
      activePlugins: [...this.pluginRegistry.getActiveSlugsSync()],
      communityName: branding.communityName ?? undefined,
      communityLogoUrl: branding.communityLogoPath
        ? `/uploads/branding/${path.basename(branding.communityLogoPath)}`
        : undefined,
      communityAccentColor: branding.communityAccentColor ?? undefined,
      onboardingCompleted: onboardingCompletedRaw === 'true',
      authProviders: this.buildAuthProviders(adapterEntries, adapterConfigured),
    };
  }

  /** Fetch all status data in parallel. */
  private async fetchStatusData(adapterEntries: [string, AuthProvider][]) {
    return Promise.all([
      this.usersService.count(),
      this.settingsService.isDiscordConfigured(),
      this.settingsService.isBlizzardConfigured(),
      this.settingsService.isSteamConfigured(),
      this.settingsService.getBranding(),
      this.settingsService.get(SETTING_KEYS.ONBOARDING_COMPLETED),
      this.settingsService.getDemoMode(),
      ...adapterEntries.map(([, provider]) => provider.isConfigured()),
    ]);
  }

  @Get('status')
  async getStatus(): Promise<SystemStatusDto> {
    const authAdapters =
      this.pluginRegistry.getAdaptersForExtensionPoint<AuthProvider>(
        EXTENSION_POINTS.AUTH_PROVIDER,
      );
    const adapterEntries = [...authAdapters.entries()];
    const [
      userCount,
      discordConfigured,
      blizzardConfigured,
      steamConfigured,
      branding,
      onboardingCompletedRaw,
      demoMode,
      ...adapterConfigured
    ] = await this.fetchStatusData(adapterEntries);
    return this.buildStatusDto(
      userCount,
      discordConfigured,
      blizzardConfigured,
      steamConfigured,
      branding,
      onboardingCompletedRaw,
      demoMode,
      adapterEntries,
      adapterConfigured,
    );
  }
}
