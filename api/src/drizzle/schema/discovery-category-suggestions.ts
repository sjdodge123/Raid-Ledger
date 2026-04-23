import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';
import { pgvector } from './player-taste-vectors';

/**
 * Discovery Category Suggestions — LLM-generated dynamic discover rows
 * pending admin review (ROK-567).
 *
 * The `themeVector` column is a pgvector(7) in the locked axis order
 * `[co_op, pvp, rpg, survival, strategy, social, mmo]` so cosine-distance
 * queries against `game_taste_vectors.vector` are meaningful.
 *
 * CHECK constraints on `status`, `categoryType`, and `populationStrategy`
 * live in the migration SQL (drizzle-kit cannot emit CHECKs cleanly).
 */
export const discoveryCategorySuggestions = pgTable(
  'discovery_category_suggestions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 120 }).notNull(),
    description: text('description').notNull(),
    /** CHECK in SQL: ('seasonal','trend','community_pattern','event') */
    categoryType: text('category_type').notNull(),
    themeVector: pgvector('theme_vector', 7).notNull(),
    filterCriteria: jsonb('filter_criteria')
      .notNull()
      .default(sql`'{}'::jsonb`),
    candidateGameIds: jsonb('candidate_game_ids')
      .$type<number[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** CHECK in SQL: ('pending','approved','rejected','expired') */
    status: text('status').notNull(),
    /** CHECK in SQL: ('vector','fixed','hybrid') */
    populationStrategy: text('population_strategy').notNull(),
    sortOrder: integer('sort_order').notNull().default(1000),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    generatedAt: timestamp('generated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    reviewedBy: integer('reviewed_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('discovery_category_status_idx').on(table.status),
    index('discovery_category_sort_idx')
      .on(table.status, table.sortOrder)
      .where(sql`${table.status} = 'approved'`),
  ],
);
