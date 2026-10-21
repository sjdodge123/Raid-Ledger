/**
 * ROK-1428 (Codex r14 follow-up) — auto-link eligibility matches the embed
 * hub-link rule: an `active`, non-hidden hub of a {@link HUB_LINK_KINDS} kind.
 * An archived hub keeps `hidden_at` null but 404s for non-staff, so it must
 * never be auto-linked to a new game channel.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import { SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import {
  linkHubsForGame,
  selectHubNeedsLinkGameIds,
} from './hub-channel-link.queries';

function asDb(mock: MockDb): PostgresJsDatabase<typeof schema> {
  return mock as unknown as PostgresJsDatabase<typeof schema>;
}

/** Render the first WHERE clause handed to drizzle, with its params. */
function firstWhere(mock: MockDb): { sql: string; params: unknown[] } {
  const arg: unknown = mock.where.mock.calls[0]?.[0];
  if (!(arg instanceof SQL)) throw new Error('where() got no SQL');
  return new PgDialect().sqlToQuery(arg);
}

/** The bound value of `"guilds"."status" = $N`, or undefined if absent. */
function statusParam(q: { sql: string; params: unknown[] }): unknown {
  const m = /"guilds"\."status" = \$(\d+)/.exec(q.sql);
  if (!m?.[1]) return undefined;
  return q.params[Number(m[1]) - 1];
}

describe('hub auto-link eligibility (Codex r14 follow-up)', () => {
  let mock: MockDb;
  beforeEach(() => {
    mock = createDrizzleMock();
  });

  it('linkHubsForGame: only active, non-hidden hubs are linkable — archived are not', async () => {
    mock.where.mockResolvedValueOnce([]);
    await expect(linkHubsForGame(asDb(mock), 7, 'chan-1')).resolves.toBe(0);
    const q = firstWhere(mock);
    expect(q.sql).toContain('"guilds"."hidden_at" is null');
    expect(statusParam(q)).toBe('active');
  });

  it('selectHubNeedsLinkGameIds: the needs-link seam uses the same active-only rule', async () => {
    mock.where.mockResolvedValueOnce([{ gameId: 3 }]);
    await expect(selectHubNeedsLinkGameIds(asDb(mock))).resolves.toEqual(
      new Set([3]),
    );
    const q = firstWhere(mock);
    expect(q.sql).toContain('"guilds"."hidden_at" is null');
    expect(statusParam(q)).toBe('active');
  });
});
