import { Inject, Injectable } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GuildDiscordManagedForDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import type { HubLinker } from './channel-lifecycle.types';
import {
  findManagedForChannel,
  linkHubsForGame,
  selectHubNeedsLinkGameIds,
} from './hub-channel-link.queries';

/**
 * ROK-1871 (ROK-1428 §2.7, D7) — the real hub linker behind
 * `CHANNEL_LIFECYCLE_HUB_LINKER`: links channel-less hubs to their game's
 * managed channel (`source = 'auto'`), never overwriting a Leader's choice.
 */
@Injectable()
export class HubChannelLinkService implements HubLinker {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** Link every eligible channel-less hub of `gameId`; returns how many. */
  linkHubsForGame(gameId: number, channelId: string): Promise<number> {
    return linkHubsForGame(this.db, gameId, channelId);
  }

  /** Games with an eligible hub lacking a channel (feeds `hubNeedsLink`). */
  hubNeedsLinkGameIds(): Promise<Set<number>> {
    return selectHubNeedsLinkGameIds(this.db);
  }

  /** The game a lifecycle-managed channel belongs to, or null. */
  managedForChannel(
    channelId: string,
  ): Promise<GuildDiscordManagedForDto | null> {
    return findManagedForChannel(this.db, channelId);
  }
}
