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
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { AdminGuard } from '../auth/admin.guard';
import { DemoModeGuard } from './demo-mode.guard';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { WOW_COMMON_MANIFEST } from '../plugins/wow-common/manifest';
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
    const { users, unlinked } = await this.seedRoster({
      guildId,
      gameId,
      hash,
      now,
    });
    const editorId = await ensureRankEditor(this.db, guildId, users.gm.userId);
    const raids = await this.seedRaids({ guildId, gameId, hash, now }, users);
    const content = input.withContent
      ? await seedGuildContent(this.db, guildId, users.gm.userId, now)
      : null;
    return {
      guildId,
      gameId,
      name: input.name,
      editorId,
      editorRankIndex: SEED_GUILD_EDITOR_RANK,
      users,
      unlinkedMemberIds: unlinked,
      raids,
      ...(content ? { content } : {}),
    };
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
