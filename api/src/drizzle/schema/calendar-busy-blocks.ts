import {
  pgTable,
  bigserial,
  integer,
  boolean,
  date,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';
import { calendarConnections } from './calendar-connections';

/**
 * ROK-1593 (epic ROK-669 §4.3): raw foreign busy instants read from a linked
 * calendar. PRIVACY (§6.4.2): no titles, locations, attendees or provider ids
 * — only when the user is busy. `calendar-busy-blocks.schema.spec.ts` pins the
 * column set so a text column cannot slip in. Rows are replaced per connection
 * inside the synced window in one transaction.
 */
export const calendarBusyBlocks = pgTable(
  'calendar_busy_blocks',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    connectionId: integer('connection_id')
      .notNull()
      .references(() => calendarConnections.id, { onDelete: 'cascade' }),
    /** Denormalised for the busy query. */
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    allDay: boolean('all_day').notNull().default(false),
    /** Inclusive local dates, set iff `all_day`. */
    firstDate: date('first_date'),
    lastDate: date('last_date'),
  },
  (t) => [
    // Leading user_id also backs the users FK (fk-index-coverage.spec.ts).
    index('calendar_busy_blocks_user_range_idx').on(
      t.userId,
      t.startsAt,
      t.endsAt,
    ),
    // Backs the calendar_connections FK.
    index('calendar_busy_blocks_connection_id_idx').on(t.connectionId),
    check('calendar_busy_blocks_range_chk', sql`${t.endsAt} > ${t.startsAt}`),
    check(
      'calendar_busy_blocks_all_day_dates_chk',
      sql`${t.allDay} = (${t.firstDate} IS NOT NULL AND ${t.lastDate} IS NOT NULL)`,
    ),
  ],
);
