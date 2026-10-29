import {
  pgTable,
  bigserial,
  bigint,
  integer,
  text,
  boolean,
  date,
  unique,
  check,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { serverFk, tsz } from './valheim-columns';

/**
 * ROK-2014 (D1/D4): one row per server × world × PLAY day (the day a
 * containers scan arrives, in the server's timezone → community default →
 * UTC). Its presence says "this day was played", so an item absent from the
 * day's rows reads as 0. Retention (30 days) is one delete here that cascades
 * to the item rows.
 */
export const valheimContainerDays = pgTable(
  'valheim_container_days',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    pelicanServerId: serverFk(),
    worldUid: text('world_uid').notNull(),
    /** The bucket date, literal `YYYY-MM-DD` — never parsed through `Date`. */
    playDate: date('play_date', { mode: 'string' }).notNull(),
    firstCapturedAt: tsz('first_captured_at').notNull(),
    lastCapturedAt: tsz('last_captured_at').notNull(),
  },
  (t) => [
    // Leading pelican_server_id backs the server FK, the newest-N read
    // (ORDER BY play_date DESC) and the retention delete.
    unique('valheim_container_days_server_world_date_uq').on(
      t.pelicanServerId,
      t.worldUid,
      t.playDate,
    ),
  ],
);

/** The day FK, explicitly named: drizzle's default exceeds 63 chars. */
const dayIdCol = () => bigint('day_id', { mode: 'number' }).notNull();

/**
 * Segment columns (D3): `vehicle` + `owner` (`''` = shared, i.e. privacy is
 * not `private`; else the private chest's `creator_player_id`, never served).
 * `total` is the end-of-day sum over qualities (D2); a zero row is deleted,
 * never stored.
 */
const segmentCols = () => ({
  prefab: text('prefab').notNull(),
  vehicle: boolean('vehicle').notNull(),
  owner: text('owner').notNull(),
  total: bigint('total', { mode: 'number' }).notNull(),
});

/** ROK-2014: end-of-day total per server-day × prefab × segment. */
export const valheimContainerItemDays = pgTable(
  'valheim_container_item_days',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    dayId: dayIdCol(),
    ...segmentCols(),
  },
  (t) => [
    foreignKey({
      columns: [t.dayId],
      foreignColumns: [valheimContainerDays.id],
      name: 'valheim_container_item_days_day_fk',
    }).onDelete('cascade'),
    // Leading day_id also backs the day FK.
    unique('valheim_container_item_days_key_uq').on(
      t.dayId,
      t.prefab,
      t.vehicle,
      t.owner,
    ),
    check('valheim_container_item_days_total_chk', sql`${t.total} > 0`),
  ],
);

/**
 * ROK-2014 (D9): end-of-day total per server-day × base × prefab × segment.
 * `base_key` is the 22-char base key (`ValheimMaterialsBase.key`); the rounded
 * centroid lets the read match a base whose key drifted (OPEN-1, ≤ 64 m).
 */
export const valheimContainerBaseItemDays = pgTable(
  'valheim_container_base_item_days',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    dayId: dayIdCol(),
    baseKey: text('base_key').notNull(),
    baseX: integer('base_x').notNull(),
    baseZ: integer('base_z').notNull(),
    ...segmentCols(),
  },
  (t) => [
    foreignKey({
      columns: [t.dayId],
      foreignColumns: [valheimContainerDays.id],
      name: 'valheim_container_base_item_days_day_fk',
    }).onDelete('cascade'),
    // Leading day_id also backs the day FK.
    unique('valheim_container_base_item_days_key_uq').on(
      t.dayId,
      t.baseKey,
      t.prefab,
      t.vehicle,
      t.owner,
    ),
    check('valheim_container_base_item_days_total_chk', sql`${t.total} > 0`),
  ],
);

export type ValheimContainerDayRow = typeof valheimContainerDays.$inferSelect;
export type NewValheimContainerDay = typeof valheimContainerDays.$inferInsert;
export type ValheimContainerItemDayRow =
  typeof valheimContainerItemDays.$inferSelect;
export type NewValheimContainerItemDay =
  typeof valheimContainerItemDays.$inferInsert;
export type ValheimContainerBaseItemDayRow =
  typeof valheimContainerBaseItemDays.$inferSelect;
export type NewValheimContainerBaseItemDay =
  typeof valheimContainerBaseItemDays.$inferInsert;
