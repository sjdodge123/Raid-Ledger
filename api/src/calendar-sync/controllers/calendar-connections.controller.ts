/**
 * ROK-1591/1592: the user's own Calendar Sync routes.
 *
 * - `GET /users/me/calendars` — the overview. NOT behind
 *   CalendarSyncEnabledGuard: with the kill switch off the page still loads
 *   and reads `enabled: false`.
 * - `DELETE /users/me/calendars/:id` — disconnect (L9). Also NOT behind the
 *   guard (operator ruling Q-E, 2026-10-08): a user can always remove stored
 *   credentials, even while the switch is off. Another user's id → 404.
 */
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { CalendarsOverview } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import type { AuthenticatedRequest } from '../../auth/types';
import { SettingsService } from '../../settings/settings.service';
import { CalendarProviderRegistry } from '../providers/calendar-provider.registry';
import { buildCalendarsOverview } from '../services/calendar-overview.helpers';
import { runCalendarDisconnect } from '../services/calendar-disconnect.helpers';

@Controller('users/me/calendars')
@UseGuards(AuthGuard('jwt'))
export class CalendarConnectionsController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settings: SettingsService,
    private readonly registry: CalendarProviderRegistry,
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
    const result = await runCalendarDisconnect(this.db, this.registry, {
      userId: req.user.id,
      connectionId: id,
    });
    if (!result.found) throw new NotFoundException();
  }
}
