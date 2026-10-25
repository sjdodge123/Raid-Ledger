import {
  pgTable,
  serial,
  integer,
  text,
  char,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';
import { companionDevices } from './companion-devices';

/** Longest handler-declared latest-wins key (e.g. a bg3 `campaignKey`). */
export const COMPANION_LATEST_KEY_MAX_CHARS = 128;

/** The only blob media type stored in v1. */
export const COMPANION_BLOB_CONTENT_TYPE = 'image/webp';

/**
 * ROK-1956: core latest-wins state. One row per (user, contract, key) holding
 * the newest `at` (e.g. bg3 `savedAt`) accepted so far; an incoming message
 * whose `at` is not strictly greater is `stale` and its handler is not
 * called. Per user, so one member never marks another's save stale.
 */
export const companionIngestLatest = pgTable(
  'companion_ingest_latest',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    contract: text('contract').notNull(),
    latestKey: text('latest_key').notNull(),
    latestAt: timestamp('latest_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Leads on user_id, so it also covers the users FK.
    primaryKey({ columns: [t.userId, t.contract, t.latestKey] }),
    check(
      'companion_ingest_latest_key_len_chk',
      sql`char_length(${t.latestKey}) <= 128`,
    ),
  ],
);

/**
 * ROK-1956: private, per-user, content-addressed blob index. The verified
 * WebP lives at `<root>/<user_id>/<sha256>.webp` (`storage_path` is relative
 * to the root). Raw bytes are never served; the owning plugin re-encodes.
 */
export const companionBlobs = pgTable(
  'companion_blobs',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sha256: char('sha256', { length: 64 }).notNull(),
    byteLength: integer('byte_length').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    contentType: text('content_type')
      .notNull()
      .default(COMPANION_BLOB_CONTENT_TYPE),
    storagePath: text('storage_path').notNull(),
    deviceId: integer('device_id').references(() => companionDevices.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One copy per user (no cross-user "exists" oracle); covers the users FK.
    uniqueIndex('companion_blobs_user_sha_uq').on(t.userId, t.sha256),
    // Orphan-cleanup scan.
    index('companion_blobs_created_at_idx').on(t.createdAt),
    // FK coverage (fk-index-coverage.spec.ts).
    index('companion_blobs_device_id_idx').on(t.deviceId),
    check('companion_blobs_sha256_chk', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check(
      'companion_blobs_content_type_chk',
      sql`${t.contentType} = 'image/webp'`,
    ),
  ],
);

/**
 * ROK-1956: a message's `CompanionWebpRef` to a blob, recorded in the ingest
 * transaction. No FK to `companion_blobs` — the message and the upload may
 * arrive in either order; an upload must agree with every ref to its sha.
 * Plugins release refs (C4 owns retention); unreferenced blobs are cleaned.
 */
export const companionBlobRefs = pgTable(
  'companion_blob_refs',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sha256: char('sha256', { length: 64 }).notNull(),
    contract: text('contract').notNull(),
    byteLength: integer('byte_length').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    referencedAt: timestamp('referenced_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.sha256, t.contract] })],
);

/**
 * ROK-1956 Codex P1: bytes held for in-flight companion blob uploads. The
 * global disk cap counts `sum(companion_blobs.byte_length)` plus every live
 * row here, read and written under ONE global advisory lock, so concurrent
 * and chunked uploads cannot overshoot it. A row lives for one upload
 * (released in a `finally`); rows a crash leaks expire by `created_at`.
 */
export const companionBlobReservations = pgTable(
  'companion_blob_reservations',
  {
    id: serial('id').primaryKey(),
    bytes: integer('bytes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('companion_blob_reservations_created_at_idx').on(t.createdAt),
    check('companion_blob_reservations_bytes_chk', sql`${t.bytes} > 0`),
  ],
);
