/**
 * ROK-1948 D5 (Codex P2) — the visible-graph cache fingerprint must move on
 * every committed change to a known list. `imported_at` is `now()` (the
 * transaction START), so overlapping imports can commit an OLDER stamp and
 * a count + max(imported_at) fingerprint misses them; the fingerprint
 * therefore hashes the known lists themselves.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import { PROFILE_FINGERPRINT } from './valheim-recipes.read.repository';

const rendered = new PgDialect().sqlToQuery(PROFILE_FINGERPRINT).sql;

describe('PROFILE_FINGERPRINT (ROK-1948 D5)', () => {
  it('hashes both known lists of every profile, in a stable id order', () => {
    expect(rendered).toContain('"p"."known_recipes"');
    expect(rendered).toContain('"p"."known_items"');
    expect(rendered).toMatch(/md5\(.*string_agg\(.*order by "p"\."id"\)/);
  });

  it('does not key on a timestamp that overlapping imports can leave unchanged', () => {
    expect(rendered).not.toContain('imported_at');
  });
});
