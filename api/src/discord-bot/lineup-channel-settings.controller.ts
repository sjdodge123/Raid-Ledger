/**
 * Admin controller for Community Lineup Discord channel settings (ROK-932).
 * Separate from the main DiscordBotSettingsController to stay under
 * the 300-line file limit.
 */
import {
  Controller,
  Get,
  Put,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import { SettingsService } from '../settings/settings.service';
import {
  getDiscordBotLineupChannel,
  setDiscordBotLineupChannel,
} from '../settings/settings-discord.helpers';
import { DiscordBotSetDefaultChannelSchema } from '@raid-ledger/contract';
import { handleValidationError } from '../common/validation.util';

@Controller('admin/settings/discord-bot')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class LineupChannelSettingsController {
  private readonly logger = new Logger(LineupChannelSettingsController.name);

  constructor(private readonly settingsService: SettingsService) {}

  /** Get the current lineup notification channel. */
  @Get('lineup-channel')
  async getLineupChannel(): Promise<{ channelId: string | null }> {
    const channelId = await getDiscordBotLineupChannel(this.settingsService);
    return { channelId };
  }

  /** Set the lineup notification channel. */
  @Put('lineup-channel')
  @HttpCode(HttpStatus.OK)
  async setLineupChannel(
    @Body() body: unknown,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const { channelId } = DiscordBotSetDefaultChannelSchema.parse(body);
      await setDiscordBotLineupChannel(this.settingsService, channelId);
      this.logger.log('Lineup channel updated via admin UI');
      return { success: true, message: 'Lineup channel updated.' };
    } catch (error) {
      handleValidationError(error);
    }
  }
}
