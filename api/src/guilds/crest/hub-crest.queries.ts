import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

/** ROK-1814 — crest reads/writes on `guilds` (the columns live there, L2). */

type Db = PostgresJsDatabase<typeof schema>;

const { guilds, hubMedia } = schema;

const CREST_COLUMNS = {
  id: guilds.id,
  crestActive: guilds.crestActive,
  crestUploadKey: guilds.crestUploadKey,
  crestPreset: guilds.crestPreset,
  crestRemovedAt: guilds.crestRemovedAt,
};

/** The crest slice of one `guilds` row. */
export type CrestRow = {
  id: number;
  crestActive: 'upload' | 'preset' | null;
  crestUploadKey: string | null;
  crestPreset: schema.GuildSelect['crestPreset'];
  crestRemovedAt: Date | null;
};

/** The crest columns one write may set. */
export type CrestPatch = Partial<
  Pick<
    schema.GuildInsert,
    | 'crestActive'
    | 'crestUploadKey'
    | 'crestPreset'
    | 'crestSetBy'
    | 'crestSetAt'
    | 'crestRemovedBy'
    | 'crestRemovedAt'
  >
>;

/** The crest slice of a hub, or null when the hub does not exist. */
export async function findCrestRow(
  db: Db,
  guildId: number,
): Promise<CrestRow | null> {
  const [row] = await db
    .select(CREST_COLUMNS)
    .from(guilds)
    .where(eq(guilds.id, guildId))
    .limit(1);
  return row ?? null;
}

/**
 * Lock the row, build the patch from its current crest, write it — one
 * transaction. Returns the row before and after, or null (no such hub /
 * `build` returned null = nothing to do). File deletes happen AFTER this
 * resolves (the commit), never inside it.
 */
export async function updateCrestRow(
  db: Db,
  guildId: number,
  build: (before: CrestRow) => CrestPatch | null,
): Promise<{ before: CrestRow; after: CrestRow } | null> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select(CREST_COLUMNS)
      .from(guilds)
      .where(eq(guilds.id, guildId))
      .for('update');
    if (!before) return null;
    const patch = build(before);
    if (!patch) return null;
    const [after] = await tx
      .update(guilds)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(guilds.id, guildId))
      .returning(CREST_COLUMNS);
    return after ? { before, after } : null;
  });
}

/**
 * The storage name of a live, unhidden picture in THIS hub's gallery, or
 * null (another hub's id, removed, hidden, or missing).
 */
export async function findGalleryStorageName(
  db: Db,
  guildId: number,
  mediaId: number,
): Promise<string | null> {
  const [row] = await db
    .select({ storageName: hubMedia.storageName })
    .from(hubMedia)
    .where(
      and(
        eq(hubMedia.guildId, guildId),
        eq(hubMedia.id, mediaId),
        isNull(hubMedia.removedAt),
        isNull(hubMedia.hiddenAt),
      ),
    )
    .limit(1);
  return row?.storageName ?? null;
}
