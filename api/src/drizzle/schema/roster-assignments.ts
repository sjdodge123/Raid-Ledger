import {
    pgTable,
    serial,
    integer,
    varchar,
    timestamp,
    unique,
} from 'drizzle-orm/pg-core';
import { events } from './events';
import { eventSignups } from './event-signups';

/**
 * Role types for roster slots (WoW-centric, extensible to other games).
 */
export type RosterRole = 'tank' | 'healer' | 'dps' | 'flex';

/**
 * Roster assignments table for tracking user positions in event roster (ROK-114).
 * Maps signups to specific role slots for drag-and-drop roster builder.
 *
 * Design:
 * - Each signup can be assigned to one slot
 * - Slots are identified by role + position (e.g., "tank-1", "healer-2")
 * - Supports both role-constrained (WoW) and generic (other games) events
 */
export const rosterAssignments = pgTable(
    'roster_assignments',
    {
        id: serial('id').primaryKey(),
        /** Reference to the event */
        eventId: integer('event_id')
            .references(() => events.id, { onDelete: 'cascade' })
            .notNull(),
        /** Reference to the signup being assigned */
        signupId: integer('signup_id')
            .references(() => eventSignups.id, { onDelete: 'cascade' })
            .notNull(),
        /**
         * Role slot (tank, healer, dps, flex).
         * Null for non-role-based events.
         */
        role: varchar('role', { length: 20 }),
        /**
         * Position within the role (1-based index).
         * Combined with role forms the slot identifier (e.g., tank-1, healer-2).
         */
        position: integer('position').notNull().default(1),
        /**
         * Override flag - true if user's character role doesn't match slot role.
         * Used for off-spec assignments with confirmation.
         */
        isOverride: integer('is_override').notNull().default(0),
        createdAt: timestamp('created_at').defaultNow().notNull(),
        updatedAt: timestamp('updated_at').defaultNow().notNull(),
    },
    (table) => [
        // Each signup can only be assigned to one slot per event
        unique('unique_event_signup').on(table.eventId, table.signupId),
        // Each slot can only have one assignment (role + position must be unique per event)
        // Note: This constraint only applies when role is not null (handled in service)
    ],
);
