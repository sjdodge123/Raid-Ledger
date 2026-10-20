import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../../drizzle/schema';

const { guildMembers: gm, characters: c, guildEditors: ge } = schema;

/**
 * ROK-1794 "explicit grants only" (operator ruling 2026-10-19): after a
 * guild's first import only staff or the holder of a staff-made member grant
 * may re-import it. Stands in for staff making that grant: on `guid`'s roster
 * row(s) when given (linked or not), else on every row a character links to.
 * Call AFTER the importer's GUID is pinned — a GUID claimed after the grant
 * is not the link staff confirmed, so the grant would not count.
 */
export async function grantMemberEditor(
  db: PostgresJsDatabase<typeof schema>,
  guid?: string,
): Promise<void> {
  const rows =
    guid === undefined
      ? await db
          .selectDistinct({ guildId: gm.guildId, memberId: gm.id })
          .from(gm)
          .innerJoin(c, eq(c.addonGuid, gm.guid))
      : await db
          .select({ guildId: gm.guildId, memberId: gm.id })
          .from(gm)
          .where(eq(gm.guid, guid));
  if (rows.length === 0) throw new Error('grantMemberEditor: no roster row');
  await db
    .insert(ge)
    .values(
      rows.map((r) => ({
        guildId: r.guildId,
        kind: 'member',
        guildMemberId: r.memberId,
      })),
    )
    .onConflictDoNothing();
}
