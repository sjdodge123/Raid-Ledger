import {
  pgTable,
  serial,
  integer,
  uuid,
  varchar,
  boolean,
  jsonb,
  timestamp,
  char,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { games } from './games';
import { users } from './users';
import { characters } from './characters';

/** One roster entry of a pull — the GUID plus the name the addon saw. */
export interface AddonPullRosterEntry {
  guid: string;
  name: string;
}

/**
 * ROK-1724: boss pulls reported by the WoW addon's `raid` export —
 * plugin-owned. Deduplicated across reporters on
 * (game, region, encounter, start time, guild key), so two raiders importing
 * the same night store each pull once.
 */
export const addonEncounterPulls = pgTable(
  'addon_encounter_pulls',
  {
    id: serial('id').primaryKey(),
    gameId: integer('game_id')
      .references(() => games.id, { onDelete: 'cascade' })
      .notNull(),
    region: varchar('region', { length: 10 }).notNull(),
    encounterId: integer('encounter_id').notNull(),
    encounterName: varchar('encounter_name', { length: 128 }).notNull(),
    difficultyId: integer('difficulty_id').notNull(),
    groupSize: integer('group_size').notNull(),
    instanceId: integer('instance_id'),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    success: boolean('success').notNull(),
    roster: jsonb('roster').$type<AddonPullRosterEntry[]>().notNull(),
    /** lower(who.guildName), or '' when the reporter is unguilded. */
    guildKey: varchar('guild_key', { length: 64 }).default('').notNull(),
    reportedByUserId: integer('reported_by_user_id').references(
      () => users.id,
      { onDelete: 'set null' },
    ),
    reportedByCharacterId: uuid('reported_by_character_id').references(
      () => characters.id,
      { onDelete: 'set null' },
    ),
    payloadSha256: char('payload_sha256', { length: 64 }).notNull(),
    importedAt: timestamp('imported_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    /** Cross-reporter dedupe key; also backs the game_id FK. */
    unique('uq_addon_encounter_pulls_dedupe').on(
      table.gameId,
      table.region,
      table.encounterId,
      table.startAt,
      table.guildKey,
    ),
    // ROK-1157: FK backing indexes (parent delete / RI scan)
    index('idx_addon_encounter_pulls_reported_by_user_id').on(
      table.reportedByUserId,
    ),
    index('idx_addon_encounter_pulls_reported_by_character_id').on(
      table.reportedByCharacterId,
    ),
  ],
);

export type AddonEncounterPullInsert = typeof addonEncounterPulls.$inferInsert;
export type AddonEncounterPullSelect = typeof addonEncounterPulls.$inferSelect;
