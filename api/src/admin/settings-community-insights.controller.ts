/**
 * Admin Community Insights Settings Controller (ROK-1099).
 * Persists the churn-risk threshold used by the nightly snapshot cron.
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
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import { CommunityInsightsSettingsDto } from './settings-community-insights.dto';

const DEFAULT_CHURN_THRESHOLD_PCT = 70;

@Controller('admin/settings')
@UseGuards(AuthGuard('jwt'), AdminGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class CommunityInsightsSettingsController {
  private readonly logger = new Logger(CommunityInsightsSettingsController.name);

  constructor(private readonly settingsService: SettingsService) {}

  @Get('community-insights')
  async getSettings() {
    const raw = await this.settingsService.get(
      SETTING_KEYS.COMMUNITY_INSIGHTS_CHURN_THRESHOLD_PCT,
    );
    const parsed = raw == null || raw === '' ? NaN : Number(raw);
    return {
      churnThresholdPct: Number.isFinite(parsed)
        ? parsed
        : DEFAULT_CHURN_THRESHOLD_PCT,
    };
  }

  @Put('community-insights')
  @HttpCode(HttpStatus.OK)
  async updateSettings(
    @Body() body: CommunityInsightsSettingsDto,
  ): Promise<{ success: boolean; message: string }> {
    if (body.churnThresholdPct != null) {
      await this.settingsService.set(
        SETTING_KEYS.COMMUNITY_INSIGHTS_CHURN_THRESHOLD_PCT,
        String(body.churnThresholdPct),
      );
      this.logger.log(
        `Community Insights churn threshold updated → ${body.churnThresholdPct}%`,
      );
    }
    return { success: true, message: 'Community Insights settings updated.' };
  }
}
