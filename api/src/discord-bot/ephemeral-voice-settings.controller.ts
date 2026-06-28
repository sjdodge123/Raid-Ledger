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
import { DiscordBotClientService } from './discord-bot-client.service';
import { listGuildCategories } from './discord-bot-client.guild.helpers';
import { SettingsService } from '../settings/settings.service';
import {
  SetEphemeralVoiceConfigSchema,
  type EphemeralVoiceConfig,
  type DiscordCategorySummaryDto,
} from '@raid-ledger/contract';
import { handleValidationError } from './validation.util';

/**
 * ROK-1352: Admin endpoints for the ephemeral-voice feature, split into its own
 * controller so `discord-bot-settings.controller.ts` stays under the 300-line cap.
 */
@Controller('admin/settings/discord-bot/ephemeral-voice')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class EphemeralVoiceSettingsController {
  private readonly logger = new Logger(EphemeralVoiceSettingsController.name);

  constructor(
    private readonly settingsService: SettingsService,
    private readonly clientService: DiscordBotClientService,
  ) {}

  /** Current ephemeral-voice config. */
  @Get()
  async getConfig(): Promise<EphemeralVoiceConfig> {
    const [enabled, forced, categoryId, createBufferMinutes, idleMinutes] =
      await Promise.all([
        this.settingsService.getEphemeralVoiceEnabled(),
        this.settingsService.getEphemeralVoiceForced(),
        this.settingsService.getEphemeralVoiceCategoryId(),
        this.settingsService.getEphemeralVoiceCreateBufferMinutes(),
        this.settingsService.getEphemeralVoiceIdleMinutes(),
      ]);
    return { enabled, forced, categoryId, createBufferMinutes, idleMinutes };
  }

  /** Partial update of the ephemeral-voice config. */
  @Put()
  @HttpCode(HttpStatus.OK)
  async setConfig(
    @Body() body: unknown,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const cfg = SetEphemeralVoiceConfigSchema.parse(body);
      await this.persist(cfg);
      this.logger.log('Ephemeral-voice config updated via admin UI');
      return { success: true, message: 'Ephemeral voice settings saved.' };
    } catch (error) {
      handleValidationError(error);
    }
  }

  /** Guild categories for the parent-category picker. */
  @Get('categories')
  getCategories(): DiscordCategorySummaryDto[] {
    return listGuildCategories(this.clientService.getGuild());
  }

  /** Apply only the fields present in a partial update. */
  private async persist(cfg: Partial<EphemeralVoiceConfig>): Promise<void> {
    if (cfg.enabled !== undefined)
      await this.settingsService.setEphemeralVoiceEnabled(cfg.enabled);
    if (cfg.forced !== undefined)
      await this.settingsService.setEphemeralVoiceForced(cfg.forced);
    if (cfg.categoryId !== undefined)
      await this.settingsService.setEphemeralVoiceCategoryId(cfg.categoryId);
    if (cfg.createBufferMinutes !== undefined)
      await this.settingsService.setEphemeralVoiceCreateBufferMinutes(
        cfg.createBufferMinutes,
      );
    if (cfg.idleMinutes !== undefined)
      await this.settingsService.setEphemeralVoiceIdleMinutes(cfg.idleMinutes);
  }
}
