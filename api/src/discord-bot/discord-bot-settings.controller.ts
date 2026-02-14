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
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import { DiscordBotService } from './discord-bot.service';
import { SettingsService } from '../settings/settings.service';
import type {
  DiscordBotStatusResponse,
  DiscordBotTestResult,
} from '@raid-ledger/contract';

@Controller('admin/settings/discord-bot')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DiscordBotSettingsController {
  private readonly logger = new Logger(DiscordBotSettingsController.name);

  constructor(
    private readonly discordBotService: DiscordBotService,
    private readonly settingsService: SettingsService,
  ) {}

  @Get()
  async getStatus(): Promise<DiscordBotStatusResponse> {
    return this.discordBotService.getStatus();
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  async updateConfig(
    @Body() body: { botToken: string; enabled: boolean },
  ): Promise<{ success: boolean; message: string }> {
    if (!body.botToken || typeof body.enabled !== 'boolean') {
      return {
        success: false,
        message: 'Bot token and enabled flag are required',
      };
    }

    await this.settingsService.setDiscordBotConfig(body.botToken, body.enabled);

    this.logger.log('Discord bot configuration updated via admin UI');

    return {
      success: true,
      message: body.enabled
        ? 'Discord bot configuration saved and bot is starting...'
        : 'Discord bot configuration saved. Bot is disabled.',
    };
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  async testConnection(
    @Body() body: { botToken?: string },
  ): Promise<DiscordBotTestResult> {
    // Use provided token or fall back to stored one
    let token = body?.botToken;

    if (!token) {
      const config = await this.settingsService.getDiscordBotConfig();
      if (!config) {
        return {
          success: false,
          message: 'No bot token configured',
        };
      }
      token = config.token;
    }

    return this.discordBotService.testToken(token);
  }

  @Post('clear')
  @HttpCode(HttpStatus.OK)
  async clearConfig(): Promise<{
    success: boolean;
    message: string;
  }> {
    await this.settingsService.clearDiscordBotConfig();

    this.logger.log('Discord bot configuration cleared via admin UI');

    return {
      success: true,
      message: 'Discord bot configuration cleared.',
    };
  }
}
