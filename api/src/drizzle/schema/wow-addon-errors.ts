import {
  pgTable,
  serial,
  integer,
  varchar,
  char,
  text,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { companionDevices } from './companion-devices';

/**
 * ROK-2099 (S2a) — addon errors the Companion uploads as `wow-addon-errors`
 * v1 records (BugGrabber only), owned by the `blizzard` plugin. Every string
 * is re-scrubbed by the server before insert (D8). One row per (uploader,
 * scrubbed error); a re-upload upserts count / first / last seen / session.
 * Admin-readable only; never sent off the server (rulings 3–4). No `locals`
 * (ruling 7) and no time-of-day flag (Mailworthy is out of v1).
 */
const tsz = (name: string) => timestamp(name, { withTimezone: true });

export const wowAddonErrorRecords = pgTable(
  'wow_addon_error_records',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: integer('device_id').references(() => companionDevices.id, {
      onDelete: 'set null',
    }),
    /** SHA-256 of the WoW account folder name — never the raw name. */
    accountKey: char('account_key', { length: 64 }).notNull(),
    characterName: text('character_name'),
    characterRealm: text('character_realm'),
    source: varchar('source', { length: 16 }).notNull(),
    sourceVersion: text('source_version').notNull(),
    addon: text('addon').notNull(),
    message: text('message').notNull(),
    stack: text('stack'),
    /** D5: SHA-256 of `addon \n message \n stack`, computed after the scrub. */
    recordHash: char('record_hash', { length: 64 }).notNull(),
    count: integer('count').notNull(),
    session: integer('session'),
    firstSeenAt: tsz('first_seen_at').notNull(),
    lastSeenAt: tsz('last_seen_at').notNull(),
    /** Replacements the server's re-scrub made (0 when the collector did its job). */
    scrubbedCount: integer('scrubbed_count').notNull().default(0),
    createdAt: tsz('created_at').notNull().defaultNow(),
    updatedAt: tsz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // D5 dedupe key; covers the user FK (fk-index-coverage.spec.ts).
    uniqueIndex('wow_addon_error_records_user_hash_uq').on(
      t.userId,
      t.recordHash,
    ),
    // FK coverage + the S2b revoke cleanup (delete by device).
    index('wow_addon_error_records_device_id_idx').on(t.deviceId),
    // Admin grouping by addon, newest first (S3).
    index('wow_addon_error_records_addon_last_seen_idx').on(
      t.addon,
      t.lastSeenAt.desc(),
    ),
    // 90-day retention after last seen (S2b cron).
    index('wow_addon_error_records_last_seen_idx').on(t.lastSeenAt),
  ],
);

export type WowAddonErrorRecordRow = typeof wowAddonErrorRecords.$inferSelect;
export type WowAddonErrorRecordInsert =
  typeof wowAddonErrorRecords.$inferInsert;
