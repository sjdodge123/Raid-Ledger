/**
 * ROK-1591: `GET /users/me/calendars` — the user's Calendar Sync overview.
 *
 * Deliberately NOT behind CalendarSyncEnabledGuard: with the kill switch off
 * the page still loads and reads `enabled: false`. The OAuth, PATCH and
 * DELETE routes (ROK-1592/1596) are the guard's consumers.
 */
import { Controller, Get, Inject, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { CalendarsOverview } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import type { AuthenticatedRequest } from '../../auth/types';
import { SettingsService } from '../../settings/settings.service';
import { buildCalendarsOverview } from '../services/calendar-overview.helpers';

@Controller('users/me/calendars')
@UseGuards(AuthGuard('jwt'))
export class CalendarConnectionsController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  getOverview(
    @Request() req: AuthenticatedRequest,
  ): Promise<CalendarsOverview> {
    return buildCalendarsOverview(this.db, this.settings, req.user.id);
  }
}
