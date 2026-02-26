import {
  pgTable,
  serial,
  text,
  timestamp,
  customType,
  integer,
  uuid,
  jsonb,
  boolean,
  varchar,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { games } from './games';
import { channelBindings } from './channel-bindings';

// Define custom tsrange type
export const tsrange = customType<{
  data: [Date, Date];
  driverData: string;
}>({
  dataType() {
    return 'tsrange';
  },
  // Parsing from DB driver (string "[2026-01-01 10:00:00, 2026-01-01 11:00:00)") to JS Date tuple
  fromDriver(value: string) {
    if (!value || value === 'empty') return [new Date(0), new Date(0)];
    // Basic parsing logic for Postgres range syntax
    const matches = value.match(/[[(]([^,]+),([^,]+)[)\]]/);
    if (!matches) return [new Date(0), new Date(0)];
    // tsrange stores timestamps without timezone — toDriver sends UTC via toISOString(),
    // so we must interpret them as UTC on read (append Z) to avoid local-timezone drift.
    const raw1 = matches[1].replace(/"/g, '').trim();
    const raw2 = matches[2].replace(/"/g, '').trim();
    return [
      new Date(raw1.endsWith('Z') ? raw1 : raw1 + 'Z'),
      new Date(raw2.endsWith('Z') ? raw2 : raw2 + 'Z'),
    ];
  },
  // Formatting JS Date tuple to DB driver string
  toDriver(value: [Date, Date]) {
    return `[${value[0].toISOString()},${value[1].toISOString()})`;
  },
});

export const events = pgTable(
  'events',
  {
    id: serial('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description'),
    /** ROK-400: Single FK to games.id (integer). Replaces legacy gameId (text) + registryGameId (uuid). */
    gameId: integer('game_id').references(() => games.id),
    creatorId: integer('creator_id')
      .references(() => users.id)
      .notNull(),
    // Utilizing tsrange for efficient scheduling and overlap checks
    duration: tsrange('duration').notNull(),
    /** Per-event slot configuration override (jsonb). Falls back to genre-based detection if null. */
    slotConfig: jsonb('slot_config'),
    /** Maximum number of attendees. Null = unlimited. */
    maxAttendees: integer('max_attendees'),
    /** Whether benched players should be auto-promoted when a slot opens. Default true. */
    autoUnbench: boolean('auto_unbench').default(true),
    /** UUID linking recurring event instances together. Null for one-off events. */
    recurrenceGroupId: uuid('recurrence_group_id'),
    /** Stored recurrence rule (jsonb). E.g. { frequency: 'weekly', until: '...' } */
    recurrenceRule: jsonb('recurrence_rule'),
    /** Selected content instances from Blizzard API (e.g., specific dungeons/raids) */
    contentInstances: jsonb('content_instances'),
    /** Send DM reminder 15 minutes before event. Default true (ROK-126). */
    reminder15min: boolean('reminder_15min').default(true).notNull(),
    /** Send DM reminder 1 hour before event. Default true (ROK-126, ROK-489). */
    reminder1hour: boolean('reminder_1hour').default(true).notNull(),
    /** Send DM reminder 24 hours before event. Default true (ROK-126, ROK-489). */
    reminder24hour: boolean('reminder_24hour').default(true).notNull(),
    /** ROK-293: Whether this event was auto-created from voice channel activity */
    isAdHoc: boolean('is_ad_hoc').default(false).notNull(),
    /** ROK-293: Ad-hoc event lifecycle status. Null for scheduled events. */
    adHocStatus: varchar('ad_hoc_status', { length: 20 }),
    /** ROK-293: Channel binding that spawned this ad-hoc event */
    channelBindingId: uuid('channel_binding_id').references(
      () => channelBindings.id,
      { onDelete: 'set null' },
    ),
    /** Soft-cancel timestamp. Non-null means the event is cancelled (ROK-374). */
    cancelledAt: timestamp('cancelled_at'),
    /** Optional reason provided when the event was cancelled (ROK-374). */
    cancellationReason: text('cancellation_reason'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    // Performance indexes for common query patterns
    index('idx_events_creator_id').on(table.creatorId),
    index('idx_events_game_id').on(table.gameId),
    // ROK-293: Supports ad-hoc event lookup by binding + status
    index('idx_events_ad_hoc_binding').on(table.channelBindingId, table.isAdHoc),
  ],
);
