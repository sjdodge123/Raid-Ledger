import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  customType,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import type {
  ArchetypeDto,
  TasteProfileDimensionsDto,
  IntensityMetricsDto,
} from '@raid-ledger/contract';

/**
 * pgvector column type (ROK-948).
 *
 * Stored as `vector(N)` in Postgres and marshalled to/from the string
 * representation pgvector expects: `[0.1,0.2,...]`.
 */
export const pgvector = (name: string, dimensions: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${dimensions})`;
    },
    fromDriver(value: string) {
      if (!value) return [];
      return JSON.parse(value) as number[];
    },
    toDriver(value: number[]) {
      return `[${value.join(',')}]`;
    },
  })(name);

/**
 * Player Taste Vectors — per-user 7-axis preference vector plus derived
 * metrics and archetype (ROK-948). Computed by a daily cron from the
 * signal aggregation pipeline.
 */
export const playerTasteVectors = pgTable(
  'player_taste_vectors',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull()
      .unique(),
    vector: pgvector('vector', 7).notNull(),
    dimensions: jsonb('dimensions')
      .$type<TasteProfileDimensionsDto>()
      .notNull(),
    intensityMetrics: jsonb('intensity_metrics')
      .$type<IntensityMetricsDto>()
      .notNull(),
    archetype: jsonb('archetype').$type<ArchetypeDto | null>(),
    computedAt: timestamp('computed_at').defaultNow().notNull(),
    signalHash: text('signal_hash').notNull(),
  },
  (table) => ({
    computedAtIdx: index('player_taste_vectors_computed_at_idx').on(
      table.computedAt,
    ),
  }),
);
