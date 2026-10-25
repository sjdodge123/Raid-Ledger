import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  STEAM_HUB_RECENT_UNLOCKS_MAX,
  type SteamHubStatsResponse,
  type SteamHubUnlock,
} from '@raid-ledger/contract';
import { publicAvatarUrl } from '../../../common/public-avatar-url.helpers';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import {
  GuildAccessService,
  type GuildActor,
} from '../../../guilds/guild-access.service';
import {
  HUB_NOT_FOUND,
  findHiddenAt,
  isHiddenFrom,
} from '../../../guilds/hub-hidden.helpers';
import { HubKindRegistry } from '../../../guilds/hub-kind.registry';
import {
  STEAM_STATS_APP_IDS,
  STEAM_STATS_HUB_KINDS,
} from './steam-stats.constants';
import { maskAchievement } from './steam-stats.mask';
import {
  appTotals,
  memberStatus,
  sortMembers,
  toMemberStats,
} from './steam-stats-read.helpers';
import {
  SteamStatsReadRepository,
  type HubSteamTarget,
  type MemberRow,
  type UnlockRow,
} from './steam-stats-read.repository';

type Db = PostgresJsDatabase<typeof schema>;
type Available = Extract<SteamHubStatsResponse, { available: true }>;

/** D1: the hub's enabled app id, or `null` (→ `{ available: false }`, D9). */
export function enabledAppId(t: HubSteamTarget | undefined): number | null {
  if (!t || t.gameId === null || t.appId === null) return null;
  if (!STEAM_STATS_HUB_KINDS.includes(t.kind)) return null;
  return STEAM_STATS_APP_IDS.has(t.appId) ? t.appId : null;
}

/**
 * ROK-1953 §4.4 — `GET /hubs/:guildId/steam-stats`. Order: gate (D8: missing
 * / hidden / non-member → the same 404; staff pass) → availability (D9) →
 * live members → statuses → playtime → the viewer's unlocked set → feeds
 * from linked live members only → per-viewer mask (staff are masked too).
 */
@Injectable()
export class SteamStatsReadService {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly access: GuildAccessService,
    private readonly hubKinds: HubKindRegistry,
    private readonly repo: SteamStatsReadRepository,
  ) {}

  /** The hub's Steam stats as `actor` may see them. */
  async read(
    actor: GuildActor,
    guildId: number,
  ): Promise<SteamHubStatsResponse> {
    await this.assertMemberOrStaff(actor, guildId);
    const target = await this.repo.hubTarget(guildId);
    const appId = enabledAppId(target);
    if (appId === null || !target || target.gameId === null) {
      return { available: false };
    }
    return this.build(actor.id, guildId, appId, target.gameId);
  }

  private async assertMemberOrStaff(
    actor: GuildActor,
    guildId: number,
  ): Promise<void> {
    const missing = (await findHiddenAt(this.db, guildId)) === undefined;
    if (
      missing ||
      (await isHiddenFrom(this.db, actor, guildId)) ||
      !(await this.access.canView(actor, guildId))
    ) {
      throw new NotFoundException(HUB_NOT_FOUND);
    }
  }

  private async build(
    viewerId: number,
    guildId: number,
    appId: number,
    gameId: number,
  ): Promise<Available> {
    const memberIds = await this.liveMemberIds(guildId);
    const rows = await this.repo.memberRows(
      [...new Set([...memberIds, viewerId])],
      appId,
      gameId,
    );
    const members = rows.filter((r) => memberIds.has(r.userId));
    const viewer = rows.find((r) => r.userId === viewerId);
    const app = await this.repo.appState(appId);
    const feeds = await this.feeds(viewerId, appId, members);
    return {
      available: true,
      appId,
      ...appTotals(app),
      viewer: { status: memberStatus(viewer?.steamId ?? null, viewer?.stats) },
      members: sortMembers(members.map(toWireMember)),
      ...feeds,
    };
  }

  /** Recent + rarest from linked members only, masked for the viewer. */
  private async feeds(
    viewerId: number,
    appId: number,
    members: readonly MemberRow[],
  ): Promise<Pick<Available, 'recentUnlocks' | 'rarestUnlock'>> {
    const linked = members
      .filter((m) => m.steamId !== null)
      .map((m) => m.userId);
    const unlocked = await this.repo.unlockedApiNames(viewerId, appId);
    const view = (u: UnlockRow): SteamHubUnlock => ({
      userId: u.userId,
      unlockedAt: u.unlockedAt.toISOString(),
      achievement: maskAchievement(u.achievement, unlocked),
    });
    const recent = await this.repo.recentUnlocks(
      appId,
      linked,
      STEAM_HUB_RECENT_UNLOCKS_MAX,
    );
    const rarest = await this.repo.rarestUnlock(appId, linked);
    return {
      recentUnlocks: recent.map(view),
      rarestUnlock: rarest ? view(rarest) : null,
    };
  }

  /** Live members, kind-agnostic; an inactive kind yields none. */
  private async liveMemberIds(guildId: number): Promise<Set<number>> {
    const adapter = await this.hubKinds.forGuild(guildId);
    return new Set(adapter ? await adapter.memberUserIds(guildId) : []);
  }
}

function toWireMember(r: MemberRow) {
  return toMemberStats({
    userId: r.userId,
    displayName: r.displayName ?? r.username,
    avatarUrl: publicAvatarUrl(r.customAvatarUrl),
    steamId: r.steamId,
    stats: r.stats,
    playtimeMinutes: r.playtimeMinutes,
  });
}
