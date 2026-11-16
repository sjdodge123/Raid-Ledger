import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';
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
}
