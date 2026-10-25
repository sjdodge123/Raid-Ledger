/**
 * DemoTestSteamAppStatsController (ROK-1953 §4.5) —
 * `POST /admin/test/steam-app-stats/seed`, body `{ guildId }` (a BG3
 * community hub, e.g. `hubIds.crew` from `POST /admin/test/community-hubs/seed`).
 * Joins the four crew seed users and writes their Steam stats (see the
 * helpers). DEMO_MODE-only, JWT + admin guarded, same as the other seeds.
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
import { z } from 'zod';
import { AdminGuard } from '../auth/admin.guard';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  refreshMemberCount,
  upsertJoin,
} from '../guilds/community/community-membership.queries';
import { DemoModeGuard } from './demo-mode.guard';
import { parseDemoBody } from './demo-test.utils';
import { ensureSeedUser } from './demo-test-community-hubs.helpers';
import {
  STEAM_SEED_ROLES,
  resolveSeedApp,
  seedAppSchema,
  seedMemberStats,
  type SteamSeedRole,
} from './demo-test-steam-app-stats.helpers';

const SeedSchema = z.object({ guildId: z.number().int().positive() }).strict();

/** The seeded user per role (sign in as `b` to see A's hidden unlocks masked). */
export type SteamSeedUsers = Record<
  SteamSeedRole,
  { userId: number; username: string }
>;

@Controller('admin/test/steam-app-stats')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class DemoTestSteamAppStatsController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** Re-seed the hub's Steam stats fixture (idempotent). */
  @Post('seed')
  @HttpCode(HttpStatus.OK)
  async seed(@Body() body: unknown): Promise<{
    guildId: number;
    gameId: number;
    appId: number;
    users: SteamSeedUsers;
    hiddenUnlockedBy: SteamSeedRole;
  }> {
    const { guildId } = parseDemoBody(SeedSchema, body ?? {});
    const { gameId, appId } = await resolveSeedApp(this.db, guildId);
    await seedAppSchema(this.db, appId);
    const users = await this.seedUsers(guildId, appId, gameId);
    await refreshMemberCount(this.db, guildId);
    return { guildId, gameId, appId, users, hiddenUnlockedBy: 'a' };
  }

  private async seedUsers(
    guildId: number,
    appId: number,
    gameId: number,
  ): Promise<SteamSeedUsers> {
    const out: Partial<SteamSeedUsers> = {};
    for (const role of ['a', 'b', 'c', 'd'] as const) {
      const username = STEAM_SEED_ROLES[role];
      const userId = await ensureSeedUser(this.db, username);
      await upsertJoin(this.db, guildId, userId, 'member');
      await seedMemberStats(this.db, { appId, gameId, userId }, role);
      out[role] = { userId, username };
    }
    const { a, b, c, d } = out;
    if (!a || !b || !c || !d) throw new Error('steam seed: a role was skipped');
    return { a, b, c, d };
  }
}
