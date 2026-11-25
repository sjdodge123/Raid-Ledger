/**
 * TDB:2842 — the composer never offers, and never accepts at press time, a
 * game an admin hid or banned: every read here carries the same
 * `VISIBILITY_FILTER` `/lfg`'s autocomplete and `resolveGameId` use.
 *
 * The WHERE each query hands drizzle is rendered to SQL with a real
 * `PgDialect`, so the assertion names the two columns, not a mock call.
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  findComposerGame,
  searchComposerGames,
  searchComposerGamesFuzzy,
  type Db,
} from './lfg-composer-search.db-helpers';

/** A select chain that records its WHERE and resolves to no rows. */
function recordingDb(): { db: Db; where: () => string } {
  let captured: SQL | undefined;
  const chain: Record<string, unknown> = {};
  for (const step of ['select', 'from', 'orderBy']) {
    chain[step] = jest.fn(() => chain);
  }
  chain.where = jest.fn((clause: SQL) => {
    captured = clause;
    return chain;
  });
  chain.limit = jest.fn(() => Promise.resolve([]));
  const where = (): string => {
    if (!captured) throw new Error('the query never called .where()');
    return new PgDialect().sqlToQuery(captured).sql;
  };
  return { db: chain as unknown as Db, where };
}

const VISIBLE = /"games"\."hidden" = \$\d+.*"games"\."banned" = \$\d+/;

describe('composer game reads exclude hidden and banned games', () => {
  it('the word/acronym search filters on hidden and banned', async () => {
    const { db, where } = recordingDb();
    await searchComposerGames(db, 'deep rock');
    expect(where()).toMatch(VISIBLE);
  });

  it('the trigram "Did you mean" re-query filters on hidden and banned', async () => {
    const { db, where } = recordingDb();
    await searchComposerGamesFuzzy(db, 'valhiem');
    expect(where()).toMatch(VISIBLE);
  });

  it('the press-time read-back filters on hidden and banned', async () => {
    const { db, where } = recordingDb();
    await expect(findComposerGame(db, 7)).resolves.toBeNull();
    expect(where()).toMatch(VISIBLE);
  });
});
