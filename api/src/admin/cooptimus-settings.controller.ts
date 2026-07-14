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
import { CooptimusConfigDto } from './settings.dto';
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
  async getStatus(): Promise<{ configured: boolean }> {
    return { configured: await this.settingsService.isCooptimusConfigured() };
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  async updateConfig(@Body() body: CooptimusConfigDto) {
    await this.settingsService.setCooptimusUserAgent(body.userAgent.trim());
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
