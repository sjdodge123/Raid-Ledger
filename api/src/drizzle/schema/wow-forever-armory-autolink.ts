import {
  pgTable,
  uuid,
  smallint,
  varchar,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { characters } from './characters';

/**
 * ROK-2124: retry state for auto-linking a LedgerLink-bound WoW: Forever
 * character to its Battle.net Armory profile — plugin-owned (only
 * `plugins/wow-common/forever-auto-link` reads or writes it).
 *
 * One row per character whose link attempt FAILED (404 / upstream / external
 * id conflict); a successful link deletes it. No row = due now (this is how
 * the hourly job backfills pre-existing LedgerLink rows). Deleting the
 * character cascades.
 */
export const wowForeverArmoryAutolink = pgTable(
  'wow_forever_armory_autolink',
  {
    characterId: uuid('character_id')
      .primaryKey()
      .references(() => characters.id, { onDelete: 'cascade' }),
    /** Consecutive failed attempts; drives the exponential backoff. */
    failures: smallint('failures').notNull().default(0),
    /** Earliest time the next attempt may call Blizzard. */
    retryAt: timestamp('retry_at', { withTimezone: true }).notNull(),
    /** `AutoLinkErrorKind` of the last failure. */
    lastError: varchar('last_error', { length: 32 }).notNull(),
    lastAttemptAt: timestamp('last_attempt_at', {
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    index('idx_wow_forever_armory_autolink_retry_at').on(table.retryAt),
  ],
);

export type WowForeverArmoryAutolinkInsert =
  typeof wowForeverArmoryAutolink.$inferInsert;
export type WowForeverArmoryAutolinkSelect =
  typeof wowForeverArmoryAutolink.$inferSelect;
