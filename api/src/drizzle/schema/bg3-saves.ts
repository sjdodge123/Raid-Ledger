import {
  pgTable,
  serial,
  integer,
  smallint,
  varchar,
  char,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { Bg3PartyMember } from '@raid-ledger/contract';
import { users } from './users';
import { companionDevices } from './companion-devices';
import { bg3Campaigns } from './bg3';

/**
 * ROK-1957 (C4) — the `bg3` save history (spec §4). No snapshot table (D-3):
 * the hub snapshot is the newest canonical row of a campaign. Uploader
 * deletion ("Delete my BG3 data", D-18) cascades here.
 */

const tsz = (name: string) => timestamp(name, { withTimezone: true });
/** Where a save's `campaignKey` came from (`bg3-save/v1`). */
export type Bg3CampaignKeySourceRow = 'save-folder' | 'game-id';

/**
 * Save history. `campaign_id` NULL = unassigned (kept under the same
 * retention, Q-12). Retention collapses an old session to its last row and
 * stamps `session_first_saved_at` + `session_save_count` (D-9).
 */
export const bg3Saves = pgTable(
  'bg3_saves',
  {
    id: serial('id').primaryKey(),
    uploaderUserId: integer('uploader_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: integer('device_id').references(() => companionDevices.id, {
      onDelete: 'set null',
    }),
    campaignId: integer('campaign_id').references(() => bg3Campaigns.id, {
      onDelete: 'set null',
    }),
    campaignKey: char('campaign_key', { length: 64 }).notNull(),
    campaignKeySource: varchar('campaign_key_source', { length: 12 })
      .$type<Bg3CampaignKeySourceRow>()
      .notNull(),
    saveName: text('save_name').notNull(),
    savedAt: tsz('saved_at').notNull(),
    capturedAt: tsz('captured_at').notNull(),
    receivedAt: tsz('received_at').notNull().defaultNow(),
    gameVersion: varchar('game_version', { length: 40 }).notNull(),
    platform: varchar('platform', { length: 32 }).notNull(),
    currentLevel: varchar('current_level', { length: 64 }).notNull(),
    difficulty: varchar('difficulty', { length: 64 }).notNull(),
    ruleset: varchar('ruleset', { length: 64 }),
    /** Validated contract array; reads re-parse and skip a bad row. */
    party: jsonb('party').$type<Bg3PartyMember[]>().notNull(),
    partyMaxLevel: smallint('party_max_level').notNull(),
    thumbnailSha256: char('thumbnail_sha256', { length: 64 }),
    thumbnailWidth: integer('thumbnail_width'),
    thumbnailHeight: integer('thumbnail_height'),
    sessionFirstSavedAt: tsz('session_first_saved_at'),
    sessionSaveCount: integer('session_save_count'),
  },
  (t) => [
    // D-4 ingest belt (ON CONFLICT DO NOTHING); covers the uploader FK.
    uniqueIndex('bg3_saves_uploader_key_saved_at_uq').on(
      t.uploaderUserId,
      t.campaignKey,
      t.savedAt,
    ),
    // Snapshot + sessions reads; covers the campaign FK.
    index('bg3_saves_campaign_saved_at_idx').on(
      t.campaignId,
      t.savedAt.desc(),
      t.id.desc(),
    ),
    index('bg3_saves_device_id_idx').on(t.deviceId),
    // D-11 "does any remaining row of this user still use the sha?".
    index('bg3_saves_uploader_thumbnail_idx').on(
      t.uploaderUserId,
      t.thumbnailSha256,
    ),
    check('bg3_saves_key_chk', sql`${t.campaignKey} ~ '^[0-9a-f]{64}$'`),
    check(
      'bg3_saves_key_source_chk',
      sql`${t.campaignKeySource} IN ('save-folder', 'game-id')`,
    ),
    check(
      'bg3_saves_thumbnail_sha_chk',
      sql`${t.thumbnailSha256} IS NULL OR ${t.thumbnailSha256} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);
