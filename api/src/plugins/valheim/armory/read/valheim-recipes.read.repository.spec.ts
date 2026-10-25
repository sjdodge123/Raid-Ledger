/**
 * ROK-1948 D5 (Codex P2) — the visible-graph cache fingerprint must move on
 * every committed change to a known list. `imported_at` is `now()` (the
 * transaction START), so overlapping imports can commit an OLDER stamp and
 * a count + max(imported_at) fingerprint misses them. Hashing the lists
 * themselves read ~0.4 MB per Planner request, so the fingerprint keys on
 * each row's version instead: `xmin` changes on every committed UPDATE.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import { PROFILE_FINGERPRINT } from './valheim-recipes.read.repository';

const rendered = new PgDialect().sqlToQuery(PROFILE_FINGERPRINT).sql;

describe('PROFILE_FINGERPRINT (ROK-1948 D5)', () => {
  it("hashes every profile's id + row version (xmin), in a stable id order", () => {
    expect(rendered).toContain('"p".xmin::text');
    expect(rendered).toMatch(/md5\(.*string_agg\(.*order by "p"\."id"\)/);
  });

  it('does not read the known lists themselves (the cost it replaces)', () => {
    expect(rendered).not.toContain('known_recipes');
    expect(rendered).not.toContain('known_items');
  });

  it('does not key on a timestamp that overlapping imports can leave unchanged', () => {
    expect(rendered).not.toContain('imported_at');
  });
});
