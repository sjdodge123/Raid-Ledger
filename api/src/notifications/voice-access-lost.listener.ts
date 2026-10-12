import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from './notification.service';
import { NotificationDedupService } from './notification-dedup.service';
import { SettingsService } from '../settings/settings.service';
import {
  SIGNUP_EVENTS,
  type SignupEventPayload,
} from '../discord-bot/discord-bot.constants';
import {
  VOICE_ACCESS_DEDUP_TTL_SECONDS,
  VOICE_ACCESS_LOST_EVENT,
  buildVoiceAccessLostInput,
  loadVoiceAccessTarget,
  voiceAccessDedupKey,
  type VoiceAccessLostPayload,
} from './voice-access-lost.helpers';

/**
 * ROK-1769: sends the "how to get back in" DM when a member loses access to a
 * private ephemeral voice channel. Never rejects (an `@OnEvent` throw would be
 * unhandled); DM preferences and deactivated-user skips are enforced by
 * `NotificationService.create` → `DiscordNotificationService.dispatch`.
 */
@Injectable()
export class VoiceAccessLostListener {
  private readonly logger = new Logger(VoiceAccessLostListener.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly notificationService: NotificationService,
    private readonly dedupService: NotificationDedupService,
    private readonly settingsService: SettingsService,
  ) {}

  /** Returns true when a notification was created (DM dispatched). */
  @OnEvent(VOICE_ACCESS_LOST_EVENT)
  async handle(payload: VoiceAccessLostPayload): Promise<boolean> {
    try {
      return await this.notify(payload);
    } catch (err) {
      this.logger.warn(
        `ROK-1769: voice-access DM failed for user ${payload.userId} event ${payload.eventId}: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
      return false;
    }
  }

  /**
   * A member who re-joined (signup_reactivated) is back on the allow-list:
   * release the dedupe key so a later departure DMs them again.
   */
  @OnEvent(SIGNUP_EVENTS.UPDATED)
  async onSignupUpdated(p: SignupEventPayload): Promise<void> {
    if (p.action !== 'signup_reactivated' || !p.userId) return;
    try {
      await this.dedupService.releaseKey(
        voiceAccessDedupKey(p.eventId, p.userId),
      );
    } catch (err) {
      this.logger.warn(
        `ROK-1769: voice-access dedupe release failed for user ${p.userId} event ${p.eventId}: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }
  }

  private async notify(p: VoiceAccessLostPayload): Promise<boolean> {
    const target = await loadVoiceAccessTarget(
      { db: this.db, settings: this.settingsService },
      p.eventId,
      p.userId,
    );
    if (!target) return false;
    const key = voiceAccessDedupKey(p.eventId, p.userId);
    const alreadySent = await this.dedupService.checkAndMarkSent(
      key,
      VOICE_ACCESS_DEDUP_TTL_SECONDS,
    );
    if (alreadySent) return false;
    const created = await this.notificationService.create(
      buildVoiceAccessLostInput(p.userId, p.eventId, target.title),
    );
    return created !== null;
  }
}
