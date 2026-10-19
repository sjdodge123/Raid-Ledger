import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  HubHideSchema,
  type GuildPage,
  type GuildRaidsDto,
  type MyGuild,
  type MyGuilds,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { isHubMuted } from '../notifications/hub-notification-mute.helpers';
import * as schema from '../drizzle/schema';
import type {
  HubKindAdapter,
  HubMineRank,
} from '../plugins/plugin-host/extension-points';
import { GuildAccessService, type GuildActor } from './guild-access.service';
import { findGuildKind } from './guild-core.queries';
import { gmPostHeadlines } from './guild-profile.queries';
import { hubGameIcons } from './hub-game-icons.queries';
import {
  HUB_NOT_FOUND,
  dropHiddenFor,
  setHubHidden,
} from './hub-hidden.helpers';
import { HubKindRegistry } from './hub-kind.registry';

/**
 * ROK-1831 L2a — the kind-agnostic read side behind `guilds/:id` and
 * `guilds/mine`. Each read is handed to the guild's hub-kind adapter, so core
 * never imports a game plugin; hidden hubs are filtered by `HubVisibleGuard`.
 */
@Injectable()
export class HubService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly hubKinds: HubKindRegistry,
    private readonly access: GuildAccessService,
  ) {}

  /**
   * The hub page, built by the guild kind's adapter. ROK-1832: core adds the
   * viewer's per-group mute flag for anyone above `visitor` (a visitor cannot
   * mute, so the key is omitted rather than reported false).
   */
  async page(actor: GuildActor, guildId: number): Promise<GuildPage> {
    const page = await (await this.adapterFor(guildId)).page(actor, guildId);
    if (page.viewer.role === 'visitor') return page;
    const notificationsMuted = await isHubMuted(this.db, actor.id, guildId);
    return { ...page, viewer: { ...page.viewer, notificationsMuted } };
  }

  /** The Raids tab + Overview widgets, built by the guild kind's adapter. */
  async raids(actor: GuildActor, guildId: number): Promise<GuildRaidsDto> {
    return (await this.adapterFor(guildId)).raids(actor, guildId);
  }

  /** Every hub the viewer belongs to, across live kinds; hidden ones only for staff. */
  async mine(actor: GuildActor): Promise<MyGuilds> {
    const all = await this.access.myGuilds(actor.id);
    const visible = await dropHiddenFor(this.db, actor, all);
    const ids = visible.map((g) => g.id);
    const [ranks, headlines, icons] = await Promise.all([
      this.ranksFor(actor.id, ids),
      gmPostHeadlines(this.db, ids),
      hubGameIcons(
        this.db,
        visible.map((g) => g.gameId),
      ),
    ]);
    const guilds: MyGuild[] = [];
    for (const g of visible) {
      const rank = ranks.get(g.id);
      guilds.push({
        ...g,
        rankIndex: rank?.rankIndex ?? null,
        rankName: rank?.rankName ?? null,
        canEdit: await this.access.canEdit(actor, g.id),
        gmPostHeadline: headlines.get(g.id) ?? null,
        gameIconUrl: icons.get(g.gameId) ?? null,
      });
    }
    return { guilds };
  }

  /** Admin-only (controller guard): set or clear `hidden_at` (L-5). */
  async setHidden(
    guildId: number,
    body: unknown,
  ): Promise<{ hidden: boolean }> {
    const parsed = HubHideSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    const found = await setHubHidden(this.db, guildId, parsed.data.hidden);
    if (!found) throw new NotFoundException(HUB_NOT_FOUND);
    return { hidden: parsed.data.hidden };
  }

  private async adapterFor(guildId: number): Promise<HubKindAdapter> {
    const kind = await findGuildKind(this.db, guildId);
    if (kind === null) throw new NotFoundException(HUB_NOT_FOUND);
    return this.hubKinds.require(kind);
  }

  /** Merge every live kind's rank answer (kinds without ranks contribute none). */
  private async ranksFor(
    userId: number,
    ids: number[],
  ): Promise<Map<number, HubMineRank>> {
    const out = new Map<number, HubMineRank>();
    if (ids.length === 0) return out;
    for (const hub of this.hubKinds.active()) {
      if (hub.mineRanks === undefined) continue;
      for (const [id, rank] of await hub.mineRanks(userId, ids)) {
        // Never let a later kind's empty answer clobber a real rank.
        const prev = out.get(id);
        if (prev && (prev.rankIndex !== null || prev.rankName !== null)) {
          continue;
        }
        out.set(id, rank);
      }
    }
    return out;
  }
}
