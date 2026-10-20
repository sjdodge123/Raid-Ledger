/**
 * DemoTestCommunityHubsController (ROK-1870 §2.6) —
 * `POST /admin/test/community-hubs/seed`, body `{ gameId? }`. Seeds the
 * community-hub fixture set (see the helpers) and returns its ids for the
 * smoke specs + fleet test plan. DEMO_MODE-only, JWT + admin guarded.
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
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  ban,
  refreshMemberCount,
  upsertJoin,
} from '../guilds/community/community-membership.queries';
import { DemoModeGuard } from './demo-mode.guard';
import { parseDemoBody } from './demo-test.utils';
import {
  CommunityHubsSeedSchema,
  SEED_HUB_NAMES,
  ensureSeedUser,
  resolveSeedGame,
  seedActiveHub,
  seedArchivedHub,
  seedProposal,
  type CommunityHubsSeedResult,
} from './demo-test-community-hubs.helpers';
import {
  ensureSeedUsers,
  muteSeedDiscordDms,
  resetSeedFixture,
} from './demo-test-community-hubs.reset';

const CREW = ['officer', 'member-1', 'member-2', 'member-3', 'member-4'];

@Controller('admin/test/community-hubs')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class DemoTestCommunityHubsController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** Re-seed the fixture set (idempotent). */
  @Post('seed')
  @HttpCode(HttpStatus.OK)
  async seed(@Body() body: unknown): Promise<CommunityHubsSeedResult> {
    const input = parseDemoBody(CommunityHubsSeedSchema, body ?? {});
    const gameId = await resolveSeedGame(this.db, input.gameId);
    const seedUsers = await ensureSeedUsers(this.db);
    await muteSeedDiscordDms(this.db, seedUsers);
    await resetSeedFixture(this.db, gameId, seedUsers);
    const main = await this.seedCrewHub(gameId);
    const soloLeader = await ensureSeedUser(this.db, 'community-solo');
    const solo = await seedActiveHub(
      this.db,
      gameId,
      SEED_HUB_NAMES.solo,
      soloLeader,
    );
    const archived = await seedArchivedHub(this.db, gameId, main.leaderUserId);
    const proposer = await ensureSeedUser(this.db, 'demo-member');
    const proposalId = await seedProposal(this.db, gameId, proposer);
    for (const id of [main.crew, solo, archived]) {
      await refreshMemberCount(this.db, id);
    }
    const { crew, ...rest } = main;
    return { gameId, hubIds: { crew, solo, archived }, ...rest, proposalId };
  }

  /** "Seed Crew": leader + officer + 4 members live, one banned user. */
  private async seedCrewHub(gameId: number): Promise<{
    crew: number;
    leaderUserId: number;
    memberUserIds: number[];
    bannedUserId: number;
  }> {
    const leaderUserId = await ensureSeedUser(this.db, 'community-leader');
    const crew = await seedActiveHub(
      this.db,
      gameId,
      SEED_HUB_NAMES.crew,
      leaderUserId,
    );
    const memberUserIds = await this.seedCrew(crew);
    const bannedUserId = await ensureSeedUser(this.db, 'community-banned');
    await ban(this.db, {
      guildId: crew,
      userId: bannedUserId,
      bannedBy: leaderUserId,
      reason: 'Seeded ban',
    });
    return { crew, leaderUserId, memberUserIds, bannedUserId };
  }

  private async seedCrew(hubId: number): Promise<number[]> {
    const ids: number[] = [];
    for (const [i, name] of CREW.entries()) {
      const userId = await ensureSeedUser(this.db, `community-${name}`);
      await upsertJoin(this.db, hubId, userId, i === 0 ? 'officer' : 'member');
      ids.push(userId);
    }
    return ids;
  }
}
