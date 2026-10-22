import { asc, type SQL } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';

/**
 * ROK-1428 Codex r6 P2 — the ONE ordering for picking a game's announcements
 * binding when several rows exist (a manual binding can coexist with an
 * auto-managed one: uniqueness includes the channel id). Manual rows win over
 * auto rows, then the oldest row, then the lowest id as a deterministic
 * tiebreak. Shared by event routing (`getChannelForGame`) and the lifecycle
 * reconcile's candidate selection so both target the same channel.
 *
 * @returns the `ORDER BY` terms, most significant first
 */
export function gameAnnouncementPrecedence(): SQL[] {
  const cb = schema.channelBindings;
  return [asc(cb.autoManaged), asc(cb.createdAt), asc(cb.id)];
}
