import {
  pgTable,
  serial,
  integer,
  smallint,
  text,
  boolean,
  doublePrecision,
  index,
  unique,
  check,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  importedAt,
  serverFk,
  snapshotCol,
  snapshotFk,
  tsz,
} from './valheim-armory';

/** Container privacy as the mod sent it; `group` is stored, never derived (ROK-1853). */
export type ValheimContainerPrivacyRow = 'public' | 'private' | 'group';

/**
 * ROK-1853 (D2/D3): one containers scan per server per world — the header,
 * the mod's omitted counts and the latest-wins guard (`captured_at`). Its
 * containers are replaced wholesale on every newer scan.
 */
export const valheimContainerScans = pgTable(
  'valheim_container_scans',
  {
    id: serial('id').primaryKey(),
    pelicanServerId: serverFk(),
    worldUid: text('world_uid').notNull(),
    gameVersion: text('game_version').notNull(),
    capturedAt: tsz('captured_at').notNull(),
    omittedShared: integer('omitted_shared').notNull(),
    omittedPrivate: integer('omitted_private').notNull(),
    containerCount: integer('container_count').notNull(),
    stackCount: integer('stack_count').notNull(),
    sourceSnapshotId: snapshotCol(),
    importedAt: importedAt(),
  },
  (t) => [
    // Leading pelican_server_id also backs the server FK.
    unique('valheim_container_scans_world_uq').on(
      t.pelicanServerId,
      t.worldUid,
    ),
    // D4: the newest scan of a server picks the world the hub shows.
    index('valheim_container_scans_server_captured_idx').on(
      t.pelicanServerId,
      t.capturedAt,
    ),
    index('valheim_container_scans_source_snapshot_idx').on(
      t.sourceSnapshotId,
    ),
    snapshotFk('valheim_container_scans', t.sourceSnapshotId),
  ],
);

/**
 * ROK-1853: one player-built container in a scan. `id` is internal and never
 * served — the browser sees `public_key` (D7). `pelican_server_id` is
 * denormalised for the read-time privacy predicate (deletion cascades via the
 * scan, so it carries no FK of its own).
 */
export const valheimContainers = pgTable(
  'valheim_containers',
  {
    id: serial('id').primaryKey(),
    scanId: integer('scan_id')
      .notNull()
      .references(() => valheimContainerScans.id, { onDelete: 'cascade' }),
    pelicanServerId: integer('pelican_server_id').notNull(),
    publicKey: text('public_key').notNull(),
    prefab: text('prefab').notNull(),
    x: doublePrecision('x').notNull(),
    y: doublePrecision('y').notNull(),
    z: doublePrecision('z').notNull(),
    /** Same canonical int64 spelling as `valheim_profiles.player_id`. */
    creatorPlayerId: text('creator_player_id').notNull(),
    privacy: text('privacy').$type<ValheimContainerPrivacyRow>().notNull(),
    vehicle: boolean('vehicle').notNull(),
    slots: integer('slots').notNull(),
    usedSlots: integer('used_slots').notNull(),
    unreadable: boolean('unreadable').notNull(),
    omittedEntries: integer('omitted_entries').notNull(),
  },
  (t) => [
    unique('valheim_containers_scan_key_uq').on(t.scanId, t.publicKey),
    // Leading scan_id also backs the scan FK.
    index('valheim_containers_scan_privacy_idx').on(t.scanId, t.privacy),
    check(
      'valheim_containers_privacy_chk',
      sql`${t.privacy} IN ('public','private','group')`,
    ),
  ],
);

/** ROK-1853: one aggregated (prefab, quality) stack inside a container. */
export const valheimContainerStacks = pgTable(
  'valheim_container_stacks',
  {
    containerId: integer('container_id')
      .notNull()
      .references(() => valheimContainers.id, { onDelete: 'cascade' }),
    prefab: text('prefab').notNull(),
    quality: smallint('quality').notNull(),
    stack: integer('stack').notNull(),
  },
  (t) => [
    // Leading container_id also backs the container FK.
    primaryKey({
      name: 'valheim_container_stacks_pk',
      columns: [t.containerId, t.prefab, t.quality],
    }),
  ],
);

export type ValheimContainerScan = typeof valheimContainerScans.$inferSelect;
export type NewValheimContainerScan = typeof valheimContainerScans.$inferInsert;
export type ValheimContainerRow = typeof valheimContainers.$inferSelect;
export type NewValheimContainerRow = typeof valheimContainers.$inferInsert;
export type NewValheimContainerStackRow =
  typeof valheimContainerStacks.$inferInsert;
