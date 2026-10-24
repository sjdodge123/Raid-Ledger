import {
  pgTable,
  serial,
  integer,
  text,
  doublePrecision,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import {
  importedAt,
  serverFk,
  snapshotCol,
  snapshotFk,
  tsz,
} from './valheim-columns';

/**
 * ROK-1946 (D2/D3): one portals scan per server per world — the header and
 * the latest-wins guard (`captured_at`), kept even at zero portals so a
 * delayed older scan cannot resurrect destroyed portals. Its portals are
 * replaced wholesale on every newer scan.
 */
export const valheimPortalScans = pgTable(
  'valheim_portal_scans',
  {
    id: serial('id').primaryKey(),
    pelicanServerId: serverFk(),
    worldUid: text('world_uid').notNull(),
    gameVersion: text('game_version').notNull(),
    capturedAt: tsz('captured_at').notNull(),
    omitted: integer('omitted').notNull(),
    portalCount: integer('portal_count').notNull(),
    sourceSnapshotId: snapshotCol(),
    importedAt: importedAt(),
  },
  (t) => [
    // Leading pelican_server_id also backs the server FK.
    unique('valheim_portal_scans_world_uq').on(t.pelicanServerId, t.worldUid),
    index('valheim_portal_scans_server_captured_idx').on(
      t.pelicanServerId,
      t.capturedAt,
    ),
    index('valheim_portal_scans_source_snapshot_idx').on(t.sourceSnapshotId),
    snapshotFk('valheim_portal_scans', t.sourceSnapshotId),
  ],
);

/**
 * ROK-1946: one portal in a scan. `pelican_server_id` is denormalised
 * (deletion cascades via the scan, so it carries no FK of its own). `y` is
 * NULL when the scan had no height; `tag` may be empty.
 */
export const valheimPortals = pgTable(
  'valheim_portals',
  {
    id: serial('id').primaryKey(),
    scanId: integer('scan_id')
      .notNull()
      .references(() => valheimPortalScans.id, { onDelete: 'cascade' }),
    pelicanServerId: integer('pelican_server_id').notNull(),
    prefab: text('prefab').notNull(),
    x: doublePrecision('x').notNull(),
    y: doublePrecision('y'),
    z: doublePrecision('z').notNull(),
    tag: text('tag').notNull(),
  },
  // Backs the scan FK and the per-scan replace / read.
  (t) => [index('valheim_portals_scan_idx').on(t.scanId)],
);

export type ValheimPortalScan = typeof valheimPortalScans.$inferSelect;
export type NewValheimPortalScan = typeof valheimPortalScans.$inferInsert;
export type ValheimPortalRow = typeof valheimPortals.$inferSelect;
export type NewValheimPortalRow = typeof valheimPortals.$inferInsert;
