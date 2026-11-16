/**
 * ROK-2222 — the roster-claim identity rule: a GUID-less Forever roster row
 * (Blizzard's guild roster API returns first names only) whose name is not a
 * two-part Forever name is not a claimable identity. Behaviour against a
 * real database: `roster-claim.claim.integration.spec.ts` (ROK-2222 block).
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import { FOREVER_NAME_SQL_PATTERN } from '../../forever-character-slug';
import {
  FIRST_NAME_ONLY,
  hasClaimableRosterIdentity,
  isClaimableRosterIdentity,
} from './roster-claim.name-rule';

/** name, guid, claimable */
const CASES: ReadonlyArray<[string, string | null, boolean]> = [
  ['Rok', null, false],
  ['  Rok  ', null, false],
  ['Rok Androot', null, true],
  [' Rok Androot ', null, true],
  ['Rok', 'Player-4395-0A1B2C3D', true],
  ['Rok Androot', 'Player-4395-0A1B2C3D', true],
];

describe('isClaimableRosterIdentity (ROK-2222)', () => {
  it.each(CASES)('%j with guid %j → %s', (name, guid, expected) => {
    expect(isClaimableRosterIdentity({ name, guid })).toBe(expected);
  });

  it('the refusal message tells the player what to do instead', () => {
    expect(FIRST_NAME_ONLY).toMatch(/first name/i);
    expect(FIRST_NAME_ONLY).toMatch(/LedgerLink/);
  });
});

describe('hasClaimableRosterIdentity (ROK-2222)', () => {
  const query = new PgDialect().sqlToQuery(hasClaimableRosterIdentity());
  const text = query.sql.replace(/\s+/g, ' ');

  it('keeps any row carrying a LedgerLink GUID', () => {
    expect(text).toContain('"guild_members"."guid" is not null');
  });

  it('otherwise requires the shared two-part Forever name prefilter', () => {
    expect(text).toContain('btrim("guild_members"."character_name") ~ $1');
    expect(query.params).toEqual([FOREVER_NAME_SQL_PATTERN]);
  });

  it('ORs the two arms inside one parenthesised predicate', () => {
    expect(text).toMatch(/^\(.* or .*\)$/);
  });
});
