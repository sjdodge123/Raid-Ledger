/**
 * ROK-1446 / ROK-1801 — roster helpers for the presence card's room truth.
 *
 * Split out of `channel-presence-room.helpers.ts` for the 300-line cap (ROK-1801
 * layer C): the evented roster union, the render order and the id → name map.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { AdHocParticipant } from './ad-hoc-notification.helpers';
import type { RoomGroup } from './channel-presence-room.helpers';
import type { RoomSource } from './channel-presence-room.snapshot';

/**
 * Roster for an evented group: the stored `ad_hoc_participants` rows (leavers
 * kept, marked inactive — ROK-1243) UNION the live group members who have no
 * row yet, so someone who just joined voice still renders before the
 * participant write lands.
 */
export async function unionParticipants(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  memberIds: string[],
  source: RoomSource,
): Promise<AdHocParticipant[]> {
  const rows = await db
    .select({
      discordUserId: schema.adHocParticipants.discordUserId,
      discordUsername: schema.adHocParticipants.discordUsername,
      leftAt: schema.adHocParticipants.leftAt,
    })
    .from(schema.adHocParticipants)
    .where(eq(schema.adHocParticipants.eventId, eventId));
  const known = new Set(rows.map((r) => r.discordUserId));
  return [
    ...rows.map((r) => ({
      discordUserId: r.discordUserId,
      discordUsername: r.discordUsername,
      isActive: !r.leftAt,
    })),
    ...memberIds
      .filter((id) => !known.has(id))
      .map((id) => ({
        discordUserId: id,
        discordUsername: source.names.get(id) ?? id,
        isActive: true,
      })),
  ];
}

/** Render order (D2): evented groups first, then size desc, then name asc. */
export function sortGroups(groups: RoomGroup[]): RoomGroup[] {
  return [...groups].sort((a, b) => {
    const evented = Number(b.eventData !== null) - Number(a.eventData !== null);
    if (evented !== 0) return evented;
    const size = b.memberIds.length - a.memberIds.length;
    if (size !== 0) return size;
    return a.gameName.localeCompare(b.gameName);
  });
}

/** Map ids to display names, falling back to the raw id. */
export function namesOf(ids: string[], names: Map<string, string>): string[] {
  return ids.map((id) => names.get(id) ?? id);
}
