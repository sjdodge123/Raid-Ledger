import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { AdHocEventsGateway } from '../../events/ad-hoc-events.gateway';
import { NotificationService } from '../../notifications/notification.service';
import { NotificationDedupService } from '../../notifications/notification-dedup.service';
import {
  STEAM_ACCOUNT_LINKED,
  type SteamAccountLinkEvent,
} from '../../steam/steam.constants';
import {
  AD_HOC_EVENTS,
  type AdHocParticipantJoinedPayload,
} from '../discord-bot.constants';
import { AdHocEventService } from '../services/ad-hoc-event.service';
import { AdHocNotificationService } from '../services/ad-hoc-notification.service';
import {
  mergeUnlinkedRowsOnLink,
  type MergedEvent,
} from '../services/ad-hoc-steam-link-merge.helpers';
import {
  QUICK_PLAY_STEAM_NUDGE_TTL_SECONDS,
  findSteamNudgeTargets,
  quickPlaySteamNudgeKey,
  steamNudgeMessage,
  type SteamNudgeTarget,
} from '../services/ad-hoc-steam-nudge.helpers';

/**
 * ROK-1888 L4 (ruling 2). Merge-on-link: a Steam link folds that SteamID's
 * unlinked server row on a live Quick Play into the user's row, then the card
 * and the web roster re-render. Nudge: a voice member with no Steam, on a
 * Quick Play with an unlinked server player, gets one `lineup_steam_nudge`
 * (prefs respected) per 30 days. Both run after the triggering write has
 * committed; failures are logged (ids only — never the SteamID) and swallowed.
 */
@Injectable()
export class AdHocSteamLinkListener {
  private readonly logger = new Logger(AdHocSteamLinkListener.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly adHocEvents: AdHocEventService,
    private readonly cards: AdHocNotificationService,
    private readonly gateway: AdHocEventsGateway,
    private readonly notifications: NotificationService,
    private readonly dedup: NotificationDedupService,
  ) {}

  /** AC8 — fold the unlinked server row into the newly linked user. */
  @OnEvent(STEAM_ACCOUNT_LINKED)
  async handleSteamLinked(e: SteamAccountLinkEvent): Promise<void> {
    await this.safely('merge-on-link', e.userId, async () => {
      const merged = await mergeUnlinkedRowsOnLink(
        this.db,
        e.userId,
        e.steamId64,
      );
      for (const event of merged) await this.rerender(event);
    });
  }

  /**
   * AC9 — a voice join (narrowed to that member) or a server join (every
   * voice member) on an event with an open unlinked server row.
   */
  @OnEvent(AD_HOC_EVENTS.PARTICIPANT_JOINED)
  async handleParticipantJoined(
    payload: AdHocParticipantJoinedPayload,
  ): Promise<void> {
    await this.safely('steam nudge', payload.eventId, async () => {
      const targets = await findSteamNudgeTargets(
        this.db,
        payload.eventId,
        payload.discordUserId,
      );
      for (const target of targets) await this.nudge(target, payload.eventId);
    });
  }

  private async rerender(event: MergedEvent): Promise<void> {
    if (event.channelBindingId)
      this.cards.queueUpdate(event.eventId, event.channelBindingId);
    const roster = await this.adHocEvents.getAdHocRoster(event.eventId);
    this.gateway.emitRosterUpdate(
      event.eventId,
      roster.participants,
      roster.activeCount,
    );
  }

  private async nudge(target: SteamNudgeTarget, eventId: number) {
    const key = quickPlaySteamNudgeKey(target.userId);
    if (
      await this.dedup.checkAndMarkSent(key, QUICK_PLAY_STEAM_NUDGE_TTL_SECONDS)
    )
      return;
    await this.notifications.create({
      userId: target.userId,
      type: 'lineup_steam_nudge',
      title: 'Link your Steam account',
      message: steamNudgeMessage(target.gameName),
      payload: { eventId, gameId: target.gameId },
    });
  }

  private async safely(what: string, id: number, fn: () => Promise<void>) {
    try {
      await fn();
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.name : 'unknown';
      this.logger.warn(`Quick Play ${what} failed for ${id}: ${reason}`);
    }
  }
}
