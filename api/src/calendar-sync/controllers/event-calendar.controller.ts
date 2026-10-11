/**
 * ROK-1596 D9: the event page's calendar routes.
 *
 * - `GET /users/me/calendars/events/:eventId` — the viewer's copy state, or
 *   null. Not behind the kill switch: with it off the route answers null so
 *   the page falls back to "Add to calendar" (which works switch-off, F10).
 * - `POST /users/me/calendars/events/:eventId/undo` — 204; suppresses that one
 *   copy (Q4). Behind `CalendarSyncEnabledGuard` (it calls the provider).
 * - `GET /events/:id/ics` — one VEVENT. Visibility is EXACTLY `GET
 *   /events/:id` (F7): the same `OptionalJwtGuard` and the same
 *   `findEventForViewer` call, so an event that route 404s 404s here too.
 *   Not behind the kill switch (F10).
 */
import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { EventCalendarCopy } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import type { AuthenticatedRequest } from '../../auth/types';
import { OptionalJwtGuard } from '../../auth/optional-jwt.guard';
import { EventsService } from '../../events/events.service';
import {
  findEventForViewer,
  type EventViewer,
} from '../../events/events-public-read.helpers';
import { SettingsService } from '../../settings/settings.service';
import { getCalendarSyncEnabled } from '../../settings/settings-calendar-sync.helpers';
import { CalendarSyncEnabledGuard } from '../calendar-sync-enabled.guard';
import { CalendarProviderRegistry } from '../providers/calendar-provider.registry';
import {
  getEventCalendarCopy,
  undoEventCalendarCopy,
} from '../services/event-calendar-copy.helpers';
import {
  serializeIcsCalendar,
  type IcsEvent,
} from '../feed/ics-serialize.helpers';
import { eventPageUrl } from '../write/calendar-write-copy.helpers';

export const ICS_PROD_ID = '-//Raid Ledger//Event//EN';

/** One event as a VEVENT; UID `rl-<id>@<instance host>` is stable (D9). */
function toIcsEvent(
  id: number,
  event: Awaited<ReturnType<typeof findEventForViewer>>,
  clientUrl: string,
): IcsEvent {
  const url = eventPageUrl(clientUrl, id);
  return {
    uid: `rl-${id}@${new URL(clientUrl).host}`,
    stamp: new Date(),
    start: new Date(event.startTime),
    end: new Date(event.endTime),
    summary: event.title,
    description: url,
    url,
    ...(event.cancelledAt ? { status: 'CANCELLED' as const } : {}),
  };
}

@Controller()
export class EventCalendarController {
  private readonly logger = new Logger(EventCalendarController.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settings: SettingsService,
    private readonly registry: CalendarProviderRegistry,
    private readonly eventsService: EventsService,
  ) {}

  @Get('users/me/calendars/events/:eventId')
  @UseGuards(AuthGuard('jwt'))
  async getCopy(
    @Request() req: AuthenticatedRequest,
    @Param('eventId', ParseIntPipe) eventId: number,
  ): Promise<EventCalendarCopy | null> {
    if (!(await getCalendarSyncEnabled(this.settings))) return null;
    return getEventCalendarCopy(this.db, req.user.id, eventId);
  }

  @Post('users/me/calendars/events/:eventId/undo')
  @UseGuards(AuthGuard('jwt'), CalendarSyncEnabledGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async undo(
    @Request() req: AuthenticatedRequest,
    @Param('eventId', ParseIntPipe) eventId: number,
  ): Promise<void> {
    const deps = {
      db: this.db,
      registry: this.registry,
      onRemoteError: (err: unknown) =>
        this.logger.warn(
          `undo: remote delete failed (${(err as Error)?.name ?? 'error'})`,
        ),
    };
    const found = await undoEventCalendarCopy(deps, req.user.id, eventId);
    if (!found) throw new NotFoundException();
  }

  @Get('events/:id/ics')
  @UseGuards(OptionalJwtGuard)
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  async getIcs(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: { user?: NonNullable<EventViewer> },
  ): Promise<string> {
    const event = await findEventForViewer(
      this.db,
      this.eventsService,
      id,
      req.user,
    );
    const clientUrl = await this.settings.getClientUrl();
    return serializeIcsCalendar({
      prodId: ICS_PROD_ID,
      events: [toIcsEvent(id, event, clientUrl)],
    });
  }
}
