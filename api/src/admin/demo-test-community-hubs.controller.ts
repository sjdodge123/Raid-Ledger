/**
 * DemoTestCommunityHubsController (ROK-1870 §2.6) —
 * `POST /admin/test/community-hubs/seed`, body `{ gameId?, withEvent?, tag?, dedicatedGame? }`. Seeds the
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
  ensureSeedUser,
  seedActiveHub,
  seedArchivedHub,
  seedHubEvent,
  type SeedHubEvent,
  seedProposal,
  type CommunityHubsSeedResult,
} from './demo-test-community-hubs.helpers';
import {
  ensureSeedUsers,
  muteSeedDiscordDms,
  resetSeedFixture,
} from './demo-test-community-hubs.reset';
import { seedOtherKindHubs } from './demo-test-community-hubs.other-kinds';
import { seedGameFor } from './demo-test-community-hubs.game';
import { crewUsernames } from './demo-test-community-hubs.crew';
import {
  seedHubNames,
  type SeedHubNames,
} from './demo-test-community-hubs.tag';

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
    const gameId = await seedGameFor(this.db, input);
    const seedUsers = await ensureSeedUsers(this.db);
    await muteSeedDiscordDms(this.db, seedUsers);
    await resetSeedFixture(this.db, gameId, seedUsers, input.tag);
    const hubNames = seedHubNames(input.tag);
    const main = await this.seedCrewHub(gameId, hubNames.crew, input.tag);
    const { crew, ...rest } = main;
    await refreshMemberCount(this.db, crew);
    const others = await this.seedOtherHubs(gameId, hubNames, rest);
    const { server, guild } = await seedOtherKindHubs(
      this.db,
      gameId,
      hubNames,
    );
    const { solo, archived, proposalId } = others;
    const hubIds = { crew, solo, archived, server, guild };
    const event = input.withEvent
      ? await this.hubEvent(gameId, crew, rest.leaderUserId)
      : {};
    return { gameId, hubIds, hubNames, ...rest, proposalId, ...event };
  }

  /** "Seed Solo", "Seed Old Guard" (archived) and the proposal. */
  private async seedOtherHubs(
    gameId: number,
    names: SeedHubNames,
    main: { leaderUserId: number },
  ): Promise<{ solo: number; archived: number; proposalId: number }> {
    const soloLeader = await ensureSeedUser(this.db, 'community-solo');
    const solo = await seedActiveHub(this.db, gameId, names.solo, soloLeader);
    const archived = await seedArchivedHub(
      this.db,
      gameId,
      main.leaderUserId,
      names.archived,
    );
    const proposer = await ensureSeedUser(this.db, 'demo-member');
    const proposalId = await seedProposal(
      this.db,
      gameId,
      proposer,
      names.proposed,
    );
    for (const id of [solo, archived]) {
      await refreshMemberCount(this.db, id);
    }
    return { solo, archived, proposalId };
  }

  /** ROK-1893 P4: the crew hub's tagged event, only when requested. */
  private async hubEvent(
    gameId: number,
    crew: number,
    leaderUserId: number,
  ): Promise<{ hubEvent: SeedHubEvent }> {
    return {
      hubEvent: await seedHubEvent(this.db, gameId, crew, leaderUserId),
    };
  }

  /** "Seed Crew": leader + officer + 4 members live, one banned user. */
  private async seedCrewHub(
    gameId: number,
    name: string,
    tag: string | undefined,
  ): Promise<{
    crew: number;
    leaderUserId: number;
    memberUserIds: number[];
    memberUsernames: string[];
    bannedUserId: number;
  }> {
    const leaderUserId = await ensureSeedUser(this.db, 'community-leader');
    const crew = await seedActiveHub(this.db, gameId, name, leaderUserId);
    const memberUsernames = crewUsernames(tag);
    const memberUserIds = await this.seedCrew(crew, memberUsernames);
    const bannedUserId = await ensureSeedUser(this.db, 'community-banned');
    await ban(this.db, {
      guildId: crew,
      userId: bannedUserId,
      bannedBy: leaderUserId,
      reason: 'Seeded ban',
    });
    return { crew, leaderUserId, memberUserIds, memberUsernames, bannedUserId };
  }

  /** Join `usernames` (officer first) to the crew; a tag's own users get their DMs muted too. */
  private async seedCrew(
    hubId: number,
    usernames: string[],
  ): Promise<number[]> {
    const ids: number[] = [];
    for (const [i, username] of usernames.entries()) {
      const userId = await ensureSeedUser(this.db, username);
      await upsertJoin(this.db, hubId, userId, i === 0 ? 'officer' : 'member');
      ids.push(userId);
    }
    await muteSeedDiscordDms(this.db, ids);
    return ids;
  }
}
