import {
  pgTable,
  serial,
  integer,
  smallint,
  text,
  varchar,
  boolean,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { guilds } from './guilds';
import { users } from './users';
import { events } from './events';

// ROK-1968: a hub's "Before next session" note, one row per guild.
// `updated_at` is the concurrency token; `clear_after_event_id` pins the
// event whose end clears the note (lazily) — deleting it drops the auto-clear.
export const hubSessionNotes = pgTable(
  'hub_session_notes',
  {
    guildId: integer('guild_id')
      .primaryKey()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    body: text('body').notNull().default(''),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedBy: integer('updated_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    clearAfterEventId: integer('clear_after_event_id').references(
      () => events.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      'hub_session_notes_body_length',
      sql`char_length(${table.body}) <= 4000`,
    ),
    // ROK-1157: FK backing indexes.
    index('idx_hub_session_notes_updated_by').on(table.updatedBy),
    index('idx_hub_session_notes_clear_after_event').on(
      table.clearAfterEventId,
    ),
  ],
);

// ROK-1968: the note's checklist (≤ 20 items, cap enforced by the service).
// `position` is not unique — the PUT rewrites positions in one transaction.
export const hubSessionNoteItems = pgTable(
  'hub_session_note_items',
  {
    id: serial('id').primaryKey(),
    guildId: integer('guild_id')
      .notNull()
      .references(() => hubSessionNotes.guildId, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    text: varchar('text', { length: 200 }).notNull(),
    done: boolean('done').notNull().default(false),
    doneBy: integer('done_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    doneAt: timestamp('done_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'hub_session_note_items_text_length',
      sql`char_length(${table.text}) BETWEEN 1 AND 200`,
    ),
    check(
      'hub_session_note_items_done_pair',
      sql`(${table.done} = false) = (${table.doneAt} IS NULL)`,
    ),
    index('idx_hub_session_note_items_guild_position').on(
      table.guildId,
      table.position,
    ),
    // ROK-1157: FK backing index.
    index('idx_hub_session_note_items_done_by').on(table.doneBy),
  ],
);

export type HubSessionNoteInsert = typeof hubSessionNotes.$inferInsert;
export type HubSessionNoteSelect = typeof hubSessionNotes.$inferSelect;
export type HubSessionNoteItemInsert = typeof hubSessionNoteItems.$inferInsert;
export type HubSessionNoteItemSelect = typeof hubSessionNoteItems.$inferSelect;
