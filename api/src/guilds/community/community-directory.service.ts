import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  GameHubs,
  HubDirectoryPage,
  HubDirectoryQuery,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { isStaff, type GuildActor } from '../guild-access.service';
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

/** ROK-1870 L3 — `GET /hubs` and `GET /hubs/by-game/:gameId`. */
@Injectable()
export class CommunityDirectoryService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** One directory page for the viewer. */
  list(viewerId: number, query: HubDirectoryQuery): Promise<HubDirectoryPage> {
    return listDirectory(this.db, viewerId, query);
  }

  /** The game page card: hubs, the viewer's proposals, may they propose. */
  async byGame(actor: GuildActor, gameId: number): Promise<GameHubs> {
    if ((await findGameName(this.db, gameId)) === null) {
      throw new NotFoundException('Game not found');
    }
    const [page, proposals, fields, openIds] = await Promise.all([
      listDirectory(this.db, actor.id, {
        gameId,
        membership: 'all',
        sort: 'members',
        limit: GAME_CARD_HUBS,
      }),
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
