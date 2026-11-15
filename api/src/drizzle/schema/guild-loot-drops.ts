import {
  pgTable,
  serial,
  integer,
  uuid,
  varchar,
  timestamp,
  char,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { games } from './games';
import { users } from './users';
import { characters } from './characters';

/**
 * ROK-2184: loot history reported by the WoW addon's LedgerLink v2 `loot`
 * section — plugin-owned (wow-common addon import). History only: who got
 * which item, when, from which boss when the addon could attribute it. No
 * DKP, points or rolls (ROK-1790 ruling 5).
 *
 * Every exporter re-sends its rolling 30-day window, so the same drop arrives
 * many times from many raiders. De-duplicated on ruling Q5's key (scoped per
 * game + region like `addon_encounter_pulls`): guild key, looter key
 * (`looterGuid ?? looterName`), item, quantity, `at` bucketed to 120 s
 * (`at_bucket`), instance — one plain unique index, `ON CONFLICT DO NOTHING`.
 * `NULLS NOT DISTINCT` so a drop with no `instanceId` still de-duplicates.
 */
export const guildLootDrops = pgTable(
  'guild_loot_drops',
  {
    id: serial('id').primaryKey(),
    gameId: integer('game_id')
      .references(() => games.id, { onDelete: 'cascade' })
      .notNull(),
    region: varchar('region', { length: 10 }).notNull(),
    /** lower(who.guildName), or '' when the exporter is unguilded. */
    guildKey: varchar('guild_key', { length: 64 }).default('').notNull(),
    /** Dedup identity of the looter: the GUID when sent, else the name. */
    looterKey: varchar('looter_key', { length: 100 }).notNull(),
    looterName: varchar('looter_name', { length: 100 }).notNull(),
    looterGuid: varchar('looter_guid', { length: 32 }),
    itemId: integer('item_id').notNull(),
    quantity: integer('quantity').notNull(),
    quality: integer('quality'),
    /** Item link as received: WoW escapes kept, control characters stripped by the decoder. */
    link: varchar('link', { length: 512 }),
    /** master | roll | direct | unknown. */
    method: varchar('method', { length: 10 }).notNull(),
    instanceId: integer('instance_id'),
    difficultyId: integer('difficulty_id'),
    encounterId: integer('encounter_id'),
    encounterName: varchar('encounter_name', { length: 128 }),
    /** The drop's `at` (addon `GetServerTime()`). */
    droppedAt: timestamp('dropped_at', { withTimezone: true }).notNull(),
    /** floor(at / ADDON_LOOT_DEDUP_BUCKET_SECONDS) — part of the dedup key. */
    atBucket: integer('at_bucket').notNull(),
    reportedByUserId: integer('reported_by_user_id').references(
      () => users.id,
      { onDelete: 'set null' },
    ),
    reportedByCharacterId: uuid('reported_by_character_id').references(
      () => characters.id,
      { onDelete: 'set null' },
    ),
    /** `DecodedAddonImport.sha256` of the paste that first stored the drop. */
    payloadSha256: char('payload_sha256', { length: 64 }).notNull(),
    importedAt: timestamp('imported_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    /** Ruling Q5 cross-exporter dedupe key; also backs the game_id FK. */
    unique('uq_guild_loot_drops_dedupe')
      .on(
        table.gameId,
        table.region,
        table.guildKey,
        table.looterKey,
        table.itemId,
        table.quantity,
        table.atBucket,
        table.instanceId,
      )
      .nullsNotDistinct(),
    /** A guild's drops by time (the later Loot tab). */
    index('idx_guild_loot_drops_guild_dropped_at').on(
      table.gameId,
      table.region,
      table.guildKey,
      table.droppedAt,
    ),
    // ROK-1157: FK backing indexes (parent delete / RI scan)
    index('idx_guild_loot_drops_reported_by_user_id').on(
      table.reportedByUserId,
    ),
    index('idx_guild_loot_drops_reported_by_character_id').on(
      table.reportedByCharacterId,
    ),
  ],
);

export type GuildLootDropInsert = typeof guildLootDrops.$inferInsert;
export type GuildLootDropSelect = typeof guildLootDrops.$inferSelect;
