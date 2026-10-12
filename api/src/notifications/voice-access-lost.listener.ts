import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from './notification.service';
import { NotificationDedupService } from './notification-dedup.service';
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

  private async notify(p: VoiceAccessLostPayload): Promise<boolean> {
    const target = await loadVoiceAccessTarget(this.db, p.eventId, p.userId);
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
