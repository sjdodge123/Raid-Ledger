/**
 * Admin ITAD Settings Controller (ROK-772).
 * Extracted to a separate file for file size compliance.
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
import { testItadApiKey } from './settings-api-test.helpers';
import { ItadConfigDto } from './settings.dto';
import type { OAuthTestResponse } from './settings.dto';

@Controller('admin/settings/itad')
@UseGuards(AuthGuard('jwt'), AdminGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class ItadSettingsController {
  private readonly logger = new Logger(ItadSettingsController.name);

  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  async getItadStatus(): Promise<{ configured: boolean }> {
    return { configured: await this.settingsService.isItadConfigured() };
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  async updateItadConfig(@Body() body: ItadConfigDto) {
    await this.settingsService.setItadApiKey(body.apiKey.trim());
    this.logger.log('ITAD API key updated via admin UI');
    return {
      success: true,
      message: 'ITAD API key saved. Deal tracking is now enabled.',
    };
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  async testItadConfig(): Promise<OAuthTestResponse> {
    const apiKey = await this.settingsService.getItadApiKey();
    if (!apiKey)
      return { success: false, message: 'ITAD API key is not configured' };
    return testItadApiKey(apiKey);
  }

  @Post('clear')
  @HttpCode(HttpStatus.OK)
  async clearItadConfig() {
    await this.settingsService.clearItadConfig();
    this.logger.log('ITAD API key cleared via admin UI');
    return { success: true, message: 'ITAD API key cleared.' };
  }
}
