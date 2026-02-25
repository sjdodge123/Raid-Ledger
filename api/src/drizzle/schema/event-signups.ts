import {
  pgTable,
  serial,
  integer,
  timestamp,
  text,
  unique,
  uuid,
  varchar,
  check,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
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
 * Signup status for tracking attendance intent.
 * - signed_up: User is attending
 * - tentative: User might attend
 * - declined: User won't attend
 */
export type SignupStatus = 'signed_up' | 'tentative' | 'declined';

/**
 * Event signups table for tracking user participation in events.
 * Implements FR-006 Native Sign-Up functionality, ROK-131 Character Confirmation,
 * and ROK-137 Anonymous Discord Participants.
 *
 * Supports both RL members (user_id set) and anonymous Discord participants
 * (discord_user_id set, user_id null). CHECK constraint ensures at least one identifier.
 */
export const eventSignups = pgTable(
  'event_signups',
  {
    id: serial('id').primaryKey(),
    eventId: integer('event_id')
      .references(() => events.id, { onDelete: 'cascade' })
      .notNull(),
    /** Nullable for anonymous Discord participants (ROK-137) */
    userId: integer('user_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    /** Discord user ID for anonymous participants (ROK-137) */
    discordUserId: varchar('discord_user_id', { length: 255 }),
    /** Discord username for anonymous participants (ROK-137) */
    discordUsername: varchar('discord_username', { length: 255 }),
    /** Discord avatar hash for anonymous participants (ROK-137) */
    discordAvatarHash: varchar('discord_avatar_hash', { length: 255 }),
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
    /**
     * Signup status for attendance intent (ROK-137).
     * - 'signed_up': attending
     * - 'tentative': might attend
     * - 'declined': won't attend
     */
    status: varchar('status', { length: 20 }).default('signed_up').notNull(),
    /**
     * Preferred roles for multi-role signup (ROK-452).
     * Stores an array of roles the player is willing to play (e.g., ['tank', 'dps']).
     * Used by auto-allocation to optimally assign players to roster slots.
     * Null or empty means no role preference expressed.
     */
    preferredRoles: text('preferred_roles').array(),
    /** Post-event attendance status recorded by organizer (ROK-421) */
    attendanceStatus: varchar('attendance_status', { length: 20 }),
    /** Timestamp when attendance was last recorded (ROK-421) */
    attendanceRecordedAt: timestamp('attendance_recorded_at'),
    signedUpAt: timestamp('signed_up_at').defaultNow().notNull(),
  },
  (table) => [
    // Ensure each RL user can only sign up once per event (AC-4)
    unique('unique_event_user').on(table.eventId, table.userId),
    // Ensure each anonymous Discord user can only sign up once per event
    unique('unique_event_discord_user').on(table.eventId, table.discordUserId),
    // Either user_id or discord_user_id must be set
    check(
      'user_or_discord',
      sql`${table.userId} IS NOT NULL OR ${table.discordUserId} IS NOT NULL`,
    ),
    // Performance indexes for common query patterns
    index('idx_event_signups_event_id').on(table.eventId),
    index('idx_event_signups_discord_user_id').on(table.discordUserId),
  ],
);
