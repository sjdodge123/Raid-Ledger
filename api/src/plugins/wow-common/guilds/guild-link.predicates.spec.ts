/**
 * ROK-2115 — shape of THE link predicate. The SQL semantics are proven by
 * `guild-membership.blizzard-link.integration.spec.ts` on a real DB; these
 * pin the clauses a refactor could silently drop.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  blizzardIdLink,
  characterLink,
  guidLink,
  linkVia,
} from './guild-link.predicates';

const render = (q: SQL): string => new PgDialect().sqlToQuery(q).sql;

describe('guidLink (arm A)', () => {
  it('joins the GUID, same game, region or unknown region', () => {
    const text = render(guidLink());
    expect(text).toContain(
      '"characters"."addon_guid" = "guild_members"."guid"',
    );
    expect(text).toContain('"characters"."game_id" = "guilds"."game_id"');
    expect(text).toContain('"characters"."region" is null');
  });

  it('only counts an active owner (ROK-2160)', () => {
    expect(render(guidLink())).toContain(
      '"users"."id" = "characters"."user_id" and "users"."deactivated_at" is null',
    );
  });
});

describe('blizzardIdLink (arm B)', () => {
  const text = render(blizzardIdLink());

  it('joins external_id to the Blizzard id, strictly in the guild region', () => {
    expect(text).toContain(
      '"characters"."external_id" = "guild_members"."blizzard_character_id"::text',
    );
    expect(text).toContain(
      'lower("characters"."region") = lower("guilds"."region")',
    );
    // Strict: no unknown-region leniency in the arm's own match clauses.
    const ownClauses = text.slice(0, text.indexOf('not exists'));
    expect(ownClauses).not.toContain('"characters"."region" is null');
  });

  it('is off when another character GUID-holds the row (GUID wins)', () => {
    expect(text).toContain(
      'not exists (select 1 from "characters" as "link_guid_holder"',
    );
    expect(text).toContain(
      '"link_guid_holder"."addon_guid" = "guild_members"."guid"',
    );
  });

  it('a deactivated GUID holder does not block it (ROK-2160)', () => {
    expect(text).toContain(
      '"users"."id" = "link_guid_holder"."user_id" and "users"."deactivated_at" is null',
    );
  });

  it('is off when the character GUID-links to another live row (no double rows)', () => {
    expect(text).toContain('from "guild_members" as "link_other_row"');
    expect(text).toContain('"link_other_row"."id" <> "guild_members"."id"');
    expect(text).toContain(
      '"link_other_row"."guid" = "characters"."addon_guid"',
    );
  });
});

describe('characterLink', () => {
  it('is GUID arm OR Blizzard-id arm', () => {
    const text = render(characterLink());
    expect(text).toContain(render(guidLink()));
    expect(text).toContain(render(blizzardIdLink()));
    expect(text).toMatch(/\) or \(/);
  });

  it('linkVia labels the GUID arm first', () => {
    expect(render(linkVia())).toMatch(
      /^case when .* then 'guid' else 'blizzard' end$/s,
    );
  });
});
