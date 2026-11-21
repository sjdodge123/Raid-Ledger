import {
  pgTable,
  integer,
  varchar,
  jsonb,
  timestamp,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { hubForumThreads } from './hub-forum';

/** The character a signup is on, as far as a line goes. */
export interface SignupLineCharacter {
  name: string;
  className: string | null;
  spec: string | null;
}

/**
 * A member's line-relevant signup state. JSON-safe (no Date) so the caller
 * can store the last POSTED one as-is (e.g. a Redis hash field).
 */
export interface SignupLineState {
  /** `event_signups.status`; `'gone'` when the row no longer exists. */
  status: string;
  /** Roster slot role (tank/healer/dps/flex); null when unassigned/benched. */
  role: string | null;
  bench: boolean;
  character: SignupLineCharacter | null;
  late: boolean;
  lateMinutes: number | null;
  /** Hours between the roach-out and the event start; null if not roached. */
  roachedHoursBefore: number | null;
}

/** A state row: the state last written as a line, and the name it used. */
export interface WrittenLineState extends SignupLineState {
  name: string;
}

/**
 * ROK-2274: the signup state last written as a line into a Raid Ledger event
 * thread, one row per member per thread. Independent of the Discord binding
 * (unbound hubs get lines too) and written in the same transaction as the
 * line rows. `member_key` is `u:<userId>` for an account, `d:<discordId>` for
 * a Discord guest. First sight of a thread seeds these rows without lines
 * (plus a `#seeded` marker row). `state` keeps the name the line used too.
 */
export const hubForumSignupLineStates = pgTable(
  'hub_forum_signup_line_states',
  {
    threadId: integer('thread_id')
      .notNull()
      .references(() => hubForumThreads.id, { onDelete: 'cascade' }),
    memberKey: varchar('member_key', { length: 40 }).notNull(),
    state: jsonb('state').$type<WrittenLineState>().notNull(),
    writtenAt: timestamp('written_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.threadId, table.memberKey] })],
);

export type HubForumSignupLineStateSelect =
  typeof hubForumSignupLineStates.$inferSelect;
export type HubForumSignupLineStateInsert =
  typeof hubForumSignupLineStates.$inferInsert;
