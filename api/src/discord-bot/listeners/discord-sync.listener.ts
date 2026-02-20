import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  SIGNUP_EVENTS,
  type SignupEventPayload,
} from '../discord-bot.constants';
import { EmbedSyncQueueService } from '../queues/embed-sync.queue';

/**
 * Listens for signup and event lifecycle events and enqueues
 * debounced embed sync jobs (ROK-119 — Web -> Discord direction).
 *
 * Signup events are NOT already handled by DiscordEventListener, so
 * this listener bridges the gap. Event updates are also enqueued here
 * to ensure debouncing applies uniformly.
 */
@Injectable()
export class DiscordSyncListener {
  private readonly logger = new Logger(DiscordSyncListener.name);

  constructor(private readonly embedSyncQueue: EmbedSyncQueueService) {}

  @OnEvent(SIGNUP_EVENTS.CREATED)
  async onSignupCreated(payload: SignupEventPayload): Promise<void> {
    this.logger.debug(
      `Signup created for event ${payload.eventId} (action: ${payload.action})`,
    );
    await this.embedSyncQueue.enqueue(payload.eventId, payload.action);
  }

  @OnEvent(SIGNUP_EVENTS.UPDATED)
  async onSignupUpdated(payload: SignupEventPayload): Promise<void> {
    this.logger.debug(
      `Signup updated for event ${payload.eventId} (action: ${payload.action})`,
    );
    await this.embedSyncQueue.enqueue(payload.eventId, payload.action);
  }

  @OnEvent(SIGNUP_EVENTS.DELETED)
  async onSignupDeleted(payload: SignupEventPayload): Promise<void> {
    this.logger.debug(
      `Signup deleted for event ${payload.eventId} (action: ${payload.action})`,
    );
    await this.embedSyncQueue.enqueue(payload.eventId, payload.action);
  }
}
