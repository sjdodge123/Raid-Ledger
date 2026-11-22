/** ROK-2292 — forum starter vs announcement row discrimination. */
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  announcementRowsOnly,
  forumStarterRowsOnly,
  isForumStarterRow,
} from './event-message-rows.helpers';

const dialect = new PgDialect();
const CH = '"discord_event_messages"."channel_id"';
const MSG = '"discord_event_messages"."message_id"';

describe('isForumStarterRow (ROK-2292)', () => {
  it('is true when the message id equals the channel (thread) id', () => {
    expect(isForumStarterRow({ channelId: '900', messageId: '900' })).toBe(
      true,
    );
  });

  it('is false for an announcement message in a text channel', () => {
    expect(isForumStarterRow({ channelId: '900', messageId: '901' })).toBe(
      false,
    );
  });
});

describe('row predicates (ROK-2292)', () => {
  it('announcementRowsOnly compares channel_id <> message_id', () => {
    expect(dialect.sqlToQuery(announcementRowsOnly()).sql).toBe(
      `${CH} <> ${MSG}`,
    );
  });

  it('forumStarterRowsOnly compares channel_id = message_id', () => {
    expect(dialect.sqlToQuery(forumStarterRowsOnly()).sql).toBe(
      `${CH} = ${MSG}`,
    );
  });
});
