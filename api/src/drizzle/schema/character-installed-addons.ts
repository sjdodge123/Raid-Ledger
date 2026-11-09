import { pgTable, uuid, jsonb, timestamp, char } from 'drizzle-orm/pg-core';
import type { AddonInstalled } from '@raid-ledger/contract';
import { characters } from './characters';

/**
 * ROK-2147: the installed-addon list from a character's latest LedgerLink
 * `char` export (`data.addons`, lifted beside the frozen snapshot — never
 * stored in `character_addon_snapshots.data`). Plugin-owned (only
 * `plugins/wow-common/addon-import` writes it). One row per character; a
 * newer-or-equal export with a different sha replaces it. Deleted with the
 * character, and on an admin owner change (the new owner never sees the
 * previous owner's client).
 */
export const characterInstalledAddons = pgTable('character_installed_addons', {
  characterId: uuid('character_id')
    .primaryKey()
    .references(() => characters.id, { onDelete: 'cascade' }),
  /** Sanitised, de-duplicated (case-insensitive folder name, first kept). */
  addons: jsonb('addons').$type<AddonInstalled[]>().notNull(),
  /** The export's `exportedAt` — the in-game capture time. */
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
  importedAt: timestamp('imported_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  /** sha256 (hex) of the char section; the raw string is never stored. */
  payloadSha256: char('payload_sha256', { length: 64 }).notNull(),
});

export type CharacterInstalledAddonsSelect =
  typeof characterInstalledAddons.$inferSelect;
