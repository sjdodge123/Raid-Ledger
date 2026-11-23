/**
 * ROK-2292 Codex P2 — `findEligibleEvents` joins announcement rows only. A
 * forum starter row (`channel_id = message_id`) selected first would consume
 * the per-event bump dedup key with the starter's channel, and the
 * announcement-only bump writer would then never persist the bump id. Row
 * behaviour against real data: `recruitment-reminder.helpers.integration.spec.ts`.
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import { findEligibleEvents } from './recruitment-reminder.helpers';

describe('ROK-2292 findEligibleEvents — announcement rows only', () => {
  it('excludes forum starter rows from the discord_event_messages join', async () => {
    const execute = jest.fn().mockResolvedValue([]);
    const db = { execute } as unknown as PostgresJsDatabase<typeof schema>;
    await findEligibleEvents(db);
    const query = execute.mock.calls[0]?.[0] as SQL;
    const { sql } = new PgDialect().sqlToQuery(query);
    expect(sql).toMatch(
      /INNER JOIN discord_event_messages dem ON dem\.event_id = e\.id AND dem\.channel_id <> dem\.message_id/,
    );
  });
});
