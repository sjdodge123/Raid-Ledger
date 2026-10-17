import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  real,
  index,
} from 'drizzle-orm/pg-core';
import { games } from './games';
import { pgvector } from './player-taste-vectors';
import type { TasteProfileDimensionsDto } from '@raid-ledger/contract';

/**
 * Game Taste Vectors — per-game 7-axis taste vector plus confidence
 * (ROK-1082). Computed by a daily cron from the signal aggregation pipeline.
 */
export const gameTasteVectors = pgTable(
  'game_taste_vectors',
  {
    id: serial('id').primaryKey(),
    gameId: integer('game_id')
      .references(() => games.id, { onDelete: 'cascade' })
      .notNull()
      .unique(),
    vector: pgvector('vector', 7).notNull(),
    dimensions: jsonb('dimensions')
      .$type<TasteProfileDimensionsDto>()
      .notNull(),
    confidence: real('confidence').notNull().default(0),
    computedAt: timestamp('computed_at').defaultNow().notNull(),
    signalHash: text('signal_hash').notNull(),
  },
  (table) => ({
    computedAtIdx: index('game_taste_vectors_computed_at_idx').on(
      table.computedAt,
    ),
  }),
);
