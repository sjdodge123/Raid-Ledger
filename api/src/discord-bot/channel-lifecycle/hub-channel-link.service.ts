import {
  Inject,
  Injectable,
  Optional,
  type OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GuildDiscordManagedForDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import {
  HUB_CHANNEL_EVENTS,
  emitHubChannelEvent,
} from '../../guilds/hub-channel.events';
import type { HubLinker, HubLinkResult } from './channel-lifecycle.types';
import type { LifecycleDb } from './channel-lifecycle.store';
import {
  findManagedForChannel,
  linkHubIdsForGame,
  selectHubNeedsLinkGameIds,
} from './hub-channel-link.queries';
import { registerSignal } from './game-activity.signals';
import {
  holdWindow,
  hubSignal,
  selectHubHoldGameIds,
} from './hub-activity.signal';

/**
 * ROK-1871 (ROK-1428 §2.7, D7) — the real hub linker behind
 * `CHANNEL_LIFECYCLE_HUB_LINKER`: links channel-less hubs to their game's
 * managed channel (`source = 'auto'`), never overwriting a Leader's choice.
 */
@Injectable()
export class HubChannelLinkService implements HubLinker, OnModuleInit {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  /** L11 (D2): community-hub posts / joins / proposals count as activity. */
  onModuleInit(): void {
    registerSignal(hubSignal);
  }

  /** Games an active, non-dormant community hub holds open (D8). */
  hubHoldGameIds(
    now: Date,
    windowDays: number,
    db?: LifecycleDb,
  ): Promise<Set<number>> {
    return selectHubHoldGameIds(db ?? this.db, holdWindow(now, windowDays));
  }

  /**
   * Link every eligible channel-less hub of `gameId`; returns the linked hub
   * ids. Emits nothing: under the lifecycle tick `db` is the per-game tx, so
   * the caller announces via {@link announceLinked} once it commits (Codex P2).
   */
  async linkHubsForGame(
    gameId: number,
    channelId: string,
    db?: LifecycleDb,
  ): Promise<HubLinkResult> {
    const guildIds = await linkHubIdsForGame(db ?? this.db, gameId, channelId);
    return { channelId, guildIds };
  }

  /**
   * ROK-1933: announce each committed link (`previousChannelId` is always
   * null — only channel-less hubs are linkable). A throwing listener is
   * contained by `emitHubChannelEvent`.
   */
  announceLinked({ channelId, guildIds }: HubLinkResult): void {
    for (const guildId of guildIds) {
      emitHubChannelEvent(this.events, HUB_CHANNEL_EVENTS.LINKED, {
        guildId,
        channelId,
        previousChannelId: null,
      });
    }
  }

  /** Games with an eligible hub lacking a channel (feeds `hubNeedsLink`). */
  hubNeedsLinkGameIds(db?: LifecycleDb): Promise<Set<number>> {
    return selectHubNeedsLinkGameIds(db ?? this.db);
  }

  /** The game a lifecycle-managed channel belongs to, or null. */
  managedForChannel(
    channelId: string,
  ): Promise<GuildDiscordManagedForDto | null> {
    return findManagedForChannel(this.db, channelId);
  }
}
