/**
 * DemoTestSteamAppStatsController (ROK-1953 §4.5) —
 * `POST /admin/test/steam-app-stats/seed`, body `{}`. Self-contained (review
 * R1): finds-or-creates its own disabled demo game holding BG3's app id and
 * its own "Steam Stats Crew" hub, joins the four seed users and writes their
 * Steam stats — all in ONE transaction under the games name lock, so
 * concurrent calls serialise. 409 when a real game row already holds BG3's
 * app id. DEMO_MODE-only, JWT + admin guarded, same as the other seeds.
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
import { withGameNameLock } from '../igdb/games-name-lock.helpers';
import { DemoModeGuard } from './demo-mode.guard';
import { parseDemoBody } from './demo-test.utils';
import { ensureSeedUser } from './demo-test-community-hubs.helpers';
import {
  BG3_APP_ID,
  STEAM_DEMO_GAME,
  ensureDemoGame,
  ensureDemoHub,
} from './demo-test-steam-app-stats-game.helpers';
import {
  STEAM_SEED_ROLES,
  seedAppSchema,
  seedMemberStats,
  type SteamSeedRole,
} from './demo-test-steam-app-stats.helpers';

const SeedSchema = z.object({}).strict();

type Db = PostgresJsDatabase<typeof schema>;

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
    parseDemoBody(SeedSchema, body ?? {});
    const appId = BG3_APP_ID;
    return withGameNameLock(this.db, STEAM_DEMO_GAME.name, async (tx) => {
      const gameId = await ensureDemoGame(tx);
      const guildId = await ensureDemoHub(tx, gameId);
      await seedAppSchema(tx, appId);
      const users = await this.seedUsers(tx, guildId, appId, gameId);
      await refreshMemberCount(tx, guildId);
      return { guildId, gameId, appId, users, hiddenUnlockedBy: 'a' as const };
    });
  }

  private async seedUsers(
    tx: Db,
    guildId: number,
    appId: number,
    gameId: number,
  ): Promise<SteamSeedUsers> {
    const out: Partial<SteamSeedUsers> = {};
    for (const role of ['a', 'b', 'c', 'd'] as const) {
      const username = STEAM_SEED_ROLES[role];
      const userId = await ensureSeedUser(tx, username);
      await upsertJoin(tx, guildId, userId, 'member');
      await seedMemberStats(tx, { appId, gameId, userId }, role);
      out[role] = { userId, username };
    }
    const { a, b, c, d } = out;
    if (!a || !b || !c || !d) throw new Error('steam seed: a role was skipped');
    return { a, b, c, d };
  }
}
