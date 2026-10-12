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
  Inject,
  Logger,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  UpdateAdminCalendarSyncSettingsSchema,
  type AdminCalendarSyncSettings,
} from '@raid-ledger/contract';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { AdminGuard } from '../../auth/admin.guard';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import type * as schema from '../../drizzle/schema';
import { GameTimeService } from '../../users/game-time.service';
import { CALENDAR_READ_QUEUE } from '../calendar-sync.constants';
import { SettingsService } from '../../settings/settings.service';
import {
  applyAdminCalendarSyncUpdate,
  buildAdminCalendarSyncSettings,
} from '../services/calendar-sync-admin.helpers';

@Controller('admin/settings/calendar-sync')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class CalendarSyncAdminController {
  private readonly logger = new Logger(CalendarSyncAdminController.name);

  constructor(
    private readonly settings: SettingsService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    @InjectQueue(CALENDAR_READ_QUEUE) private readonly readQueue: Queue,
    private readonly gameTime: GameTimeService,
  ) {}

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
    await applyAdminCalendarSyncUpdate(this.settings, parsed.data, {
      db: this.db,
      readQueue: this.readQueue,
      invalidateUser: (u) => this.gameTime.invalidateUserCache(u),
    });
    this.logger.log(
      `Calendar sync settings updated via admin UI (fields: ${Object.keys(parsed.data).join(', ') || 'none'})`,
    );
    return buildAdminCalendarSyncSettings(this.settings);
  }
}
