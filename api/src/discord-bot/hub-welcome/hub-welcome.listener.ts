/**
 * ROK-1933 Part 4 — consumes the hub channel events and drives
 * `HubWelcomeService`. Fire-and-forget: `emitHubChannelEvent` only catches a
 * listener's SYNCHRONOUS throw, so every async failure is caught and logged
 * here and never rethrown — a Discord failure never fails the bind.
 */
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  HUB_CHANNEL_EVENTS,
  type HubChannelClearedEvent,
  type HubChannelLinkedEvent,
} from '../../guilds/hub-channel.events';
import { HubWelcomeService } from './hub-welcome.service';

@Injectable()
export class HubWelcomeListener {
  private readonly logger = new Logger(HubWelcomeListener.name);

  constructor(private readonly welcome: HubWelcomeService) {}

  /** A channel was linked (manual set, re-set or lifecycle auto-link). */
  @OnEvent(HUB_CHANNEL_EVENTS.LINKED)
  onLinked(event: HubChannelLinkedEvent): Promise<void> {
    return this.settle('linked', event.guildId, () =>
      this.welcome.welcomeLinked(event.guildId, event.channelId),
    );
  }

  /** A channel was unbound. */
  @OnEvent(HUB_CHANNEL_EVENTS.CLEARED)
  onCleared(event: HubChannelClearedEvent): Promise<void> {
    return this.settle('cleared', event.guildId, () =>
      this.welcome.removeWelcome(event.guildId),
    );
  }

  /** Await `task`; log a failure, never rethrow. */
  private async settle(
    what: string,
    guildId: number,
    task: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await task();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Hub ${guildId} welcome (${what}) failed: ${message}`);
    }
  }
}
