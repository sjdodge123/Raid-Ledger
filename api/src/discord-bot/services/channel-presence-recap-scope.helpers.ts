/**
 * ROK-1888 OQ3 — which ad-hoc sessions a presence message's recap covers.
 *
 * One live Quick Play per game (ruling 3) means a session born on channel A
 * is fed from channel B too. B's recap covers it when any of B's occupants
 * (the ROK-1499 occupancy ledger for that message) is one of its
 * participants — so the recap covers everyone, across every channel.
 */
import { eq, inArray, or, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { onBindingChannel } from './ad-hoc-event-channel-scope.helpers';

/** `events.id IN (sessions an occupant of this message joined)`. */
export function joinedByOccupants(
  db: PostgresJsDatabase<typeof schema>,
  presenceRowId: string,
): SQL {
  const p = schema.adHocParticipants;
  const o = schema.discordChannelPresenceOccupancy;
  return inArray(
    schema.events.id,
    db
      .select({ id: p.eventId })
      .from(p)
      .innerJoin(o, eq(o.discordUserId, p.discordUserId))
      .where(eq(o.presenceMessageId, presenceRowId)),
  );
}

/** The binding's own channel, plus (given the message row) its occupants'. */
export function recapScope(
  db: PostgresJsDatabase<typeof schema>,
  bindingId: string,
  presenceRowId?: string,
): SQL | undefined {
  if (!presenceRowId) return onBindingChannel(bindingId);
  return or(onBindingChannel(bindingId), joinedByOccupants(db, presenceRowId));
}
