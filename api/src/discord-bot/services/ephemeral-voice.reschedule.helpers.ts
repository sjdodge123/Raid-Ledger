import type { Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import type { SettingsService } from '../../settings/settings.service';
import type { EphemeralVoiceService } from './ephemeral-voice.service';
import {
  fetchEventForEphemeral,
  type EphemeralEventRow,
} from './ephemeral-voice.db-helpers';

/** What the reschedule release needs from the event listener (ROK-2201). */
export interface RescheduleReleaseDeps {
  db: PostgresJsDatabase<typeof schema>;
  settings: Pick<SettingsService, 'getEphemeralVoiceCreateBufferMinutes'>;
  logger: Pick<Logger, 'warn'>;
}

/** The single service call the release makes — a non-forced destroy. */
export type RescheduleReleaseVoice = Pick<
  EphemeralVoiceService,
  'destroyForEvent'
>;

/**
 * Pure (ROK-2201): true when the event holds a temporary voice channel but its
 * start now lies beyond `now + bufferMs` — outside the create-window cron's
 * inclusive `[now, now + buffer]` scan. A channel only exists once the start was
 * inside that window, so this means the start moved later. An unparsable start
 * is treated as "leave it alone".
 */
export function isStartPastCreateWindow(
  ev: Pick<EphemeralEventRow, 'ephemeralVoiceChannelId' | 'startTime'>,
  now: Date,
  bufferMs: number,
): boolean {
  if (!ev.ephemeralVoiceChannelId) return false;
  const start = Date.parse(ev.startTime);
  if (!Number.isFinite(start)) return false;
  return start > now.getTime() + bufferMs;
}

/**
 * ROK-2201 (operator ruling): on event UPDATED, release the temporary voice
 * channel when the start moved past the create window — but ONLY if it is
 * empty. `destroyForEvent` without `force` re-checks occupancy (an occupied
 * channel stays), deletes, clears `ephemeral_voice_channel_id` and re-points
 * the Scheduled Event; the create-window cron then recreates the channel before
 * the new start. Never throws — a failure is logged so the embed update that
 * follows still runs. Resolves true only when the channel was deleted.
 */
export async function releaseEphemeralIfStartMovedLater(
  deps: RescheduleReleaseDeps,
  voice: RescheduleReleaseVoice | null,
  eventId: number,
  now: Date = new Date(),
): Promise<boolean> {
  if (!voice) return false;
  try {
    const ev = await fetchEventForEphemeral(deps.db, eventId);
    if (!ev) return false;
    const bufferMin =
      await deps.settings.getEphemeralVoiceCreateBufferMinutes();
    if (!isStartPastCreateWindow(ev, now, bufferMin * 60_000)) return false;
    return await voice.destroyForEvent(ev);
  } catch (err) {
    deps.logger.warn(
      `Ephemeral reschedule release failed for event ${eventId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}
