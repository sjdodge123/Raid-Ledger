/**
 * ROK-2128 D2 — the derived "unclaimed" predicate and the FLAG 1 guild
 * visibility filter, rendered to SQL. Behaviour against a real database:
 * `roster-claim.integration.spec.ts`.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { isClaimableGuild, isRowUnclaimed } from './roster-claim.queries';

const dialect = new PgDialect();
const must = (s: SQL | undefined): SQL => {
  if (s === undefined) throw new Error('predicate rendered undefined');
  return s;
};
const render = (s: SQL | undefined): string =>
  dialect.sqlToQuery(must(s)).sql.replace(/\s+/g, ' ');

describe('isRowUnclaimed (ROK-2128 D2)', () => {
  const text = render(isRowUnclaimed());

  it('is a NOT EXISTS over characters of the guild game', () => {
    expect(text).toContain('not exists (select 1 from "characters" c');
    expect(text).toContain('c.game_id = "guilds"."game_id"');
  });

  it('(a) a character whose addon_guid is the row GUID, same region or unknown', () => {
    expect(text).toContain('c.addon_guid = "guild_members"."guid"');
    expect(text).toContain(
      '(c.region is null or lower(c.region) = lower("guilds"."region"))',
    );
  });

  it('(b) a character whose external_id is the row Blizzard id', () => {
    expect(text).toContain(
      'c.external_id = "guild_members"."blizzard_character_id"::text',
    );
  });

  it('(c) a character with the same name, case-insensitive, same region only', () => {
    expect(text).toContain(
      'lower(c.name) = lower("guild_members"."character_name") and lower(c.region) = lower("guilds"."region")',
    );
  });

  it('excludes rows soft-removed from the latest snapshot', () => {
    expect(text).toContain(
      '"guild_members"."last_seen_at" >= "guilds"."last_snapshot_at"',
    );
  });
});

describe('isClaimableGuild (ROK-2128 FLAG 1)', () => {
  const text = render(isClaimableGuild(7));

  it('scopes to the game, wow_guild hubs only', () => {
    expect(text).toContain('"guilds"."game_id" = $1');
    expect(text).toContain('"guilds"."kind" = $2');
  });

  it('requires approved, not hidden, not archived', () => {
    expect(text).toContain('"guilds"."status" = $3');
    expect(text).toContain('"guilds"."hidden_at" is null');
    expect(text).toContain('"guilds"."archived_at" is null');
  });

  it('binds the expected parameter values', () => {
    const params = dialect.sqlToQuery(must(isClaimableGuild(7))).params;
    expect(params).toEqual([7, 'wow_guild', 'active']);
  });
});
