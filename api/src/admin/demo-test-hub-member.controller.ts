/**
 * DemoTestHubMemberController (ROK-1832) — `POST /admin/test/hub-member`.
 *
 * Body `{ guildId, userId }`: makes the user a live member of the hub through
 * the kind's own membership tables (see `demo-test-hub-member.helpers.ts`).
 * Idempotent; 404 for an unknown guild or user. Used by the hub-notification
 * integration spec, smoke specs and the fleet test plan.
 * DEMO_MODE-only, behind the JWT + admin guards like every `/admin/test/*`.
 */
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { AdminGuard } from '../auth/admin.guard';
import { DemoModeGuard } from './demo-mode.guard';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { parseDemoBody } from './demo-test.utils';
import {
  HubMemberSchema,
  assertUserExists,
  findHubOr404,
  joinServerHub,
  joinWowGuild,
  type HubMemberResult,
} from './demo-test-hub-member.helpers';

@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class DemoTestHubMemberController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** Insert (or restore) one live hub membership. */
  @Post('hub-member')
  @HttpCode(HttpStatus.OK)
  async addMember(@Body() body: unknown): Promise<HubMemberResult> {
    const input = parseDemoBody(HubMemberSchema, body);
    const hub = await findHubOr404(this.db, input.guildId);
    await assertUserExists(this.db, input.userId);
    const now = new Date();
    if (hub.kind === 'game_server') {
      await joinServerHub(this.db, hub.id, input.userId, now);
    } else {
      await joinWowGuild(this.db, hub, input.userId, now);
    }
    return { guildId: hub.id, userId: input.userId, kind: hub.kind };
  }
}
