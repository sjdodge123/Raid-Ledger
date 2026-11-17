/**
 * DemoTestEventDiscussionController (ROK-2226 L5) —
 * `POST /admin/test/hubs/:id/event-discussion/seed`.
 *
 * Body `{ memberUserId, readerUserId, tag? }`: replaces the hub's
 * event-discussion fixture (`demo-test-event-discussion.helpers.ts`) — an open
 * event with a replied thread and a locked (ended > 24 h) one; the calling
 * admin is the events' creator. 404 for an unknown hub or user. DEMO_MODE-only,
 * behind the JWT + admin guards like every `/admin/test/*`.
 */
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { AdminGuard } from '../auth/admin.guard';
import type { AuthenticatedRequest } from '../auth/types';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { DemoModeGuard } from './demo-mode.guard';
import { parseDemoBody } from './demo-test.utils';
import { assertUserExists } from './demo-test-hub-member.helpers';
import { findForumHubOr404 } from './demo-test-hub-forum.helpers';
import {
  ensurePugUser,
  EventDiscussionSeedSchema,
  seedEventDiscussion,
  type EventDiscussionSeedResult,
} from './demo-test-event-discussion.helpers';

@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class DemoTestEventDiscussionController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** Replace the hub's open + locked discussion events with the fixture. */
  @Post('hubs/:id/event-discussion/seed')
  @HttpCode(HttpStatus.OK)
  async seed(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<EventDiscussionSeedResult> {
    const input = parseDemoBody(EventDiscussionSeedSchema, body ?? {});
    const guildId = await findForumHubOr404(this.db, id);
    await assertUserExists(this.db, input.memberUserId);
    await assertUserExists(this.db, input.readerUserId);
    const pugId = await ensurePugUser(this.db, input.tag);
    const actors = {
      guildId,
      adminId: req.user.id,
      memberId: input.memberUserId,
      readerId: input.readerUserId,
      pugId,
    };
    return seedEventDiscussion(this.db, actors, new Date());
  }
}
