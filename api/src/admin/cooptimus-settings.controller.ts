/**
 * Admin Co-Optimus Settings Controller (ROK-1397).
 *
 * Stores the allowlisted user-agent Co-Optimus grants us (permission-first,
 * ROK-275) — no API key exists; the site is keyless behind a Cloudflare bot
 * wall. `POST /test` fires one real request so the operator can verify the
 * allowlisting end-to-end (a 403 is reported as exactly that).
 */
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
import { CooptimusService } from '../cooptimus/cooptimus.service';
import { CooptimusConfigDto, CooptimusProseDto } from './settings.dto';
import type { OAuthTestResponse } from './settings.dto';

@Controller('admin/settings/cooptimus')
@UseGuards(AuthGuard('jwt'), AdminGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class CooptimusSettingsController {
  private readonly logger = new Logger(CooptimusSettingsController.name);

  constructor(
    private readonly settingsService: SettingsService,
    private readonly cooptimusService: CooptimusService,
  ) {}

  @Get()
  async getStatus(): Promise<{ configured: boolean; proseEnabled: boolean }> {
    return {
      configured: await this.settingsService.isCooptimusConfigured(),
      proseEnabled: await this.settingsService.getCooptimusProseEnabled(),
    };
  }

  /**
   * ROK-1398: editorial-prose opt-in. A dedicated sub-route so the operator can
   * flip the toggle without re-submitting the allowlisted user-agent (the main
   * PUT still requires it). Prose is stripped server-side while this is false.
   */
  @Put('prose')
  @HttpCode(HttpStatus.OK)
  async updateProse(@Body() body: CooptimusProseDto) {
    await this.settingsService.setCooptimusProseEnabled(body.enabled);
    this.logger.log(`Co-Optimus prose display set to ${body.enabled}`);
    return {
      success: true,
      message: body.enabled
        ? 'Co-Optimus editorial prose will now render on game detail pages.'
        : 'Co-Optimus editorial prose hidden — co-op facts still render.',
    };
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  async updateConfig(@Body() body: CooptimusConfigDto) {
    await this.settingsService.setCooptimusUserAgent(body.userAgent.trim());
    if (body.proseEnabled !== undefined) {
      await this.settingsService.setCooptimusProseEnabled(body.proseEnabled);
    }
    this.logger.log('Co-Optimus user-agent updated via admin UI');
    return {
      success: true,
      message:
        'Co-Optimus user-agent saved. Co-op enrichment syncs weekly (next cron), or use Test to verify access now.',
    };
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  async testConfig(): Promise<OAuthTestResponse> {
    return this.cooptimusService.testConnection();
  }

  @Post('clear')
  @HttpCode(HttpStatus.OK)
  async clearConfig() {
    await this.settingsService.clearCooptimusConfig();
    this.logger.log('Co-Optimus user-agent cleared via admin UI');
    return { success: true, message: 'Co-Optimus user-agent cleared.' };
  }
}
