import {
  Controller,
  Get,
  Put,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import { SettingsService } from '../settings/settings.service';
import {
  getWeeklyDigestSettings,
  setWeeklyDigestSettings,
} from '../settings/settings-discord.helpers';
import {
  parseDigestSlot,
  safeTimeZone,
} from '../notifications/weekly-digest-schedule.helpers';
import {
  WeeklyDigestSettingsSchema,
  type WeeklyDigestDay,
  type WeeklyDigestSettingsResponse,
} from '@raid-ledger/contract';
import { handleValidationError } from './validation.util';

/**
 * ROK-1435 (L5): the weekly digest's admin settings — master toggle, the
 * dedicated channel (null ⇒ the bot's default channel), and the day + hour the
 * hourly cron posts on, read in the community timezone.
 */
@Controller('admin/settings/discord-bot')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class WeeklyDigestSettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  /** Current settings with defaults applied (off, Monday 09:00, fallback channel). */
  @Get('weekly-digest')
  async getSettings(): Promise<WeeklyDigestSettingsResponse> {
    const [raw, zone] = await Promise.all([
      getWeeklyDigestSettings(this.settingsService),
      this.settingsService.getDefaultTimezone(),
    ]);
    const slot = parseDigestSlot(raw.day, raw.hour);
    return {
      enabled: raw.enabled === 'true',
      channelId: raw.channelId?.trim() || null,
      day: slot.day as WeeklyDigestDay,
      hour: slot.hour,
      timezone: safeTimeZone(zone),
    };
  }

  /**
   * Replace all four settings at once.
   *
   * @param body - `WeeklyDigestSettings`, validated by the contract schema (400 on a bad day/hour).
   * @returns The persisted settings, read back.
   */
  @Put('weekly-digest')
  @HttpCode(HttpStatus.OK)
  async setSettings(
    @Body() body: unknown,
  ): Promise<WeeklyDigestSettingsResponse> {
    try {
      const parsed = WeeklyDigestSettingsSchema.parse(body);
      await setWeeklyDigestSettings(this.settingsService, parsed);
    } catch (error) {
      handleValidationError(error);
    }
    return this.getSettings();
  }
}
