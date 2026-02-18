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
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import { DiscordBotService } from './discord-bot.service';
import { DiscordBotClientService } from './discord-bot-client.service';
import { SettingsService } from '../settings/settings.service';
import {
  DiscordBotConfigSchema,
  DiscordBotTestConnectionSchema,
  type DiscordBotStatusResponse,
  type DiscordBotTestResult,
} from '@raid-ledger/contract';
import { ZodError } from 'zod';

/**
 * Handle Zod validation errors by converting to BadRequestException.
 */
function handleValidationError(error: unknown): never {
  if (error instanceof Error && error.name === 'ZodError') {
    const zodError = error as ZodError;
    throw new BadRequestException({
      message: 'Validation failed',
      errors: zodError.issues.map((e) => `${e.path.join('.')}: ${e.message}`),
    });
  }
  throw error;
}

@Controller('admin/settings/discord-bot')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DiscordBotSettingsController {
  private readonly logger = new Logger(DiscordBotSettingsController.name);

  constructor(
    private readonly discordBotService: DiscordBotService,
    private readonly discordBotClientService: DiscordBotClientService,
    private readonly settingsService: SettingsService,
  ) {}

  @Get()
  async getStatus(): Promise<DiscordBotStatusResponse> {
    return this.discordBotService.getStatus();
  }

  @Get('permissions')
  checkPermissions(): {
    allGranted: boolean;
    permissions: { name: string; granted: boolean }[];
  } {
    return this.discordBotService.checkPermissions();
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  async updateConfig(
    @Body() body: unknown,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const config = DiscordBotConfigSchema.parse(body);

      await this.settingsService.setDiscordBotConfig(
        config.botToken,
        config.enabled,
      );

      this.logger.log('Discord bot configuration updated via admin UI');

      return {
        success: true,
        message: 'Configuration saved.',
      };
    } catch (error) {
      handleValidationError(error);
    }
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  async testConnection(@Body() body: unknown): Promise<DiscordBotTestResult> {
    try {
      const dto = DiscordBotTestConnectionSchema.parse(body);

      // Use provided token or fall back to stored one
      let token = dto.botToken;

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
    } catch (error) {
      handleValidationError(error);
    }
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

  @Get('channels')
  getChannels(): { id: string; name: string }[] {
    return this.discordBotClientService.getTextChannels();
  }

  @Get('channel')
  async getDefaultChannel(): Promise<{ channelId: string | null }> {
    const channelId = await this.settingsService.getDiscordBotDefaultChannel();
    return { channelId };
  }

  @Put('channel')
  @HttpCode(HttpStatus.OK)
  async setDefaultChannel(
    @Body() body: unknown,
  ): Promise<{ success: boolean; message: string }> {
    if (
      !body ||
      typeof body !== 'object' ||
      !('channelId' in body) ||
      typeof (body as Record<string, unknown>).channelId !== 'string' ||
      !(body as Record<string, unknown>).channelId
    ) {
      throw new BadRequestException(
        'channelId is required and must be a non-empty string',
      );
    }

    await this.settingsService.setDiscordBotDefaultChannel(
      (body as Record<string, unknown>).channelId as string,
    );

    this.logger.log('Discord bot default channel updated via admin UI');

    return {
      success: true,
      message: 'Default channel updated.',
    };
  }
}
