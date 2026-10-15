/**
 * ROK-1599: the public ICS subscribe feed, `GET /api/cal/u/<token>.ics`.
 *
 * No session — the token in the path IS the credential. Every failure is
 * the same 404 (malformed name, unknown / reset / deleted token, kill switch
 * off); never a 401/403 that would tell a prober anything. The token is
 * never logged — log the user id. Window and content: see
 * `calendar-feed-content.helpers.ts`.
 *
 * Express 5 path syntax makes `:token.ics` fragile, so the route takes the
 * whole file name and the regex below splits it.
 */
import {
  Controller,
  Get,
  Header,
  Inject,
  Logger,
  NotFoundException,
  Param,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { SettingsService } from '../../settings/settings.service';
import { getCalendarSyncEnabled } from '../../settings/settings-calendar-sync.helpers';
import { RateLimit } from '../../throttler/rate-limit.decorator';
import { findFeedUserByToken } from '../feed/calendar-feed-token.helpers';
import {
  buildFeedCalendar,
  loadFeedEntries,
} from '../feed/calendar-feed-content.helpers';
import { touchFeedFetched } from '../feed/calendar-feed-view.helpers';
import { serializeIcsCalendar } from '../feed/ics-serialize.helpers';

/** `<43 base64url chars>.ics` — the only file name that can resolve. */
export const FEED_FILE_PATTERN = /^([A-Za-z0-9_-]{43})\.ics$/;

@Controller('cal/u')
export class CalendarFeedPublicController {
  private readonly logger = new Logger(CalendarFeedPublicController.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settings: SettingsService,
  ) {}

  @Get(':file')
  @RateLimit('calendarFeed')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Cache-Control', 'private, max-age=900')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('Content-Disposition', 'inline; filename="raid-ledger.ics"')
  async feed(@Param('file') file: string): Promise<string> {
    const userId = await this.resolveOwner(file);
    if (userId === null) throw new NotFoundException();
    const now = new Date();
    const entries = await loadFeedEntries(this.db, userId, now);
    const clientUrl = await this.settings.getClientUrl();
    this.stampFetched(userId);
    return serializeIcsCalendar(
      buildFeedCalendar(entries, { clientUrl, userId, now }),
    );
  }

  /** The owner's id, or null for every kind of miss (all 404 alike). */
  private async resolveOwner(file: string): Promise<number | null> {
    const token = FEED_FILE_PATTERN.exec(file)?.[1];
    if (token === undefined) return null;
    if (!(await getCalendarSyncEnabled(this.settings))) return null;
    return findFeedUserByToken(this.db, token);
  }

  /** Fire and forget: a failed stamp must never fail the feed. */
  private stampFetched(userId: number): void {
    touchFeedFetched(this.db, userId).catch((err: unknown) => {
      const name = err instanceof Error ? err.name : 'unknown';
      this.logger.warn(`feed fetch stamp failed for user ${userId} (${name})`);
    });
  }
}
