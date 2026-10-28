/**
 * DemoTestGuildController (ROK-1785 L6) — `POST /admin/test/wow/seed-guild`.
 *
 * Seeds the guild-page test cast for smoke specs and the fleet test plan,
 * idempotently keyed on the caller's guild name (per-run names keep the
 * parallel Playwright projects apart):
 *   - a LedgerLink-like guild (`source: addon_import`) with a fresh snapshot
 *     and five roster rows, ranks 0..4;
 *   - four onboarded member users: `gm` (rank 0), `officer` (rank 1, the
 *     delegated-editor rank), `member` (rank 3) — each owning a main character
 *     whose `addon_guid` is its roster GUID — and `outsider` (no character);
 *   - two roster rows with no RL character (ranks 2 and 4);
 *   - a `guild_editors` rank grant for rank 1, granted by the GM;
 *   - (ROK-1787) guild-tagged raids: a weekly series + one past raid with
 *     attendance recorded — see `demo-test-guild-raids.helpers.ts`.
 *   - with `withContent: true` (ROK-1786), the guild page content too: GM
 *     post, rules, links and two recommended addons (see
 *     `demo-test-guild-content.helpers.ts`). Re-seeding restores it.
 *   - with `withDings: true` (ROK-1919), three level-up events for the
 *     "Recent dings" widget (`demo-test-guild-dings.helpers.ts`).
 *   - with `withPresence: true` (ROK-1916), guild-export presence on the
 *     five roster rows for the "Last seen" widget: 2 online, 3 away
 *     (`demo-test-guild-presence.helpers.ts`).
 *   - with `withLockouts: true` (ROK-1914), LedgerLink lockout snapshots on
 *     the three linked characters for the Who's saved widget (see
 *     `demo-test-guild-lockouts.helpers.ts`). Re-seeding restores them.
 *
 * Also makes sure the WoW plugin (`blizzard`) is installed + active, since
 * every `/plugins/wow/guilds/*` route sits behind `PluginActiveGuard`.
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
import { ModuleRef } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { AdminGuard } from '../auth/admin.guard';
import { DemoModeGuard } from './demo-mode.guard';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { WOW_COMMON_MANIFEST } from '../plugins/wow-common/manifest';
import { RosterInsightsCache } from '../plugins/wow-common/guilds/roster-insights/roster-insights.cache';
import { defined } from '../common/defined.helpers';
import {
  SEED_GUILD_EDITOR_RANK,
  SEED_GUILD_ROSTER,
  ensureCharacter,
  ensureRankEditor,
  findWowGameId,
  guildKeyHash,
  parseSeedGuildBody,
  upsertGuild,
  upsertMember,
  upsertSeedUser,
  type SeedGuildInput,
  type SeedGuildRole,
} from './demo-test-guild.helpers';
import {
  ensureGuildRaids,
  raiderOf,
  type SeededGuildRaids,
} from './demo-test-guild-raids.helpers';
import {
  seedGuildContent,
  type SeedGuildContent,
} from './demo-test-guild-content.helpers';
import {
  seedGuildLockouts,
  type SeededGuildLockouts,
} from './demo-test-guild-lockouts.helpers';
import {
  seedGuildDings,
  type SeededGuildDings,
} from './demo-test-guild-dings.helpers';
import {
  seedGuildPresence,
  type SeededGuildPresence,
} from './demo-test-guild-presence.helpers';

type Db = PostgresJsDatabase<typeof schema>;

interface RosterCtx {
  guildId: number;
  gameId: number;
  hash: string;
  now: Date;
}

export interface SeedGuildUser {
  userId: number;
  username: string;
  discordId: string;
  /** Null for `outsider`. */
  characterId: string | null;
  /** Null for `outsider`. */
  memberId: number | null;
  rankIndex: number | null;
}

