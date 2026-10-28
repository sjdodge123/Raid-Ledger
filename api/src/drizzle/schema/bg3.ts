import {
  pgTable,
  serial,
  integer,
  smallint,
  varchar,
  char,
  text,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { Bg3PartyMember } from '@raid-ledger/contract';
import { users } from './users';
import { guilds } from './guilds';
import { companionDevices } from './companion-devices';

/**
 * ROK-1957 (C4) — the `bg3` plugin's storage. Spec §4 / D-3: there is no
 * snapshot table; the hub snapshot is the newest canonical `bg3_saves` row of
 * a campaign. Hub deletion cascades through `bg3_campaigns`; user deletion
 * ("Delete my BG3 data", D-18) cascades through every `user_id` FK.
 */

const tsz = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => tsz('created_at').notNull().defaultNow();
const updatedAt = () => tsz('updated_at').notNull().defaultNow();
const userSetNull = (name: string) =>
  integer(name).references(() => users.id, { onDelete: 'set null' });
const userCascade = (name: string) =>
  integer(name)
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });

/** Where a save's `campaignKey` came from (`bg3-save/v1`). */
export type Bg3CampaignKeySourceRow = 'save-folder' | 'game-id';

/** A BG3 campaign, owned by one `game_community` hub. */
export const bg3Campaigns = pgTable(
  'bg3_campaigns',
  {
    id: serial('id').primaryKey(),
    guildId: integer('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 64 }).notNull(),
    /** Canonical uploader on duplicate saves (D-7); creator by default. */
    hostUserId: userSetNull('host_user_id'),
    createdByUserId: userSetNull('created_by_user_id'),
    /** Soft archive (ROK-1958, spec Q-10); NULL = live. */
    archivedAt: tsz('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('bg3_campaigns_guild_id_idx').on(t.guildId),
    index('bg3_campaigns_host_user_id_idx').on(t.hostUserId),
    index('bg3_campaigns_created_by_user_id_idx').on(t.createdByUserId),
  ],
);

/** Per-hub BG3 settings (D-14 spoiler toggle + the active campaign). */
export const bg3HubSettings = pgTable(
  'bg3_hub_settings',
  {
    guildId: integer('guild_id')
      .primaryKey()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    hideLocationAndScreenshots: boolean('hide_location_and_screenshots')
      .notNull()
      .default(false),
    /** The app checks it belongs to the same hub. */
    activeCampaignId: integer('active_campaign_id').references(
      () => bg3Campaigns.id,
      { onDelete: 'set null' },
    ),
    updatedByUserId: userSetNull('updated_by_user_id'),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('bg3_hub_settings_active_campaign_id_idx').on(t.activeCampaignId),
    index('bg3_hub_settings_updated_by_user_id_idx').on(t.updatedByUserId),
  ],
);

/** Per-uploader binding of a `campaignKey` to a campaign (D-6). */
export const bg3CampaignKeys = pgTable(
  'bg3_campaign_keys',
  {
    userId: userCascade('user_id'),
    campaignKey: char('campaign_key', { length: 64 }).notNull(),
    campaignId: integer('campaign_id')
      .notNull()
      .references(() => bg3Campaigns.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    // Leads on user_id, so it also covers the users FK.
    primaryKey({ columns: [t.userId, t.campaignKey] }),
    index('bg3_campaign_keys_campaign_id_idx').on(t.campaignId),
    check(
      'bg3_campaign_keys_key_chk',
      sql`${t.campaignKey} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

/** One optional default campaign per uploader (D-6, Q-2). */
export const bg3UserDefaults = pgTable(
  'bg3_user_defaults',
  {
    userId: integer('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    campaignId: integer('campaign_id')
      .notNull()
      .references(() => bg3Campaigns.id, { onDelete: 'cascade' }),
    updatedAt: updatedAt(),
  },
  (t) => [index('bg3_user_defaults_campaign_id_idx').on(t.campaignId)],
);

/**
 * Save history. `campaign_id` NULL = unassigned (kept under the same
 * retention, Q-12). Retention collapses an old session to its last row and
 * stamps `session_first_saved_at` + `session_save_count` (D-9).
 */
export const bg3Saves = pgTable(
  'bg3_saves',
  {
    id: serial('id').primaryKey(),
    uploaderUserId: userCascade('uploader_user_id'),
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

/** "That's me" party claims (D-10): one slot per user per campaign. */
export const bg3PartyClaims = pgTable(
  'bg3_party_claims',
  {
    id: serial('id').primaryKey(),
    campaignId: integer('campaign_id')
      .notNull()
      .references(() => bg3Campaigns.id, { onDelete: 'cascade' }),
    slotKey: varchar('slot_key', { length: 160 }).notNull(),
    userId: userCascade('user_id'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('bg3_party_claims_campaign_slot_uq').on(
      t.campaignId,
      t.slotKey,
    ),
    uniqueIndex('bg3_party_claims_campaign_user_uq').on(t.campaignId, t.userId),
    index('bg3_party_claims_user_id_idx').on(t.userId),
  ],
);
