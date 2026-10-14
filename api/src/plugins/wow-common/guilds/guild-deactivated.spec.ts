/**
 * ROK-1785 — deactivated users (`users.deactivated_at`) are not members and
 * their characters never link on the roster. Unit tier: the SQL each query
 * hands drizzle carries the deactivation filter. Behaviour against a real DB:
 * `guild-access.integration.spec.ts` + `guilds.controller.integration.spec.ts`.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  createDrizzleMock,
  type MockDb,
} from '../../../common/testing/drizzle-mock';
import { findLinkedMemberRows } from './guild-membership.helpers';
import { loadRosterRows } from './guild-roster.helpers';

const dialect = new PgDialect();
const render = (s: unknown): string => dialect.sqlToQuery(s as SQL).sql;

let db: MockDb;
beforeEach(() => {
  db = createDrizzleMock();
});

describe('deactivated users', () => {
  it('membership requires users.deactivated_at IS NULL', async () => {
    db.where.mockResolvedValueOnce([]);
    await findLinkedMemberRows(db as never, 42, 7);
    const where = render(db.where.mock.calls[0]?.[0]);
    expect(where).toContain('"users"."deactivated_at" is null');
  });

  it("the roster's character link requires an active owner", async () => {
    db.orderBy.mockResolvedValueOnce([]);
    await loadRosterRows(db as never, 7);
    const join = render(db.leftJoin.mock.calls[0]?.[1]);
    expect(join).toContain('"users"."deactivated_at" is null');
    expect(join).toContain('"characters"."user_id"');
  });
});
