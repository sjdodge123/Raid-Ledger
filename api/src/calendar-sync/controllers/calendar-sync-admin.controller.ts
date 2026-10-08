/**
 * ROK-1591: admin kill switch + OAuth client config for Calendar Sync.
 * Guards copy `admin/itad-settings.controller.ts`.
 */
import {
  BadRequestException,
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
import {
  UpdateAdminCalendarSyncSettingsSchema,
  type AdminCalendarSyncSettings,
} from '@raid-ledger/contract';
import { AdminGuard } from '../../auth/admin.guard';
import { SettingsService } from '../../settings/settings.service';
import {
  applyAdminCalendarSyncUpdate,
  buildAdminCalendarSyncSettings,
} from '../services/calendar-sync-admin.helpers';

@Controller('admin/settings/calendar-sync')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class CalendarSyncAdminController {
  private readonly logger = new Logger(CalendarSyncAdminController.name);

  constructor(private readonly settings: SettingsService) {}

  @Get()
  getSettings(): Promise<AdminCalendarSyncSettings> {
    return buildAdminCalendarSyncSettings(this.settings);
  }

  /** Omitted field = unchanged; '' clears. Returns the fresh read shape. */
  @Put()
  @HttpCode(HttpStatus.OK)
  async updateSettings(
    @Body() body: unknown,
  ): Promise<AdminCalendarSyncSettings> {
    const parsed = UpdateAdminCalendarSyncSettingsSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: parsed.error.issues.map(
          (e) => `${e.path.join('.')}: ${e.message}`,
        ),
      });
    }
    await applyAdminCalendarSyncUpdate(this.settings, parsed.data);
    this.logger.log(
      `Calendar sync settings updated via admin UI (fields: ${Object.keys(parsed.data).join(', ') || 'none'})`,
    );
    return buildAdminCalendarSyncSettings(this.settings);
  }
}
