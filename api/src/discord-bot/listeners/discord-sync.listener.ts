import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  SIGNUP_EVENTS,
  type SignupEventPayload,
} from '../discord-bot.constants';
import { EmbedSyncQueueService } from '../queues/embed-sync.queue';
import { EphemeralVoiceService } from '../services/ephemeral-voice.service';

/** Debounce window for private-voice access re-sync — mirrors the embed-sync
 *  coalescing window so a burst of roster edits collapses to one reconcile. */
const VOICE_ACCESS_DEBOUNCE_MS = 2_000;

/**
 * Listens for signup and event lifecycle events and enqueues
 * debounced embed sync jobs (ROK-119 — Web -> Discord direction).
 *
 * Signup events are NOT already handled by DiscordEventListener, so
 * this listener bridges the gap. Event updates are also enqueued here
 * to ensure debouncing applies uniformly.
 *
 * ROK-1386: also debounce-triggers EphemeralVoiceService.syncVoiceAccess so a
 * private event's voice allow-list full-reconciles on signup AND roster/bench
 * reassignment (the service bails fast for non-private / channel-less events).
 */
@Injectable()
export class DiscordSyncListener implements OnApplicationShutdown {
  private readonly logger = new Logger(DiscordSyncListener.name);
  private readonly voiceAccessTimers = new Map<number, NodeJS.Timeout>();

  constructor(
    private readonly embedSyncQueue: EmbedSyncQueueService,
    private readonly ephemeralVoice: EphemeralVoiceService,
  ) {}

  @OnEvent(SIGNUP_EVENTS.CREATED)
  async onSignupCreated(payload: SignupEventPayload): Promise<void> {
    this.logger.debug(
      `Signup created for event ${payload.eventId} (action: ${payload.action})`,
    );
    await this.embedSyncQueue.enqueue(payload.eventId, payload.action);
    this.scheduleVoiceAccessSync(payload.eventId);
  }

  @OnEvent(SIGNUP_EVENTS.UPDATED)
  async onSignupUpdated(payload: SignupEventPayload): Promise<void> {
    this.logger.debug(
      `Signup updated for event ${payload.eventId} (action: ${payload.action})`,
    );
    await this.embedSyncQueue.enqueue(payload.eventId, payload.action);
    this.scheduleVoiceAccessSync(payload.eventId);
  }

  @OnEvent(SIGNUP_EVENTS.DELETED)
  async onSignupDeleted(payload: SignupEventPayload): Promise<void> {
    this.logger.debug(
      `Signup deleted for event ${payload.eventId} (action: ${payload.action})`,
    );
    await this.embedSyncQueue.enqueue(payload.eventId, payload.action);
    this.scheduleVoiceAccessSync(payload.eventId);
  }

  onApplicationShutdown(): void {
    for (const timer of this.voiceAccessTimers.values()) clearTimeout(timer);
    this.voiceAccessTimers.clear();
  }

  /**
   * Debounce a private-voice access re-sync for an event. Coalesces rapid-fire
   * roster/signup changes into a single full-reconcile (resets the timer each
   * call, keyed by eventId).
   */
  private scheduleVoiceAccessSync(eventId: number): void {
    const existing = this.voiceAccessTimers.get(eventId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.voiceAccessTimers.delete(eventId);
      this.ephemeralVoice
        .syncVoiceAccess(eventId)
        .catch((e) =>
          this.logger.warn(
            `Voice access sync failed for event ${eventId}: ${e}`,
          ),
        );
    }, VOICE_ACCESS_DEBOUNCE_MS);
    this.voiceAccessTimers.set(eventId, timer);
  }
}
