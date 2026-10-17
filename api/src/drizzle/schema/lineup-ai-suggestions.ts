import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { communityLineups } from './community-lineups';
import type { AiSuggestionsResponseDto } from '@raid-ledger/contract';

/**
 * Per-lineup AI suggestion cache (ROK-931).
 *
 * `GET /lineups/:id/suggestions` looks up the freshest row for
 * (lineupId, voterSetHash); when none exists (or it's older than 24h)
 * the service runs the LLM, persists, and returns. Invalidated by
 * `AiSuggestionsCacheInvalidator.invalidateForLineup(lineupId)` after
 * nominate / un-nominate / invitee add / remove.
 *
 * `voterSetHash` is SHA1 of the sorted voter-ID list — so personalised
 * and group views coexist for the same lineup without overwriting.
 * `payload` stores the response DTO minus the `cached` flag (set at
 * read time based on row age).
 */
export const lineupAiSuggestions = pgTable(
  'lineup_ai_suggestions',
  {
    id: serial('id').primaryKey(),
    lineupId: integer('lineup_id')
      .references(() => communityLineups.id, { onDelete: 'cascade' })
      .notNull(),
    voterSetHash: text('voter_set_hash').notNull(),
    payload: jsonb('payload')
      .$type<Omit<AiSuggestionsResponseDto, 'cached'>>()
      .notNull(),
    model: text('model').notNull(),
    provider: text('provider').notNull(),
    generatedAt: timestamp('generated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('uq_lineup_ai_suggestion_voter_set').on(
      table.lineupId,
      table.voterSetHash,
    ),
    index('lineup_ai_suggestions_lineup_generated_at_idx').on(
      table.lineupId,
      table.generatedAt,
    ),
  ],
);
