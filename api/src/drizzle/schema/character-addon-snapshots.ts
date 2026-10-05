import {
  pgTable,
  serial,
  uuid,
  varchar,
  smallint,
  jsonb,
  timestamp,
  char,
  unique,
} from 'drizzle-orm/pg-core';
import type { AddonCharSnapshotData } from '@raid-ledger/contract';
import { characters } from './characters';

/**
 * ROK-1724: the latest WoW addon export per character and section — plugin-owned
 * (only `plugins/wow-common/addon-import` writes it). One row per
 * (character, section); a newer import replaces it, an older one is `stale`.
 *
 * `data` holds the sanitised payload, never the raw import string — for
 * section 'char' it is the FROZEN `AddonCharSnapshotData` shape (contract),
 * which ROK-1727 reads. A shape change bumps `schema`.
 */
export const characterAddonSnapshots = pgTable(
  'character_addon_snapshots',
  {
    id: serial('id').primaryKey(),
    characterId: uuid('character_id')
      .references(() => characters.id, { onDelete: 'cascade' })
      .notNull(),
    /** Export section — 'char' today. */
    section: varchar('section', { length: 10 }).notNull(),
    /** Payload schema number of `data`. */
    schema: smallint('schema').notNull(),
    data: jsonb('data').$type<AddonCharSnapshotData>().notNull(),
    /** The addon's `exportedAt` — the in-game capture time. */
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    importedAt: timestamp('imported_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    /** sha256 (hex) of the decoded payload; the raw string is never stored. */
    payloadSha256: char('payload_sha256', { length: 64 }).notNull(),
  },
  (table) => [
    /** One snapshot per section; also backs the character_id FK. */
    unique('uq_character_addon_snapshots_character_section').on(
      table.characterId,
      table.section,
    ),
  ],
);

export type CharacterAddonSnapshotInsert =
  typeof characterAddonSnapshots.$inferInsert;
export type CharacterAddonSnapshotSelect =
  typeof characterAddonSnapshots.$inferSelect;
