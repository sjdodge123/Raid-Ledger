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
  readSessionLength,
  persistSessionLength,
} from './settings-session.helpers';

/**
 * ROK-1353: admin session-length endpoints. Split out of
 * AdminSettingsController, which is already at the 300-line ESLint cap.
 */
@Controller('admin/settings')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class AdminSessionController {
  private readonly logger = new Logger(AdminSessionController.name);

  constructor(private readonly settingsService: SettingsService) {}

  @Get('session')
  getSessionLength() {
    return readSessionLength(this.settingsService);
  }

  @Put('session')
  @HttpCode(HttpStatus.OK)
  updateSessionLength(@Body() body: { sessionLengthDays?: unknown }) {
    return persistSessionLength(this.settingsService, this.logger, body);
  }
}
