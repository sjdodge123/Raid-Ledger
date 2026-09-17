/**
 * ROK-1602 — SQL relevance order + name-match filter shared by the web game
 * search and the Discord game autocompletes. Row order is proven against real
 * Postgres in game-search-relevance.integration.spec.ts; here we pin the SQL
 * shape and the bound parameters.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  buildGameNameMatchFilter,
  gameRelevanceOrder,
} from './game-search-relevance.helpers';

function render(fragment: SQL): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(fragment);
}

describe('gameRelevanceOrder', () => {
  it('emits one tier CASE then popularity, length, name', () => {
    const fragments = gameRelevanceOrder('wow');
    expect(fragments).toHaveLength(4);
    expect(render(fragments[0]).sql).toContain('CASE');
    expect(render(fragments[1]).sql).toContain('DESC NULLS LAST');
    expect(render(fragments[2]).sql).toContain('length(');
  });

  it('binds exact, leading-word, prefix, and infix patterns', () => {
    const { params } = render(gameRelevanceOrder('WoW')[0]);
    expect(params).toEqual(
      expect.arrayContaining(['wow', 'wow %', 'wow%', '%wow%']),
    );
  });

  it('adds acronym tiers only for acronym-shaped queries', () => {
    expect(render(gameRelevanceOrder('wow')[0]).sql).toContain('\\1');
    expect(render(gameRelevanceOrder('baldurs gate')[0]).sql).not.toContain(
      '\\1',
    );
  });

  it('binds the punctuation-stripped query, so "WoW:" ranks like "wow"', () => {
    const { params } = render(gameRelevanceOrder('WoW:')[0]);
    expect(params).toEqual(expect.arrayContaining(['wow', 'wow%']));
  });

  it('falls back to the popularity tail for an empty query', () => {
    expect(gameRelevanceOrder('  ')).toHaveLength(3);
  });
});

describe('buildGameNameMatchFilter', () => {
  it('ORs the word-match filter with an acronym prefix for "wow"', () => {
    const filter = buildGameNameMatchFilter('wow');
    const { sql, params } = render(filter!);
    expect(sql).toContain(' or ');
    expect(params).toEqual(expect.arrayContaining(['%wow%', 'wow%']));
  });

  it('is the plain word-match filter for a multi-word query', () => {
    const { sql } = render(buildGameNameMatchFilter('world of')!);
    expect(sql).not.toContain('\\1');
  });

  it('returns undefined for an empty query', () => {
    expect(buildGameNameMatchFilter('')).toBeUndefined();
  });
});
