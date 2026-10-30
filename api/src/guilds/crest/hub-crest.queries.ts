import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { findVisible } from '../../hub-media/hub-media.read.repository';

/** ROK-1814 — crest reads/writes on `guilds` (the columns live there, L2). */

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const { guilds } = schema;

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

/** `SELECT … FOR UPDATE` the crest slice inside a transaction. */
async function lockRow(tx: Tx, guildId: number): Promise<CrestRow | null> {
  const [row] = await tx
    .select(CREST_COLUMNS)
    .from(guilds)
    .where(eq(guilds.id, guildId))
    .for('update');
  return row ?? null;
}

/**
 * Run `fn` while holding the hub row's lock (null row = no such hub). File
 * deletes go through here so they serialise with uploads, which write their
 * files inside `updateCrestRow`'s lock.
 */
export async function withLockedCrestRow(
  db: Db,
  guildId: number,
  fn: (row: CrestRow | null) => Promise<void>,
): Promise<void> {
  await db.transaction((tx) => lockRow(tx, guildId).then(fn));
}

/**
 * Lock the row, build the patch from its current crest, write it — one
 * transaction. Returns the row before and after, or null (no such hub /
 * `build` returned null = nothing to do). `build` may be
 * async: an upload writes its files there, under the lock. File deletes
 * happen AFTER this resolves (the commit), never inside it.
 */
export async function updateCrestRow(
  db: Db,
  guildId: number,
  build: (before: CrestRow) => CrestPatch | null | Promise<CrestPatch | null>,
): Promise<{ before: CrestRow; after: CrestRow } | null> {
  return db.transaction(async (tx) => {
    const before = await lockRow(tx, guildId);
    if (!before) return null;
    const patch = await build(before);
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
 * The storage name of a picture every viewer of THIS hub's gallery can see,
 * or null (another hub's id, removed, hidden, a source a gate hides —
 * `excludeSources` from `HubMediaSourceGateRegistry` — or missing). Same
 * visibility rule as the gallery itself (`findVisible`, non-editor scope).
 */
export async function findGalleryStorageName(
  db: Db,
  guildId: number,
  mediaId: number,
  excludeSources: readonly string[],
): Promise<string | null> {
  const scope = { guildId, includeHidden: false, excludeSources };
  const row = await findVisible(db, scope, mediaId);
  return row?.storageName ?? null;
}
