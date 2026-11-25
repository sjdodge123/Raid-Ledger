import { sql } from 'drizzle-orm';
import {
  bigserial,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { hubInstances } from './hub-instances';

/** L12: only the conflicting id, never the full item (no name text). */
export interface HubConflictPayload {
  readonly clientRef: string;
  readonly kind: string;
  readonly value: string;
  readonly provenance: string | null;
}

/**
 * A contributed id the hub could not apply because another game owns it.
 * De-duplicated on open rows (L7); `resolved_at` is never set in M1.
 */
export const hubCrosswalkConflicts = pgTable(
  'hub_crosswalk_conflicts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    kind: text('kind').notNull(),
    value: text('value').notNull(),
    existingRlGameId: text('existing_rl_game_id').notNull(),
    proposedRlGameId: text('proposed_rl_game_id'),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => hubInstances.instanceId),
    payload: jsonb('payload').$type<HubConflictPayload>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    index('hub_crosswalk_conflicts_open_idx')
      .on(t.kind, t.value)
      .where(sql`${t.resolvedAt} is null`),
  ],
);

export type HubCrosswalkConflictRow = typeof hubCrosswalkConflicts.$inferSelect;
