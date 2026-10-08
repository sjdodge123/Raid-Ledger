import {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  boolean,
  jsonb,
  timestamp,
  index,
  unique,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';

/**
 * ROK-1591 (epic ROK-669): calendar sync foundation.
 *
 * One row per linked external calendar account (Google / Microsoft / Apple).
 * `credentials_encrypted` holds `encrypt(JSON.stringify(CalendarCredentials))`
 * — never plaintext tokens. Every instant is timestamptz (TDB:1980: zone-less
 * timestamps are parsed in the host's zone by raw `db.execute` reads).
 *
 * `read_enabled` defaults false: write ships first, and a connection made under
 * write-only scopes must not start reading when the read path deploys
 * (ROK-1593 sets it true when the read scopes are granted). Busy blocks,
 * ignored days and the `game_time_absences` source columns are ROK-1593's own
 * migration.
 */
export const calendarConnections = pgTable(
  'calendar_connections',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 16 }).notNull(),
    /** Google `sub` / Microsoft `oid` / Apple email lowercased. */
    accountSubject: varchar('account_subject', { length: 255 }).notNull(),
    /** Display email — stored + shown, deleted on disconnect. */
    accountLabel: varchar('account_label', { length: 255 }),
    credentialsEncrypted: text('credentials_encrypted').notNull(),
    status: varchar('status', { length: 24 }).notNull().default('active'),
    lastErrorCode: varchar('last_error_code', { length: 64 }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    nextSyncAt: timestamp('next_sync_at', { withTimezone: true }),
    syncCursor: jsonb('sync_cursor'),
    readEnabled: boolean('read_enabled').notNull().default(false),
    readCalendarIds: text('read_calendar_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    writeEnabled: boolean('write_enabled').notNull().default(false),
    writeTarget: varchar('write_target', { length: 16 })
      .notNull()
      .default('dedicated'),
    dedicatedCalendarId: text('dedicated_calendar_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // Leading user_id also backs the users FK (fk-index-coverage.spec.ts).
    unique('calendar_connections_user_provider_subject_uq').on(
      t.userId,
      t.provider,
      t.accountSubject,
    ),
    index('calendar_connections_next_sync_idx')
      .on(t.nextSyncAt)
      .where(sql`${t.status} = 'active' AND ${t.readEnabled}`),
    check(
      'calendar_connections_provider_chk',
      sql`${t.provider} IN ('google','microsoft','apple')`,
    ),
    check(
      'calendar_connections_status_chk',
      sql`${t.status} IN ('active','needs_reconnect','error','disconnecting')`,
    ),
    check(
      'calendar_connections_write_target_chk',
      sql`${t.writeTarget} IN ('dedicated','primary')`,
    ),
  ],
);

/**
 * ROK-1591: one row per (connection, event, user) RL event mirrored into an
 * external calendar. `event_id` deliberately has NO FK — the link must outlive
 * the event until the delete job removes the provider-side copy.
 */
export const calendarEventLinks = pgTable(
  'calendar_event_links',
  {
    id: serial('id').primaryKey(),
    connectionId: integer('connection_id')
      .notNull()
      .references(() => calendarConnections.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventId: integer('event_id').notNull(),
    calendarId: text('calendar_id').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    etag: text('etag'),
    state: varchar('state', { length: 16 }).notNull().default('synced'),
    lastErrorCode: varchar('last_error_code', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // Leading connection_id also backs the calendar_connections FK.
    unique('calendar_event_links_conn_event_user_uq').on(
      t.connectionId,
      t.eventId,
      t.userId,
    ),
    index('calendar_event_links_event_id_idx').on(t.eventId),
    // Backs the users FK (fk-index-coverage.spec.ts).
    index('calendar_event_links_user_id_idx').on(t.userId),
    check(
      'calendar_event_links_state_chk',
      sql`${t.state} IN ('synced','failed','suppressed')`,
    ),
  ],
);
