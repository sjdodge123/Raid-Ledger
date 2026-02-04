import {
  pgTable,
  serial,
  integer,
  timestamp,
  text,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { events } from './events';
import { characters } from './characters';

/**
 * Confirmation status for event signups.
 * - pending: User signed up but hasn't confirmed character
 * - confirmed: User confirmed which character they're bringing
 * - changed: User changed their character selection after initial confirmation
 */
export type ConfirmationStatus = 'pending' | 'confirmed' | 'changed';

/**
 * Event signups table for tracking user participation in events.
 * Implements FR-006 Native Sign-Up functionality and ROK-131 Character Confirmation.
 */
export const eventSignups = pgTable(
  'event_signups',
  {
    id: serial('id').primaryKey(),
    eventId: integer('event_id')
      .references(() => events.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** Optional signup note/message */
    note: text('note'),
    /**
     * Character the user is bringing to the event (ROK-131 AC-1).
     * Nullable - not all events require character confirmation.
     */
    characterId: uuid('character_id').references(() => characters.id, {
      onDelete: 'set null',
    }),
    /**
     * Character confirmation status (ROK-131 AC-1).
     * - 'pending': signed up but character not confirmed
     * - 'confirmed': character confirmed for the event
     * - 'changed': user changed selection after initial confirmation
     */
    confirmationStatus: varchar('confirmation_status', { length: 20 })
      .default('pending')
      .notNull(),
    signedUpAt: timestamp('signed_up_at').defaultNow().notNull(),
  },
  (table) => [
    // Ensure each user can only sign up once per event (AC-4)
    unique('unique_event_user').on(table.eventId, table.userId),
  ],
);
