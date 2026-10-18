import {
  pgTable,
  serial,
  bigserial,
  integer,
  text,
  timestamp,
  jsonb,
  index,
  unique,
  check,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { pelicanServers } from './pelican-servers';
import { users } from './users';

/**
 * ROK-1833: one ingest token per Pelican server (the wire `serverId` is
 * `String(pelican_servers.id)`). Only the sha256 hex hash is stored; the raw
 * token is shown once at issue/rotate. `token_hint` (last 4 chars) is for
 * display only. Rotation replaces the hash in place (old token dies at once);
 * revoke stamps `revoked_at`. Never log the hash or the hint.
 */
export const valheimLinkTokens = pgTable(
  'valheim_link_tokens',
  {
    id: serial('id').primaryKey(),
    pelicanServerId: integer('pelican_server_id')
      .notNull()
      .unique()
      .references(() => pelicanServers.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    tokenHint: text('token_hint').notNull(),
    createdBy: integer('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    /** NULL = live. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** Stamped at most once per 60 s per server. */
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [
    // Backs the users FK (fk-index-coverage.spec.ts).
    index('valheim_link_tokens_created_by_idx').on(t.createdBy),
  ],
);

/** A blob reference stored on a snapshot row. */
export interface ValheimLinkBlobRefRow {
  sha256: string;
  byteLength: number;
  width: number;
  height: number;
  /** `fileIcon` = an items `file` icon's optional `blob` (ROK-1833). */
  role: 'baseMap' | 'atlas' | 'fileIcon';
}

/**
 * ROK-1833: latest-wins handoff table read by the ROK-1835 importer. One row
 * per (server, kind, snapshot_key) — CONTRACT §1 snapshot key. `payload` is
 * the full validated message verbatim. ROK-1835 owns `status` after
 * 'pending'.
 */
export const valheimLinkSnapshots = pgTable(
  'valheim_link_snapshots',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    pelicanServerId: integer('pelican_server_id')
      .notNull()
      .references(() => pelicanServers.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    snapshotKey: text('snapshot_key').notNull(),
    steamId: text('steam_id'),
    /** int64 as a string. */
    playerId: text('player_id'),
    worldUid: text('world_uid'),
    gameVersion: text('game_version').notNull(),
    modVersion: text('mod_version').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    payload: jsonb('payload').notNull(),
    blobRefs: jsonb('blob_refs')
      .$type<ValheimLinkBlobRefRow[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    status: text('status').notNull().default('pending'),
    statusDetail: text('status_detail'),
  },
  (t) => [
    // Leading pelican_server_id also backs the FK.
    unique('valheim_link_snapshots_key_uq').on(
      t.pelicanServerId,
      t.kind,
      t.snapshotKey,
    ),
    index('valheim_link_snapshots_status_received_idx').on(
      t.status,
      t.receivedAt,
    ),
    check(
      'valheim_link_snapshots_kind_chk',
      sql`${t.kind} IN ('character','map','items')`,
    ),
    check(
      'valheim_link_snapshots_status_chk',
      sql`${t.status} IN ('pending','imported','failed')`,
    ),
  ],
);

/**
 * ROK-1833: metadata for content-addressed PNG blobs stored under
 * `VALHEIM_LINK_BLOB_DIR`. Scoped per server (pk includes it) so one server's
 * uploads never satisfy or poison another server's references.
 */
export const valheimLinkBlobs = pgTable(
  'valheim_link_blobs',
  {
    pelicanServerId: integer('pelican_server_id')
      .notNull()
      .references(() => pelicanServers.id, { onDelete: 'cascade' }),
    sha256: text('sha256').notNull(),
    byteLength: integer('byte_length').notNull(),
    /** 'image/png' only in v1. */
    contentType: text('content_type').notNull(),
    /** From IHDR. */
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    /** Relative to VALHEIM_LINK_BLOB_DIR. */
    storagePath: text('storage_path').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastReferencedAt: timestamp('last_referenced_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.pelicanServerId, t.sha256] })],
);

export type ValheimLinkTokenRow = typeof valheimLinkTokens.$inferSelect;
export type NewValheimLinkToken = typeof valheimLinkTokens.$inferInsert;
export type ValheimLinkSnapshotRow = typeof valheimLinkSnapshots.$inferSelect;
export type NewValheimLinkSnapshot = typeof valheimLinkSnapshots.$inferInsert;
export type ValheimLinkBlobRow = typeof valheimLinkBlobs.$inferSelect;
export type NewValheimLinkBlob = typeof valheimLinkBlobs.$inferInsert;
