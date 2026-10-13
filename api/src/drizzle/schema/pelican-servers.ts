import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { games } from './games';

/**
 * ROK-1772 (Pelican S3a): plugin-owned (Pelican). One row per game server the
 * Pelican subuser can see, upserted by `panel_uuid` on every server sync.
 *
 * SECURITY: no address, ip, port, node or allocation columns — a member-facing
 * surface must never be able to reach a host:port. `panel_uuid` and
 * `identifier` never leave the API; `id` is the opaque `serverKey`.
 * `pelican-tables.schema.spec.ts` pins the column set.
 */
export const pelicanServers = pgTable(
  'pelican_servers',
  {
    id: serial('id').primaryKey(),
    /** Upsert key. Never leaves the API. */
    panelUuid: text('panel_uuid').notNull().unique(),
    /** Pelican uuid_short. Never leaves the API. */
    identifier: text('identifier').notNull(),
    /** Truncated to 200 chars on write. */
    name: text('name').notNull(),
    /** Admin mapping — survives resyncs. */
    gameId: integer('game_id').references(() => games.id, {
      onDelete: 'set null',
    }),
    showOnCalendar: boolean('show_on_calendar').notNull().default(true),
    /** Per-server IANA tz override (validated at the API). */
    timezone: text('timezone'),
    /** Raw Pelican `stats.current_state`, ≤32 chars. */
    currentState: text('current_state'),
    isSuspended: boolean('is_suspended').notNull().default(false),
    statusCheckedAt: timestamp('status_checked_at', { withTimezone: true }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    /** First sync that did not list this server; NULL while listed. */
    missingSince: timestamp('missing_since', { withTimezone: true }),
  },
  (t) => [
    // Backs the games FK (fk-index-coverage.spec.ts).
    index('pelican_servers_game_id_idx').on(t.gameId),
  ],
);

export type PelicanServerRow = typeof pelicanServers.$inferSelect;
export type NewPelicanServer = typeof pelicanServers.$inferInsert;
