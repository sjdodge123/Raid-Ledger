import {
  pgTable,
  uuid,
  integer,
  varchar,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { events } from './events';
import { users } from './users';

/**
 * PUG (Pick Up Group) slots for filling roster gaps with external players (ROK-262).
 * Each PUG slot represents a guest player identified by Discord username,
 * assigned to a role (tank/healer/dps) for a specific event.
 *
 * Status lifecycle:
 * - pending: Created by organizer, not yet contacted via Discord bot
 * - invited: Discord bot sent a DM invite (Phase B)
 * - accepted: PUG accepted the invite via Discord (Phase B)
 * - claimed: PUG linked to a Raid Ledger account (Phase B)
 */
export const pugSlots = pgTable(
  'pug_slots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** Reference to the event — INTEGER FK matching events.id */
    eventId: integer('event_id')
      .references(() => events.id, { onDelete: 'cascade' })
      .notNull(),
    /** Discord username of the PUG player (nullable for anonymous invite links) */
    discordUsername: varchar('discord_username', { length: 100 }),
    /** Discord user ID (populated by bot in Phase B) */
    discordUserId: varchar('discord_user_id', { length: 50 }),
    /** Discord avatar hash (populated by bot in Phase B) */
    discordAvatarHash: varchar('discord_avatar_hash', { length: 100 }),
    /** Role assignment: tank, healer, dps, or player (generic rosters) */
    role: varchar('role', { length: 20 }).notNull(),
    /** Optional character class (e.g., Warrior, Paladin) */
    class: varchar('class', { length: 50 }),
    /** Optional character spec (e.g., Protection, Holy) */
    spec: varchar('spec', { length: 50 }),
    /** Optional notes about this PUG */
    notes: text('notes'),
    /** Status of the PUG invitation */
    status: varchar('status', { length: 20 }).default('pending').notNull(),
    /** Server invite URL (populated by bot in Phase B) */
    serverInviteUrl: varchar('server_invite_url', { length: 500 }),
    /** Magic invite link code — 8-char alphanumeric (ROK-263) */
    inviteCode: varchar('invite_code', { length: 8 }),
    /** When the Discord bot sent the invite (Phase B) */
    invitedAt: timestamp('invited_at'),
    /** User ID if PUG claimed a Raid Ledger account (Phase B) */
    claimedByUserId: integer('claimed_by_user_id').references(() => users.id),
    /** User who created this PUG slot (event creator/officer) */
    createdBy: integer('created_by')
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    // Named PUG slots: each Discord username can only be a PUG once per event
    // Anonymous slots (discordUsername IS NULL) are allowed multiple times
    uniqueIndex('unique_event_pug')
      .on(table.eventId, table.discordUsername)
      .where(sql`${table.discordUsername} IS NOT NULL`),
    // Each invite code must be globally unique
    uniqueIndex('unique_invite_code')
      .on(table.inviteCode)
      .where(sql`${table.inviteCode} IS NOT NULL`),
  ],
);
