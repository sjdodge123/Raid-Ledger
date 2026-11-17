import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';
import { APP_EVENT_EVENTS } from '../../../discord-bot/discord-bot.constants';
import { lifecycleEventId } from '../event-discussion/event-discussion.listener';
import { HUB_FORUM_CHANGED, type HubForumChange } from '../hub-forum.emit';
import { HubForumDiscordOutboundService } from './hub-forum-discord-outbound.service';

/**
 * ROK-2208 §5.2 — hub forum writes → Discord. A Core behaviour
 * (`hub-forum.discord-sync`, §10). Failures are logged, never thrown into the
 * emitter; the link row keeps them retryable (S6 sweep).
 */
@Injectable()
export class HubForumDiscordOutboundListener {
  private readonly logger = new Logger(HubForumDiscordOutboundListener.name);
  /** Hub behaviour — read by the ownership guard's listener scan. */
  readonly hubBehaviour = 'hub-forum.discord-sync';
  readonly hubBehaviourKind = 'ingest-source';
  readonly ownerPluginId = CORE_PLUGIN_ID;

  constructor(private readonly outbound: HubForumDiscordOutboundService) {}

  @OnEvent(HUB_FORUM_CHANGED, { async: true })
  async onChange(change: HubForumChange): Promise<void> {
    try {
      await this.outbound.apply(change);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.logger.error(`Forum sync ${change.op} #${change.threadId}: ${why}`);
    }
  }

  /**
   * §5.7 item 2: an event edit or reschedule renames its linked post to the
   * dated title. Reads the event row itself, so it does not race the ROK-2226
   * reconciler listening to the same emit.
   */
  @OnEvent(APP_EVENT_EVENTS.UPDATED, { async: true })
  async onEventUpdated(payload: unknown): Promise<void> {
    const eventId = lifecycleEventId(payload);
    if (eventId === null) return;
    try {
      await this.outbound.retitleEvent(eventId);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.logger.error(`Forum retitle for event ${eventId}: ${why}`);
    }
  }
}
