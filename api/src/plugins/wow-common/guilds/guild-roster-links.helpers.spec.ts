/**
 * ROK-2115 (Ruling 6) — the staff roster's "linked via" label. The SQL
 * semantics (which arm linked a real row) belong to the integration tier;
 * these pin the label precedence and the GUID-arm subquery's clauses.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { guidLinkedToAny, rosterLinkVia } from './guild-roster-links.helpers';

const render = (q: SQL): string => new PgDialect().sqlToQuery(q).sql;

describe('rosterLinkVia', () => {
  it('reports a roster pick first, whatever arm linked it', () => {
    expect(rosterLinkVia({ picked: true, guidLinked: false })).toBe(
      'roster_pick',
    );
    expect(rosterLinkVia({ picked: true, guidLinked: true })).toBe(
      'roster_pick',
    );
  });

  it('reports a GUID (LedgerLink) link as an import', () => {
    expect(rosterLinkVia({ picked: false, guidLinked: true })).toBe('import');
  });

  it('reports a link made only by the Blizzard id as armory', () => {
    expect(rosterLinkVia({ picked: false, guidLinked: false })).toBe('armory');
  });
});

describe('guidLinkedToAny', () => {
  const text = render(guidLinkedToAny([11, 12]));

  it('is an exists over the listed roster rows of the guild', () => {
    expect(text).toMatch(/^exists\s*\(/);
    expect(text).toContain('from "guild_members"');
    expect(text).toContain('"guilds"."id" = "guild_members"."guild_id"');
    expect(text).toContain('"guild_members"."id" in (');
  });

  it('uses the shared GUID arm, never a re-derived join', () => {
    expect(text).toContain(
      '"characters"."addon_guid" = "guild_members"."guid"',
    );
    expect(text).toContain('"characters"."game_id" = "guilds"."game_id"');
  });

  it('is plain false for no rows (no empty IN list)', () => {
    expect(render(guidLinkedToAny([]))).toBe('false');
  });
});
