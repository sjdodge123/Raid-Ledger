import {
  pgTable,
  serial,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { games } from './games';

/**
 * LFG player invites — "a player picked you off the suggestions list"
 * (ROK-1455 D3).
 *
 * One row is simultaneously the no-repeat record, a countable unit for the
 * per-recipient and per-group windows, and the decline record. Every limit is
 * a SQL count over this table, evaluated in the same transaction that inserts
 * the row, so the budgets are exact without Redis or fake timers.
 *
 * Deliberately NO unique constraint: no-repeat is a horizon
 * (`LFG_INVITE_NO_REPEAT_DAYS`), not uniqueness — a re-invite after the horizon
 * is legal, and a violation would poison the transaction (memory
 * `reference_postgres_savepoint_does_not_contain_violations`). The advisory
 * locks in `lfg-invite.constants.ts` are the concurrency guard.
 */
export const lfgInvites = pgTable(
  'lfg_invites',
  {
    id: serial('id').primaryKey(),
    recipientUserId: integer('recipient_user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** Who pressed Invite. */
    inviterUserId: integer('inviter_user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** The group IS the game — ROK-1451 has no group id. */
    gameId: integer('game_id')
      .references(() => games.id, { onDelete: 'cascade' })
      .notNull(),
    /** The window axis for both budgets. */
    sentAt: timestamp('sent_at').defaultNow().notNull(),
    /** Set by the DM decline button (D12); a full-horizon block. */
    declinedAt: timestamp('declined_at'),
  },
  (table) => [
    /** The per-recipient budget. */
    index('idx_lfg_invites_recipient_sent_at').on(
      table.recipientUserId,
      table.sentAt,
    ),
    /** The per-group cap. */
    index('idx_lfg_invites_game_sent_at').on(table.gameId, table.sentAt),
    /** The no-repeat read. */
    index('idx_lfg_invites_recipient_game_sent_at').on(
      table.recipientUserId,
      table.gameId,
      table.sentAt,
    ),
  ],
);
