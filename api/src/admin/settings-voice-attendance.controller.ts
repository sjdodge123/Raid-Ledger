/**
 * Admin Voice Attendance Settings Controller (ROK-1940).
 * The grace window after an event's start before a first voice join counts
 * as late. Read per classification cron tick, so a save applies forward only.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { VoiceAttendanceSettingsDto } from '@raid-ledger/contract';
import { AdminGuard } from '../auth/admin.guard';
import { SettingsService } from '../settings/settings.service';
import {
  persistVoiceAttendanceSettings,
  readVoiceAttendanceSettings,
} from './settings-voice-attendance.helpers';

@Controller('admin/settings')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class VoiceAttendanceSettingsController {
  private readonly logger = new Logger(VoiceAttendanceSettingsController.name);

  constructor(private readonly settingsService: SettingsService) {}

  @Get('voice-attendance')
  getSettings(): Promise<VoiceAttendanceSettingsDto> {
    return readVoiceAttendanceSettings(this.settingsService);
  }

  @Put('voice-attendance')
  @HttpCode(HttpStatus.OK)
  updateSettings(@Body() body: unknown): Promise<VoiceAttendanceSettingsDto> {
    return persistVoiceAttendanceSettings(
      this.settingsService,
      this.logger,
      body,
    );
  }
}
