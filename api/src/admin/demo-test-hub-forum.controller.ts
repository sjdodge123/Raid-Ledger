/**
 * DemoTestHubForumController (ROK-1175) — `POST /admin/test/hubs/:id/forum/seed`.
 *
 * Body `{ memberUserId, bulk? }`: replaces the hub's forum with the fixture in
 * `demo-test-hub-forum.helpers.ts`; the calling admin is the leader/moderator.
 * 404 for an unknown hub or member user. DEMO_MODE-only, behind the JWT +
 * admin guards like every `/admin/test/*`.
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
import { assertUserExists, findHubOr404 } from './demo-test-hub-member.helpers';
import {
  HubForumSeedSchema,
  seedHubForum,
  type HubForumSeedResult,
} from './demo-test-hub-forum.helpers';

@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class DemoTestHubForumController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** Replace the hub's forum threads + replies with the fixture. */
  @Post('hubs/:id/forum/seed')
  @HttpCode(HttpStatus.OK)
  async seed(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<HubForumSeedResult> {
    const input = parseDemoBody(HubForumSeedSchema, body ?? {});
    const hub = await findHubOr404(this.db, id);
    await assertUserExists(this.db, input.memberUserId);
    const actors = {
      guildId: hub.id,
      leaderId: req.user.id,
      memberId: input.memberUserId,
    };
    return seedHubForum(this.db, actors, input.bulk, new Date());
  }
}
