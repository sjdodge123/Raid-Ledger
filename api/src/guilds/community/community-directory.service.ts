import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  GameHubs,
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
import { directoryKinds } from './community-directory.visibility';
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
 * directory spans every plugin-active hub kind; the game card stays community.
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
    const live = this.hubKinds.active().map((a) => a.kind);
    const kinds = directoryKinds(live, query.kind);
    const memberIds = await this.access.memberHubIds(actor.id);
    const scope = { kinds: kinds.queried, memberIds, staff: isStaff(actor) };
    const page = await listDirectory(this.db, actor.id, query, scope);
    return { ...page, kinds: kinds.live };
  }

  /** The game page card: hubs, the viewer's proposals, may they propose. */
  async byGame(actor: GuildActor, gameId: number): Promise<GameHubs> {
    if ((await findGameName(this.db, gameId)) === null) {
      throw new NotFoundException('Game not found');
    }
    const [page, proposals, fields, openIds] = await Promise.all([
      listDirectory(
        this.db,
        actor.id,
        { gameId, membership: 'all', sort: 'members', limit: GAME_CARD_HUBS },
        { kinds: ['game_community'], memberIds: [], staff: isStaff(actor) },
      ),
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
