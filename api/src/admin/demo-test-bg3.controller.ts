/**
 * DemoTestBg3Controller (ROK-1958) — `POST /admin/test/bg3/seed-hub`, body
 * `{ tag, variant? }` with `variant` one of `default` | `no-campaign` |
 * `no-saves` | `spoilers`. Seeds a BG3 `game_community` hub for the BG3
 * hub-widgets smoke spec and fleet test plan, and returns its ids:
 *   - users `bg3-<role>-<tag>`: host (leader + campaign host + uploader),
 *     officer (editor), member (no claim — the "That's me" actor), claimer
 *     (holds the Human Wizard slot) and visitor (NOT a member);
 *   - `default`: the active campaign "Tactician run", 36 saves in 24
 *     sessions (newest = the golden Act 2 party, 4 heroes + 1 summon) bound
 *     to it, and one claim; `spoilers`: the same with the hub's spoiler
 *     toggle on; `no-saves`: the campaign with the saves left unassigned;
 *     `no-campaign`: unassigned saves and no campaign.
 * Idempotent per tag. DEMO_MODE-only, behind the JWT + admin guards.
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
import { refreshMemberCount } from '../guilds/community/community-membership.queries';
import { DemoModeGuard } from './demo-mode.guard';
import { parseDemoBody } from './demo-test.utils';
import { muteSeedDiscordDms } from './demo-test-community-hubs.reset';
import {
  BG3_SEED_CAMPAIGN_NAME,
  BG3_SEED_CLAIMED_SLOT,
  Bg3SeedHubSchema,
  bg3SeedCampaignKey,
  bg3SeedHubName,
  bg3SeedUsername,
  variantShape,
  type Bg3SeedRole,
  type Bg3SeedVariant,
} from './demo-test-bg3.helpers';
import {
  bindBg3Key,
  ensureBg3Hub,
  ensureBg3User,
  findBg3Game,
  resetBg3Fixture,
  seedBg3Campaign,
  seedBg3Claim,
  seedBg3Memberships,
  seedBg3Saves,
} from './demo-test-bg3.seed';

type SeededUsers = Record<Bg3SeedRole, { userId: number; username: string }>;

export interface Bg3SeedHubResult {
  hubId: number;
  gameId: number;
  hubName: string;
  variant: Bg3SeedVariant;
  campaignId: number | null;
  campaignName: string | null;
  campaignKey: string;
  users: SeededUsers;
  saveCount: number;
  sessionCount: number;
  claimedSlotKey: string | null;
}

@Controller('admin/test/bg3')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class DemoTestBg3Controller {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** (Re)seed the tag's BG3 hub fixture. */
  @Post('seed-hub')
  @HttpCode(HttpStatus.OK)
  async seedHub(@Body() body: unknown): Promise<Bg3SeedHubResult> {
    const { tag, variant = 'default' } = parseDemoBody(Bg3SeedHubSchema, body);
    const gameId = await findBg3Game(this.db);
    const users = await this.seedUsers(tag);
    const ids = mapIds(users);
    const hubName = bg3SeedHubName(tag);
    const hubId = await ensureBg3Hub(this.db, gameId, hubName, ids.host);
    await resetBg3Fixture(this.db, hubId, Object.values(ids));
    await seedBg3Memberships(this.db, hubId, ids);
    await refreshMemberCount(this.db, hubId);
    const state = await this.seedState(hubId, tag, variant, ids);
    return { hubId, gameId, hubName, variant, users, ...state };
  }

  private async seedUsers(tag: string): Promise<SeededUsers> {
    const one = async (role: Bg3SeedRole) => {
      const username = bg3SeedUsername(role, tag);
      return { userId: await ensureBg3User(this.db, username), username };
    };
    const users: SeededUsers = {
      host: await one('host'),
      officer: await one('officer'),
      member: await one('member'),
      claimer: await one('claimer'),
      visitor: await one('visitor'),
    };
    await muteSeedDiscordDms(this.db, Object.values(mapIds(users)));
    return users;
  }

  /** Campaign, saves and claim per the variant. */
  private async seedState(
    hubId: number,
    tag: string,
    variant: Bg3SeedVariant,
    ids: Record<Bg3SeedRole, number>,
  ): Promise<
    Omit<Bg3SeedHubResult, 'hubId' | 'gameId' | 'hubName' | 'variant' | 'users'>
  > {
    const shape = variantShape(variant);
    const campaignKey = bg3SeedCampaignKey(tag);
    const campaignId = shape.campaign
      ? await seedBg3Campaign(
          this.db,
          hubId,
          ids.host,
          BG3_SEED_CAMPAIGN_NAME,
          shape.spoilers,
        )
      : null;
    const assignTo = shape.assignSaves ? campaignId : null;
    if (assignTo !== null)
      await bindBg3Key(this.db, ids.host, campaignKey, assignTo);
    const { saves, sessions } = await seedBg3Saves(
      this.db,
      ids.host,
      campaignKey,
      assignTo,
      new Date(),
    );
    const claimed = shape.claim && assignTo !== null;
    if (claimed)
      await seedBg3Claim(this.db, assignTo, BG3_SEED_CLAIMED_SLOT, ids.claimer);
    return {
      campaignId,
      campaignName: campaignId === null ? null : BG3_SEED_CAMPAIGN_NAME,
      campaignKey,
      saveCount: saves,
      sessionCount: sessions,
      claimedSlotKey: claimed ? BG3_SEED_CLAIMED_SLOT : null,
    };
  }
}

function mapIds(users: SeededUsers): Record<Bg3SeedRole, number> {
  return {
    host: users.host.userId,
    officer: users.officer.userId,
    member: users.member.userId,
    claimer: users.claimer.userId,
    visitor: users.visitor.userId,
  };
}
