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
 *   - with `withGear: true` (ROK-1915), LedgerLink gear in the same
 *     snapshots for the Gear readiness widget (`demo-test-guild-gear.helpers.ts`).
 *   - with `withPulls: true` (ROK-1917), LedgerLink raid-export boss pulls for
 *     the Raid progress widget (`demo-test-guild-pulls.helpers.ts`).
 *   - with `withArmorySnapshots: true` (ROK-2149), a verified Armory snapshot
 *     on every unlinked roster row but the last, for the read-only member
 *     page (`demo-test-guild-armory.helpers.ts`).
 *   - with `withRecruitment: true` (ROK-1789), the recruitment card's object
 *     (`demo-test-guild-recruitment.helpers.ts`); a re-seed restores it.
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
  Request,
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
import { seedRosterGuid } from './demo-test-guild-roster-suffix.helpers';
import {
  ensureGuildRaids,
  raiderOf,
  type SeededGuildRaids,
} from './demo-test-guild-raids.helpers';
import type {
  RosterCtx,
  SeedGuildResponse,
  SeedGuildUser,
  SeededRoster,
} from './demo-test-guild.response';
import {
  seedOptionalHalves,
  type OptionalDeps,
  type ShowcaseRoster,
} from './demo-test-guild-optional.helpers';
import {
  claimGuidCharacter,
  ensureMemberEditor,
  loadSeedCaller,
  seedFillerMembers,
  type SeedCaller,
} from './demo-test-guild-showcase.helpers';
import type { AuthenticatedRequest } from '../auth/types';

type Db = PostgresJsDatabase<typeof schema>;

export type { SeedGuildResponse } from './demo-test-guild.response';

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
  async seedGuild(
    @Request() req: AuthenticatedRequest,
    @Body() body?: unknown,
  ): Promise<SeedGuildResponse> {
    const input = parseSeedGuildBody(body);
    const gameId = await findWowGameId(this.db, input.gameSlug);
    await this.ensurePluginActive();
    const now = new Date();
    const guildId = await upsertGuild(this.db, gameId, input, now);
    const hash = guildKeyHash(input.name.toLowerCase());
    const nameSuffix = input.rosterSuffix;
    const ctx: RosterCtx = { guildId, gameId, hash, now, nameSuffix };
    const cast = await this.seedCast(ctx, input, req.user.id);
    const { users, unlinked, fillers } = cast;
    const raids = await this.seedRaids(ctx, users);
    const extras = await seedOptionalHalves(this.deps(), input, ctx, cast);
    return {
      guildId,
      gameId,
      name: input.name,
      editorId: cast.editorId,
      editorRankIndex: SEED_GUILD_EDITOR_RANK,
      users,
      unlinkedMemberIds: unlinked,
      fillerMemberIds: fillers,
      raids,
      ...extras,
    };
  }

  /** The roster (caller as GM with `asCaller`), the `memberCount` fillers and the editor grants. */
  private async seedCast(
    ctx: RosterCtx,
    input: Pick<SeedGuildInput, 'asCaller' | 'memberCount'>,
    callerId: number,
  ): Promise<ShowcaseRoster & { editorId: number }> {
    const caller = input.asCaller
      ? await loadSeedCaller(this.db, callerId)
      : null;
    const { users, unlinked } = await this.seedRoster(ctx, caller);
    const fillerCount = input.memberCount - SEED_GUILD_ROSTER.length;
    const fillers = await seedFillerMembers(this.db, ctx, fillerCount);
    const editorId = await this.ensureEditors(ctx.guildId, users, caller);
    return { users, unlinked, fillers, editorId };
  }

  /** What the opt-in halves need from the controller. */
  private deps(): OptionalDeps {
    return {
      db: this.db,
      invalidateInsights: (id: number) => this.invalidateInsights(id),
    };
  }

  /** Drops the guild's 5-minute roster-insights cache (WowCommonModule owns it). */
  private invalidateInsights(guildId: number): void {
    this.moduleRef
      .get(RosterInsightsCache, { strict: false })
      .invalidateGuild(guildId);
  }

  /** The rank-1 grant; with `asCaller` (Q-B16) also a member grant on the caller's rank-0 row. */
  private async ensureEditors(
    guildId: number,
    users: Record<SeedGuildRole, SeedGuildUser>,
    caller: SeedCaller | null,
  ): Promise<number> {
    const editorId = await ensureRankEditor(this.db, guildId, users.gm.userId);
    const gmRow = users.gm.memberId;
    if (caller && gmRow !== null) {
      await ensureMemberEditor(this.db, guildId, gmRow, caller.userId);
    }
    return editorId;
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
  private async seedRoster(
    ctx: RosterCtx,
    caller: SeedCaller | null,
  ): Promise<SeededRoster> {
    const linked = new Map<SeedGuildRole, SeedGuildUser>();
    const unlinked: number[] = [];
    for (const entry of SEED_GUILD_ROSTER) {
      const seeded = await this.seedEntry(ctx, entry, caller);
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
    caller: SeedCaller | null,
  ): Promise<
    | { owner: null; memberId: number }
    | { owner: SeedGuildRole; user: SeedGuildUser }
  > {
    const guid = seedRosterGuid(ctx.hash, entry.rank);
    const row = { ...entry, char: `${entry.char}${ctx.nameSuffix}` };
    const memberId = await upsertMember(
      this.db,
      ctx.guildId,
      row,
      guid,
      ctx.now,
    );
    if (entry.owner === null) return { owner: null, memberId };
    const owner = entry.owner;
    const link = { guid, name: row.char, role: entry.role };
    const linked = await this.linkOwner(ctx, owner, link, caller);
    return {
      owner,
      user: { ...linked, memberId, rankIndex: entry.rank },
    };
  }

  /** The row's owner + its GUID character; the caller takes the GM's (Q-B16). */
  private async linkOwner(
    ctx: RosterCtx,
    owner: Exclude<SeedGuildRole, 'outsider'>,
    link: { guid: string; name: string; role: string | null },
    caller: SeedCaller | null,
  ): Promise<SeedCaller & { characterId: string }> {
    const asCaller = owner === 'gm' ? caller : null;
    const user = asCaller ?? (await upsertSeedUser(this.db, ctx.hash, owner));
    const args = { ...link, userId: user.userId, gameId: ctx.gameId };
    const characterId = asCaller
      ? await claimGuidCharacter(this.db, args)
      : await ensureCharacter(this.db, args);
    return { ...user, characterId };
  }
}
