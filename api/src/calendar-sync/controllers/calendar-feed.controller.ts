/**
 * ROK-1599: the owner's subscribe-link routes (epic ROK-669 §10 Story 9).
 * All behind the kill switch (off → 404) like the other user routes.
 *
 * - `GET    /users/me/calendars/feed` → `{ url }`, or null with no feed.
 * - `POST   /users/me/calendars/feed` → create, or reset (rotate) → `{ url }`.
 *   A reset kills the old link at once.
 * - `DELETE /users/me/calendars/feed` → 204; the link stops resolving.
 *
 * Registered BEFORE `CalendarConnectionsController`, whose `DELETE :id`
 * would otherwise claim `DELETE feed` (and 400 it through ParseIntPipe).
 * Tentative sign-ups are always in the feed — there is no include toggle
 * (operator ruling OPERATOR-2).
 */
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { CalendarFeed } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import type { AuthenticatedRequest } from '../../auth/types';
import { SettingsService } from '../../settings/settings.service';
import { CalendarSyncEnabledGuard } from '../calendar-sync-enabled.guard';
import {
  revokeFeed,
  upsertFeedToken,
} from '../feed/calendar-feed-token.helpers';
import { buildFeedUrl, loadFeedView } from '../feed/calendar-feed-view.helpers';

@Controller('users/me/calendars/feed')
@UseGuards(AuthGuard('jwt'), CalendarSyncEnabledGuard)
export class CalendarFeedController {
  private readonly logger = new Logger(CalendarFeedController.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  get(@Request() req: AuthenticatedRequest): Promise<CalendarFeed | null> {
    return loadFeedView(this.db, this.settings, req.user.id);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async createOrReset(
    @Request() req: AuthenticatedRequest,
  ): Promise<CalendarFeed> {
    const token = await upsertFeedToken(this.db, req.user.id);
    this.logger.log(`feed link issued for user ${req.user.id}`);
    return { url: buildFeedUrl(await this.settings.getClientUrl(), token) };
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(@Request() req: AuthenticatedRequest): Promise<void> {
    if (await revokeFeed(this.db, req.user.id)) {
      this.logger.log(`feed link revoked for user ${req.user.id}`);
    }
  }
}
