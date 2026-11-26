import type { CrosswalkIdProvenance } from '@raid-ledger/contract';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { hubGames } from './hub-games';
import { hubInstances } from './hub-instances';

/**
 * Every external id the hub knows, one table for all kinds (L4). `value` is
 * text: `String(id)` for ints, the lower-cased UUID for ITAD. `provenance`
 * only rises (D15, L5). `contributor_count` stays 1 in M1 (L10).
 */
export const hubGameIds = pgTable(
  'hub_game_ids',
  {
    kind: text('kind').notNull(),
    value: text('value').notNull(),
    rlGameId: text('rl_game_id')
      .notNull()
      .references(() => hubGames.rlGameId, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    provenance: text('provenance').$type<CrosswalkIdProvenance>(),
    firstContributorInstanceId: uuid(
      'first_contributor_instance_id',
    ).references(() => hubInstances.instanceId),
    contributorCount: integer('contributor_count').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'hub_game_ids_pkey', columns: [t.kind, t.value] }),
    index('hub_game_ids_rl_game_id_idx').on(t.rlGameId),
    check(
      'hub_game_ids_provenance_check',
      sql`${t.provenance} in ('steam', 'igdb', 'itad', 'wikidata', 'manual', 'unknown')`,
    ),
  ],
);

export type HubGameIdRow = typeof hubGameIds.$inferSelect;
