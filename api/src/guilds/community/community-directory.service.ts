import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  GameHubs,
  GuildKind,
  HubDirectoryPage,
  HubDirectoryQuery,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import {
  GuildAccessService,
  isStaff,
  type GuildActor,
} from '../guild-access.service';
import { HubKindRegistry } from '../hub-kind.registry';
import {
  directoryKinds,
  type DirectoryScope,
} from './community-directory.visibility';
import { loadDiscordFields } from './community-hub.reads';
import { listDirectory } from './community-directory.queries';
import { proposeBlockedReason } from './community-directory.params';
import {
  findGameName,
  listProposals,
  openProposalGameIds,
} from './community-proposals.queries';
import { isInDiscordGuild } from './discord-guild-member.helpers';

/** The game card lists at most this many hubs (contract `GameHubs.hubs`). */
const GAME_CARD_HUBS = 50;

/**
 * ROK-1870 L3 — `GET /hubs` and `GET /hubs/by-game/:gameId`. ROK-1875: the
 * directory spans every plugin-active hub kind. ROK-1883 reverses ROK-1875
 * D13: the game card lists every live kind under the same visibility rule
 * as `/hubs` (one scope builder below), the viewer's hubs first.
 */
@Injectable()
export class CommunityDirectoryService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly hubKinds: HubKindRegistry,
    private readonly access: GuildAccessService,
  ) {}

  /** One directory page for the viewer; `kinds` = every live kind (D12). */
  async list(
    actor: GuildActor,
    query: HubDirectoryQuery,
  ): Promise<HubDirectoryPage> {
    const { live, scope } = await this.scopeFor(actor, query.kind);
    const page = await listDirectory(this.db, actor.id, query, scope);
    return { ...page, kinds: live };
  }

  /** The viewer's directory scope over the plugin-active kinds. */
  private async scopeFor(
    actor: GuildActor,
    kind: GuildKind | undefined,
  ): Promise<{ live: GuildKind[]; scope: DirectoryScope }> {
    const live = this.hubKinds.active().map((a) => a.kind);
    const kinds = directoryKinds(live, kind);
    const memberIds = await this.access.memberHubIds(actor.id);
    const scope = { kinds: kinds.queried, memberIds, staff: isStaff(actor) };
    return { live: kinds.live, scope };
  }

  /** The game page card: hubs, the viewer's proposals, may they propose. */
  async byGame(actor: GuildActor, gameId: number): Promise<GameHubs> {
    if ((await findGameName(this.db, gameId)) === null) {
      throw new NotFoundException('Game not found');
    }
    const { scope } = await this.scopeFor(actor, undefined);
    const query: HubDirectoryQuery = {
      gameId,
      membership: 'all',
      sort: 'members',
      limit: GAME_CARD_HUBS,
    };
    const [page, proposals, fields, openIds] = await Promise.all([
      listDirectory(this.db, actor.id, query, scope, { joinedFirst: true }),
      listProposals(this.db, { proposedBy: actor.id }),
      loadDiscordFields(this.db, actor.id),
      openProposalGameIds(this.db, actor.id),
    ]);
    const inDiscord =
      isStaff(actor) || (fields !== null && isInDiscordGuild(fields));
    const reason = proposeBlockedReason(inDiscord, openIds, gameId);
    return {
      hubs: page.items,
      myProposals: proposals.filter((p) => p.gameId === gameId),
      canPropose: reason === null,
      proposeBlockedReason: reason,
    };
  }
}
