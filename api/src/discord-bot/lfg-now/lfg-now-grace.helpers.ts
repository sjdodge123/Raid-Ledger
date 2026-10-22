/**
 * ROK-1888: an LFG-now attach to a Quick Play in grace restores it to `live`
 * (m4), which makes the pending grace job's `claimAndEndEvent` a no-op. If
 * nobody is in voice afterwards, no voice leave will ever start grace again,
 * so the session would stay live forever. This re-arms it, post-COMMIT, with
 * the ordinary voice-emptied rule and timing (the server still keeps it alive).
 */
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import { hasOpenVoiceParticipants } from '../services/ad-hoc-server-presence.helpers';
import { graceUnlessOnServer } from '../services/ad-hoc-voice-leave-server.helpers';

export type LfgNowGraceDeps = Parameters<typeof graceUnlessOnServer>[0];

/**
 * Re-arm grace on a just-restored session that has no open voice row.
 *
 * @param deps - The grace-start dependencies.
 * @param emitter - For the server tracker's keep-alive answer.
 * @param eventId - The restored Quick Play.
 */
export async function rearmGraceIfVoiceEmpty(
  deps: LfgNowGraceDeps,
  emitter: Pick<EventEmitter2, 'emitAsync'>,
  eventId: number,
): Promise<void> {
  if (await hasOpenVoiceParticipants(deps.db, eventId)) return;
  const [ev] = await deps.db
    .select({
      gameId: schema.events.gameId,
      bindingId: schema.events.channelBindingId,
    })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  if (!ev) return;
  await graceUnlessOnServer(deps, emitter, { eventId, ...ev });
}
