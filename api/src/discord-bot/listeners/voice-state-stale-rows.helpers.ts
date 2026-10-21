/**
 * ROK-1888 review m3: the closing half of voice recovery. A bot restart (or a
 * dropped voiceStateUpdate) leaves an `in_voice` participant row open for a
 * member who already left, so durations and "N in voice" counts drift and
 * `hasOpenVoiceParticipants` pins the event live. Recovery re-adds the present
 * members; this closes the open voice rows of the absent ones.
 */
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import type { VoiceHandlerDeps } from './voice-handler-deps';

const p = schema.adHocParticipants;
const e = schema.events;

type StaleRowDeps = Pick<
  VoiceHandlerDeps,
  'db' | 'adHocParticipantService' | 'userChannelMap' | 'logger'
>;

/** Open voice rows on live / grace-period ad-hoc events. */
async function openVoiceRows(
  db: NonNullable<VoiceHandlerDeps['db']>,
): Promise<{ eventId: number; discordUserId: string | null }[]> {
  return db
    .select({ eventId: p.eventId, discordUserId: p.discordUserId })
    .from(p)
    .innerJoin(e, eq(e.id, p.eventId))
    .where(
      and(
        eq(e.isAdHoc, true),
        inArray(e.adHocStatus, ['live', 'grace_period']),
        isNull(e.cancelledAt),
        eq(p.inVoice, true),
        isNull(p.leftAt),
        isNotNull(p.discordUserId),
      ),
    );
}

/**
 * Close (leave time = now) every open voice row whose member is not in a bound
 * voice channel per `userChannelMap`, which recovery has just rebuilt from the
 * guild cache. Goes through `markLeave`, so a row still on a game server only
 * drops its voice flag, and a second run finds nothing open (idempotent).
 * The caller must only run this once the guild channel cache is populated.
 *
 * @returns How many rows were handed to `markLeave`.
 */
export async function closeStaleVoiceRows(
  deps: StaleRowDeps,
): Promise<number> {
  const { db, adHocParticipantService: svc } = deps;
  if (!db || !svc) return 0;
  let closed = 0;
  for (const row of await openVoiceRows(db)) {
    const id = row.discordUserId;
    if (!id || deps.userChannelMap.has(id)) continue;
    await svc.markLeave(row.eventId, id);
    closed++;
  }
  if (closed > 0) {
    deps.logger.log(`Recovery: closed ${closed} stale in-voice row(s)`);
  }
  return closed;
}
