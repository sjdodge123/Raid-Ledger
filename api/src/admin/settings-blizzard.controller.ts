import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../plugins/plugin-host/plugin-active.guard';
import { testBlizzardCredentials } from './settings-api-test.helpers';
import { BlizzardConfigDto } from './settings.dto';
import type { BlizzardStatusResponse, OAuthTestResponse } from './settings.dto';

/** The WoW plugins' manifest slug (`HUB_PLUGIN_MANIFESTS.blizzard`). */
const BLIZZARD_PLUGIN_SLUG = 'blizzard';

/**
 * Admin Blizzard API settings (ROK-2361 #9; split out of
 * AdminSettingsController, which sits at the 300-line cap).
 *
 * Reading, saving and testing the keys (the test is an outbound Blizzard
 * OAuth request) belong to the `blizzard` plugin, so they refuse with
 * `403 Plugin "blizzard" is not active` while it is off. Clearing the keys is
 * the admin withdrawing data and runs regardless (CLAUDE.md "Hub widgets and
 * behaviours belong to a plugin").
 */
@Controller('admin/settings')
@UseGuards(AuthGuard('jwt'), AdminGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class AdminBlizzardSettingsController {
  private readonly logger = new Logger(AdminBlizzardSettingsController.name);

  constructor(private readonly settingsService: SettingsService) {}

  @Get('blizzard')
  @RequirePlugin(BLIZZARD_PLUGIN_SLUG)
  @UseGuards(PluginActiveGuard)
  async getBlizzardStatus(): Promise<BlizzardStatusResponse> {
    return { configured: await this.settingsService.isBlizzardConfigured() };
  }

  @Put('blizzard')
  @RequirePlugin(BLIZZARD_PLUGIN_SLUG)
  @UseGuards(PluginActiveGuard)
  @HttpCode(HttpStatus.OK)
  async updateBlizzardConfig(
    @Body() body: BlizzardConfigDto,
  ): Promise<{ success: boolean; message: string }> {
    await this.settingsService.setBlizzardConfig({
      clientId: body.clientId,
      clientSecret: body.clientSecret,
    });
    this.logger.log('Blizzard API configuration updated via admin UI');
    return {
      success: true,
      message:
        'Blizzard API configuration saved. WoW Armory import is now enabled.',
    };
  }

  @Post('blizzard/test')
  @RequirePlugin(BLIZZARD_PLUGIN_SLUG)
  @UseGuards(PluginActiveGuard)
  @HttpCode(HttpStatus.OK)
  async testBlizzardConfig(): Promise<OAuthTestResponse> {
    const config = await this.settingsService.getBlizzardConfig();
    if (!config)
      return { success: false, message: 'Blizzard API is not configured' };
    return testBlizzardCredentials(config);
  }

  @Post('blizzard/clear')
  @HttpCode(HttpStatus.OK)
  async clearBlizzardConfig(): Promise<{ success: boolean; message: string }> {
    await Promise.all([
      this.settingsService.delete(SETTING_KEYS.BLIZZARD_CLIENT_ID),
      this.settingsService.delete(SETTING_KEYS.BLIZZARD_CLIENT_SECRET),
    ]);
    this.settingsService['eventEmitter'].emit(
      'settings.blizzard.updated',
      null,
    );
    this.logger.log('Blizzard API configuration cleared via admin UI');
    return { success: true, message: 'Blizzard API configuration cleared.' };
  }
}
