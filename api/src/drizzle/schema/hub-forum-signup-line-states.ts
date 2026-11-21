import {
  pgTable,
  integer,
  varchar,
  jsonb,
  timestamp,
  primaryKey,
} from 'drizzle-orm/pg-core';
import type { SignupLineState } from '../../guilds/forum/discord/hub-forum-discord-signup-lines';
import { hubForumThreads } from './hub-forum';

/**
 * ROK-2274: the signup state last written as a line into a Raid Ledger event
 * thread, one row per member per thread. Independent of the Discord binding
 * (unbound hubs get lines too) and written in the same transaction as the
 * line rows. `member_key` is `u:<userId>` for an account, `d:<discordId>` for
 * a Discord guest. First sight of a thread seeds these rows without lines.
 */
export const hubForumSignupLineStates = pgTable(
  'hub_forum_signup_line_states',
  {
    threadId: integer('thread_id')
      .notNull()
      .references(() => hubForumThreads.id, { onDelete: 'cascade' }),
    memberKey: varchar('member_key', { length: 40 }).notNull(),
    state: jsonb('state').$type<SignupLineState>().notNull(),
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
