/**
 * ROK-1870 M2 — the ban upsert must never hand postgres.js a raw `Date` as a
 * bind parameter (it throws "The "string" argument must be of type string…
 * Received an instance of Date"); timestamps go through column typing.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { banUpsert } from './community-membership.queries';

const db = drizzle.mock({ schema });
const now = new Date('2026-10-20T12:00:00.000Z');
const input = { guildId: 7, userId: 9, bannedBy: 2, reason: 'spam' };

describe('banUpsert', () => {
  it('binds no raw Date parameter', () => {
    const { params } = banUpsert(db, input, now).toSQL();
    expect(params.some((p) => p instanceof Date)).toBe(false);
    expect(params).toContain(now.toISOString());
  });

  it('keeps an existing left_at and otherwise takes the inserted one', () => {
    const { sql } = banUpsert(db, input, now).toSQL();
    expect(sql).toMatch(
      /"left_at" = COALESCE\("hub_community_members"\."left_at", excluded\.left_at\)/,
    );
    expect(sql).toContain('on conflict ("guild_id","user_id") do update');
  });
});
