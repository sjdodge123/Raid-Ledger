/**
 * ROK-1591/1592: the user's own Calendar Sync routes.
 *
 * - `GET /users/me/calendars` — the overview. NOT behind
 *   CalendarSyncEnabledGuard: with the kill switch off the page still loads
 *   and reads `enabled: false`.
 * - `DELETE /users/me/calendars/:id` — disconnect (L9). Also NOT behind the
 *   guard (operator ruling Q-E, 2026-10-08): a user can always remove stored
 *   credentials, even while the switch is off. Another user's id → 404.
 *   ROK-1596 D7: marks the row `disconnecting` and queues the cleanup → 202.
 * - `PATCH /users/me/calendars/:id` — send-my-events settings (ROK-1596 D6),
 *   behind the guard. 204; the remote work is queued.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Request,
  UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { AuthGuard } from '@nestjs/passport';
import type { Queue } from 'bullmq';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { CalendarsOverview } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import type { AuthenticatedRequest } from '../../auth/types';
import { SettingsService } from '../../settings/settings.service';
import { buildCalendarsOverview } from '../services/calendar-overview.helpers';
import { markCalendarDisconnecting } from '../services/calendar-disconnect.helpers';
import { updateCalendarWriteSettings } from '../services/calendar-write-settings.helpers';
import { getCalendarSyncEnabled } from '../../settings/settings-calendar-sync.helpers';
import { CALENDAR_WRITE_QUEUE } from '../calendar-sync.constants';
import { enqueueCalendarWriteJob } from '../write/calendar-write.enqueue.helpers';
import { CalendarSyncEnabledGuard } from '../calendar-sync-enabled.guard';

@Controller('users/me/calendars')
@UseGuards(AuthGuard('jwt'))
export class CalendarConnectionsController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settings: SettingsService,
    @InjectQueue(CALENDAR_WRITE_QUEUE) private readonly queue: Queue,
  ) {}

  @Get()
  getOverview(
    @Request() req: AuthenticatedRequest,
  ): Promise<CalendarsOverview> {
    return buildCalendarsOverview(this.db, this.settings, req.user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.ACCEPTED)
  async disconnect(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    const input = { userId: req.user.id, connectionId: id };
    if (!(await markCalendarDisconnecting(this.db, input))) {
      throw new NotFoundException();
    }
    await enqueueCalendarWriteJob(this.enqueueDeps(), {
      kind: 'disconnect',
      connectionId: id,
    });
  }

  private enqueueDeps() {
    return {
      queue: this.queue,
      isSyncEnabled: () => getCalendarSyncEnabled(this.settings),
    };
  }

  @Patch(':id')
  @UseGuards(CalendarSyncEnabledGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async updateSettings(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<void> {
    const deps = { db: this.db, ...this.enqueueDeps() };
    await updateCalendarWriteSettings(deps, {
      userId: req.user.id,
      connectionId: id,
      body,
    });
  }
}
