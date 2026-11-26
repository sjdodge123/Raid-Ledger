import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgSequence,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/** M2 delta cursor (L6): every id change to a game takes the next value. */
export const hubGamesUpdatedSeq = pgSequence('hub_games_updated_seq');

/** Where a hub game's `display_name` came from (ROK-1673). */
export const HUB_GAME_NAME_SOURCES = [
  'instance',
  'rl_seed',
  'wikidata',
  'hub_admin',
] as const;

export type HubGameNameSource = (typeof HUB_GAME_NAME_SOURCES)[number];

/**
 * One row per hub game, keyed by a hub-minted ULID. `display_name` from an
 * instance is match-only, never served (D6).
 */
export const hubGames = pgTable(
  'hub_games',
  {
    rlGameId: text('rl_game_id').primaryKey(),
    displayName: text('display_name').notNull(),
    nameSource: text('name_source').$type<HubGameNameSource>().notNull(),
    normalizedName: text('normalized_name').notNull(),
    updatedSeq: bigint('updated_seq', { mode: 'number' })
      .notNull()
      .default(sql`nextval('hub_games_updated_seq')`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      'hub_games_name_source_check',
      sql`${t.nameSource} in ('instance', 'rl_seed', 'wikidata', 'hub_admin')`,
    ),
    index('hub_games_normalized_name_idx').on(t.normalizedName),
    index('hub_games_updated_seq_idx').on(t.updatedSeq),
  ],
);

export type HubGameRow = typeof hubGames.$inferSelect;