export interface SeedGuildResponse {
  guildId: number;
  gameId: number;
  name: string;
  editorId: number;
  editorRankIndex: number;
  users: Record<SeedGuildRole, SeedGuildUser>;
  /** Roster rows with no RL character (ranks 2 and 4). */
  unlinkedMemberIds: number[];
  /** ROK-1787 — guild-tagged events for the Raids tab. */
  raids: SeededGuildRaids;
  /** Present only when the body sent `withContent: true`. */
  content?: SeedGuildContent;
  /** Present only when the body sent `withLockouts: true`. */
  lockouts?: SeededGuildLockouts;
  /** Present only when the body sent `withDings: true` (ROK-1919). */
  dings?: SeededGuildDings;
  /** Present only when the body sent `withPresence: true` (ROK-1916). */
  presence?: SeededGuildPresence;
}

interface SeededRoster {
  users: Record<SeedGuildRole, SeedGuildUser>;
  unlinked: number[];
}

@Controller('admin/test/wow')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class DemoTestGuildController {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly plugins: PluginRegistryService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /** Idempotent per guild name; see the file header for the cast. */
  @Post('seed-guild')
  @HttpCode(HttpStatus.OK)
  async seedGuild(@Body() body?: unknown): Promise<SeedGuildResponse> {
    const input = parseSeedGuildBody(body);
    const gameId = await findWowGameId(this.db, input.gameSlug);
    await this.ensurePluginActive();
    const now = new Date();
    const guildId = await upsertGuild(this.db, gameId, input.name, now);
    const hash = guildKeyHash(input.name.toLowerCase());
    const ctx: RosterCtx = { guildId, gameId, hash, now };
    const { users, unlinked } = await this.seedRoster(ctx);
    const editorId = await ensureRankEditor(this.db, guildId, users.gm.userId);
    const raids = await this.seedRaids(ctx, users);
    const extras = await this.seedOptional(input, ctx, { users, unlinked });
    return {
      guildId,
      gameId,
      name: input.name,
      editorId,
      editorRankIndex: SEED_GUILD_EDITOR_RANK,
      users,
      unlinkedMemberIds: unlinked,
      raids,
      ...extras,
    };
  }

  /** The opt-in halves: `withContent` (ROK-1786), `withLockouts` (ROK-1914), `withDings` (ROK-1919), `withPresence` (ROK-1916). */
  private async seedOptional(
    input: Omit<SeedGuildInput, 'name' | 'gameSlug'>,
    ctx: RosterCtx,
    roster: SeededRoster,
  ): Promise<
    Pick<SeedGuildResponse, 'content' | 'lockouts' | 'dings' | 'presence'>
  > {
    const { users, unlinked } = roster;
    const gm = users.gm.userId;
    const content = input.withContent
      ? await seedGuildContent(this.db, ctx.guildId, gm, ctx.now)
      : null;
    const lockouts = input.withLockouts
      ? await this.seedLockouts(users, ctx)
      : null;
    const dings = input.withDings
      ? await this.seedDings(users, unlinked, ctx)
      : null;
    const presence = input.withPresence
      ? await this.seedPresence(roster, ctx.guildId)
      : null;
    return {
      ...(content ? { content } : {}),
      ...(lockouts ? { lockouts } : {}),
      ...(dings ? { dings } : {}),
      ...(presence ? { presence } : {}),
    };
  }

  /**
   * ROK-1914 — lockout snapshots on the three linked characters, then drop
   * the guild's 5-minute roster-insights cache so a re-seed of the same guild
   * name serves the fresh saves at once (WowCommonModule owns the cache).
   */
  private async seedLockouts(
    users: Record<SeedGuildRole, SeedGuildUser>,
    ctx: RosterCtx,
  ): Promise<SeededGuildLockouts> {
    const owners = (['gm', 'officer', 'member'] as const).map((owner) => {
      const characterId = users[owner].characterId;
      if (characterId === null)
        throw new Error(`seeded ${owner} has no character`);
      return { owner, characterId };
    });
    const seeded = await seedGuildLockouts(this.db, owners, ctx.now);
    this.invalidateInsights(ctx.guildId);
    return seeded;
  }

  /** ROK-1916 — presence on the five roster rows, then a fresh insights cache. */
  private async seedPresence(
    { users, unlinked }: SeededRoster,
    guildId: number,
  ): Promise<SeededGuildPresence> {
    const memberOf = (role: SeedGuildRole): number =>
      defined(users[role].memberId ?? undefined, `seeded ${role} member`);
    const seeded = await seedGuildPresence(this.db, {
      gm: memberOf('gm'),
      officer: memberOf('officer'),
      member: memberOf('member'),
      unlinked: [
        defined(unlinked[0], 'seeded unlinked member'),
        defined(unlinked[1], 'seeded second unlinked member'),
      ],
    });
    this.invalidateInsights(guildId);
    return seeded;
  }

  /** Drops the guild's 5-minute roster-insights cache (WowCommonModule owns it). */
  private invalidateInsights(guildId: number): void {
    this.moduleRef
      .get(RosterInsightsCache, { strict: false })
      .invalidateGuild(guildId);
  }

  /** ROK-1919 — three level-up events: GM (linked), an unlinked row, member (31 days old). */
  private seedDings(
    users: Record<SeedGuildRole, SeedGuildUser>,
    unlinked: number[],
    ctx: RosterCtx,
  ): Promise<SeededGuildDings> {
    const members = {
      linked: defined(users.gm.memberId ?? undefined, 'seeded gm member'),
      unlinked: defined(unlinked[0], 'seeded unlinked member'),
      old: defined(users.member.memberId ?? undefined, 'seeded member member'),
    };
    return seedGuildDings(this.db, ctx.guildId, members, ctx.now);
  }

  /** ROK-1787 — the guild-tagged raids, cast from the seeded users. */
  private seedRaids(
    ctx: RosterCtx,
    users: Record<SeedGuildRole, SeedGuildUser>,
  ): Promise<SeededGuildRaids> {
    return ensureGuildRaids(this.db, {
      guildId: ctx.guildId,
      gameId: ctx.gameId,
      now: ctx.now,
      gm: raiderOf(users.gm),
      officer: raiderOf(users.officer),
      member: raiderOf(users.member),
    });
  }

  /** Every `/plugins/wow/guilds/*` route sits behind `PluginActiveGuard`. */
  private async ensurePluginActive(): Promise<void> {
    await this.plugins.ensureInstalled(WOW_COMMON_MANIFEST.id);
    await this.plugins.activate(WOW_COMMON_MANIFEST.id);
  }

  /** Roster rows + their owners; `unlinked` collects owner-less member ids. */
  private async seedRoster(ctx: RosterCtx): Promise<SeededRoster> {
    const linked = new Map<SeedGuildRole, SeedGuildUser>();
    const unlinked: number[] = [];
    for (const entry of SEED_GUILD_ROSTER) {
      const seeded = await this.seedEntry(ctx, entry);
      if (seeded.owner === null) unlinked.push(seeded.memberId);
      else linked.set(seeded.owner, seeded.user);
    }
    const outsider = await upsertSeedUser(this.db, ctx.hash, 'outsider');
    const pick = (role: SeedGuildRole) =>
      defined(linked.get(role), `seeded ${role}`);
    const none = { characterId: null, memberId: null, rankIndex: null };
    return {
      users: {
        gm: pick('gm'),
        officer: pick('officer'),
        member: pick('member'),
        outsider: { ...outsider, ...none },
      },
      unlinked,
    };
  }

  /** One roster row, plus its owner + linked character when it has one. */
  private async seedEntry(
    ctx: RosterCtx,
    entry: (typeof SEED_GUILD_ROSTER)[number],
  ): Promise<
    | { owner: null; memberId: number }
    | { owner: SeedGuildRole; user: SeedGuildUser }
  > {
    const guid = `Player-${ctx.hash}-${String(entry.rank)}`;
    const memberId = await upsertMember(
      this.db,
      ctx.guildId,
      entry,
      guid,
      ctx.now,
    );
    if (entry.owner === null) return { owner: null, memberId };
    const user = await upsertSeedUser(this.db, ctx.hash, entry.owner);
    const characterId = await ensureCharacter(this.db, {
      userId: user.userId,
      gameId: ctx.gameId,
      guid,
      name: entry.char,
      role: entry.role,
    });
    const rankIndex = entry.rank;
    return {
      owner: entry.owner,
      user: { ...user, characterId, memberId, rankIndex },
    };
  }
}
