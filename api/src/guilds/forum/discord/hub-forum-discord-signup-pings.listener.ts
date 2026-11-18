import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';
import {
  SIGNUP_EVENTS,
  type SignupEventPayload,
} from '../../../discord-bot/discord-bot.constants';
import { HubForumDiscordSignupPingQueue } from './hub-forum-discord-signup-pings.queue';

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

  constructor(private readonly queue: HubForumDiscordSignupPingQueue) {}

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

  private async rearm(payload: SignupEventPayload): Promise<void> {
    if (!Number.isInteger(payload?.eventId)) return;
    await this.queue.schedule(payload.eventId);
  }
}
