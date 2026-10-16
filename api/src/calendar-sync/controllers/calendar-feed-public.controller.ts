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
 *
 * The calendar headers are set in the handler, on success only: an `@Header`
 * decorator is applied BEFORE the handler runs, so a 404 would have carried
 * `Cache-Control: private, max-age=900` and been cached as a miss. A miss is
 * `no-store` (Codex r3 minor).
 */
import {
  Controller,
  Get,
  Header,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
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

/** The success-only headers of a served feed. */
function setCalendarHeaders(res: Response): void {
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Cache-Control', 'private, max-age=900');
  res.setHeader('Content-Disposition', 'inline; filename="raid-ledger.ics"');
}

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
  @Header('Referrer-Policy', 'no-referrer')
  async feed(
    @Param('file') file: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const userId = await this.resolveOwner(file);
    if (userId === null) {
      res.setHeader('Cache-Control', 'no-store');
      throw new NotFoundException();
    }
    const now = new Date();
    const entries = await loadFeedEntries(this.db, userId, now);
    const clientUrl = await this.settings.getClientUrl();
    this.stampFetched(userId);
    setCalendarHeaders(res);
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
