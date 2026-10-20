/**
 * Shared Valheim storage column builders (ROK-1835, reused by ROK-1854).
 * Not re-exported from the schema barrel — they are builders, not tables.
 */
import { bigint, foreignKey, integer, timestamp } from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { pelicanServers } from './pelican-servers';
import { valheimLinkSnapshots } from './valheim-link';

export const tsz = (name: string) => timestamp(name, { withTimezone: true });
export const importedAt = () => tsz('imported_at').notNull().defaultNow();
export const serverFk = () =>
  integer('pelican_server_id')
    .notNull()
    .references(() => pelicanServers.id, { onDelete: 'cascade' });
export const snapshotCol = () =>
  bigint('source_snapshot_id', { mode: 'number' });
/**
 * Explicitly named: drizzle's default `<table>_source_snapshot_id_
 * valheim_link_snapshots_id_fk` exceeds Postgres' 63-char identifier limit
 * (constraint-name-length.spec.ts, ROK-1387).
 */
export const snapshotFk = (table: string, col: AnyPgColumn) =>
  foreignKey({
    columns: [col],
    foreignColumns: [valheimLinkSnapshots.id],
    name: `${table}_source_snapshot_fk`,
  }).onDelete('set null');
