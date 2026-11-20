import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';
import {
  APP_EVENT_EVENTS,
  SIGNUP_CONFIRMATIONS_RESET,
  SIGNUP_CONFIRMATIONS_RESETTING,
  SIGNUP_EVENTS,
  type SignupEventPayload,
} from '../../../discord-bot/discord-bot.constants';
import { HubForumDiscordSignupPingQueue } from './hub-forum-discord-signup-pings.queue';
import { HubForumDiscordSignupPings } from './hub-forum-discord-signup-pings.service';

/**
 * ROK-2260 — any signup change (create, status change, cancel, delete)
 * re-arms the event's debounced flush; the flush itself diffs, so the
 * payload's action does not matter. Part of the Core forum sync
 * (`hub-forum.discord-sync`). Never throws into the signup path.
 */
@Injectable()
export class HubForumDiscordSignupPingListener {
  /** Hub behaviour — read by the ownership guard's listener scan. */
  readonly hubBehaviour = 'hub-forum.discord-sync';
  readonly hubBehaviourKind = 'ingest-source';
  readonly ownerPluginId = CORE_PLUGIN_ID;
  private readonly logger = new Logger(HubForumDiscordSignupPingListener.name);

  constructor(
    private readonly queue: HubForumDiscordSignupPingQueue,
    private readonly pings: HubForumDiscordSignupPings,
  ) {}

  @OnEvent(SIGNUP_EVENTS.CREATED, { async: true })
  async onCreated(payload: SignupEventPayload): Promise<void> {
    await this.rearm(payload);
  }

  @OnEvent(SIGNUP_EVENTS.UPDATED, { async: true })
  async onUpdated(payload: SignupEventPayload): Promise<void> {
    await this.rearm(payload);
  }

  @OnEvent(SIGNUP_EVENTS.DELETED, { async: true })
  async onDeleted(payload: SignupEventPayload): Promise<void> {
    await this.rearm(payload);
  }

  /**
   * Codex P2-5: an edit or reschedule changes no signup, but the flush is
   * what moves the pinged set's expiry to the event's new end. Re-arm it so
   * a postponed event never outlives its set (and re-pings everyone).
   */
  @OnEvent(APP_EVENT_EVENTS.UPDATED, { async: true })
  async onEventUpdated(payload: { eventId: number }): Promise<void> {
    await this.rearm(payload);
  }

  /**
   * ROK-2271 fix round 2: awaited by `resetSignupConfirmations` BEFORE its
   * write, so the flag is up before any flush can read the reset. Not
   * `async: true` on purpose: Nest's wrapper is not an AsyncFunction, so an
   * async listener would not be awaited by `emitAsync`.
   */
  @OnEvent(SIGNUP_CONFIRMATIONS_RESETTING)
  async onConfirmationsResetting(payload: {
    eventId: number;
    aborted?: boolean;
  }): Promise<void> {
    if (!Number.isInteger(payload?.eventId)) return;
    try {
      if (payload.aborted === true)
        await this.pings.abortReset(payload.eventId);
      else await this.pings.markResetPending(payload.eventId);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Signup line reset flag for ${payload.eventId}: ${why}`);
    }
  }

  /**
   * ROK-2271 review MAJOR-1: a reschedule reset everyone's confirmation.
   * Only flags it; the next flush (serialised in the worker) re-syncs the
   * posted lines to the reset statuses without posting or pinging.
   */
  @OnEvent(SIGNUP_CONFIRMATIONS_RESET, { async: true })
  async onConfirmationsReset(payload: { eventId: number }): Promise<void> {
    if (!Number.isInteger(payload?.eventId)) return;
    try {
      await this.pings.requestResync(payload.eventId);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Signup line resync for ${payload.eventId}: ${why}`);
    }
    await this.rearm(payload);
  }

  /**
   * Arms the flush; a failure is logged, never thrown into the emitter.
   * ROK-2271 C4: an `urgent` change (running late, roach-out) flushes now.
   */
  private async rearm(payload: {
    eventId: number;
    urgent?: boolean;
  }): Promise<void> {
    if (!Number.isInteger(payload?.eventId)) return;
    try {
      if (payload.urgent === true) await this.queue.flushNow(payload.eventId);
      else await this.queue.schedule(payload.eventId);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Signup ping re-arm for ${payload.eventId}: ${why}`);
    }
  }
}
